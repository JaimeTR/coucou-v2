// Sync: your settings follow you from one computer to the other, through your
// own Coucou sync server (the Cloudflare Worker in `sync/`).
//
// The account is a 32-byte code made on the first computer and typed or pasted
// on the others. Three things are derived from it with SHA-256 and a label —
// the account id, the bearer token and the AES-256-GCM key — so the server
// stores only blobs it cannot read, and the code itself never leaves the
// devices (it lives in the OS keychain, like the API keys).
//
// What travels: the preferences, minus what belongs to one machine (its screen,
// where the island sits, start with Windows, the hooks of that PC). API keys
// never travel.

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::{log, secrets, settings, Shared};

pub const CODE_KEY: &str = "sync-code";

/// Settings that describe this machine, not the person: they never travel.
const PER_DEVICE: &[&str] = &[
    "screen", "islandPosition", "islandOffset", "autostart", "hooksInstalled",
    "syncUrl", "syncRev", "syncDevice",
];

pub struct Keys {
    pub id: String,
    pub token: String,
    key: [u8; 32],
}

fn hash(label: &str, secret: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(label.as_bytes());
    h.update(secret);
    h.finalize().into()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The code as typed: 64 hex digits, any dashes, spaces or case.
pub fn derive(code: &str) -> Option<Keys> {
    let digits: String = code.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_lowercase();
    if digits.len() != 64 || code.chars().any(|c| !(c.is_ascii_hexdigit() || c == '-' || c.is_whitespace())) {
        return None;
    }
    let secret: Vec<u8> = (0..32).map(|i| u8::from_str_radix(&digits[i * 2..i * 2 + 2], 16).unwrap()).collect();
    Some(Keys {
        id: hex(&hash("coucou-id:", &secret))[..32].to_string(),
        token: hex(&hash("coucou-auth:", &secret)),
        key: hash("coucou-key:", &secret),
    })
}

/// A new code, shown as eight groups of eight: easy to read out and compare.
pub fn new_code() -> String {
    let key = Aes256Gcm::generate_key(OsRng);
    hex(&key).as_bytes().chunks(8).map(|c| String::from_utf8_lossy(c).into_owned()).collect::<Vec<_>>().join("-")
}

pub fn seal(keys: &Keys, plain: &[u8]) -> String {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&keys.key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let mut out = nonce.to_vec();
    // Encrypting into a Vec cannot fail for inputs this size.
    out.extend(cipher.encrypt(&nonce, plain).unwrap_or_default());
    B64.encode(out)
}

pub fn open(keys: &Keys, blob: &str) -> Option<Vec<u8>> {
    let raw = B64.decode(blob).ok()?;
    if raw.len() < 12 + 16 {
        return None;
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&keys.key));
    cipher.decrypt(Nonce::from_slice(&raw[..12]), &raw[12..]).ok()
}

/// The part of the settings that travels.
fn shared_part(s: &settings::Settings) -> Value {
    let mut v = serde_json::to_value(s).unwrap_or(Value::Null);
    if let Some(map) = v.as_object_mut() {
        for k in PER_DEVICE {
            map.remove(*k);
        }
    }
    v
}

/// Ours, with what came from another computer laid over it (machine-only keys stay ours).
fn merged(local: &settings::Settings, remote: &Value) -> Option<settings::Settings> {
    let mut v = serde_json::to_value(local).ok()?;
    let (Some(map), Some(remote)) = (v.as_object_mut(), remote.as_object()) else { return None };
    for (k, value) in remote {
        if !PER_DEVICE.contains(&k.as_str()) {
            map.insert(k.clone(), value.clone());
        }
    }
    serde_json::from_value(v).ok()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

fn endpoint(url: &str, keys: &Keys, path: &str) -> String {
    format!("{}/v1/{}/{path}", url.trim_end_matches('/'), keys.id)
}

/// The server answered something unexpected: in words the settings window can show.
fn http_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        403 => "Ese código no corresponde a esta cuenta.".into(),
        404 => "No hay ajustes con ese código todavía.".into(),
        s => format!("El servidor de sincronización respondió {s}."),
    }
}

fn current(app: &AppHandle) -> Option<(settings::Settings, Keys)> {
    let shared = app.try_state::<Shared>()?;
    let s = shared.settings.lock().unwrap().clone();
    if s.sync_url.is_empty() {
        return None;
    }
    let keys = derive(&secrets::get(CODE_KEY)?)?;
    Some((s, keys))
}

/// Sends this computer's settings. Called after every save made here.
pub async fn push(app: &AppHandle) -> Result<(), String> {
    let Some((s, keys)) = current(app) else { return Ok(()) };
    let blob = seal(&keys, shared_part(&s).to_string().as_bytes());
    let res = client()
        .put(endpoint(&s.sync_url, &keys, "settings"))
        .bearer_auth(&keys.token)
        .json(&serde_json::json!({ "blob": blob }))
        .send()
        .await
        .map_err(|e| format!("No se pudo llegar al servidor: {e}"))?;
    if !res.status().is_success() {
        return Err(http_error(res.status()));
    }
    let rev = res.json::<Value>().await.ok().and_then(|v| v["rev"].as_u64()).unwrap_or(0);
    remember_rev(app, rev);
    Ok(())
}

/// Takes the other computer's settings when they are newer than what we have.
/// Returns whether anything changed here.
pub async fn pull(app: &AppHandle) -> Result<bool, String> {
    let Some((s, keys)) = current(app) else { return Ok(false) };
    let res = client()
        .get(endpoint(&s.sync_url, &keys, "settings"))
        .bearer_auth(&keys.token)
        .send()
        .await
        .map_err(|e| format!("No se pudo llegar al servidor: {e}"))?;
    if !res.status().is_success() {
        return Err(http_error(res.status()));
    }
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let rev = body["rev"].as_u64().unwrap_or(0);
    if rev <= s.sync_rev {
        return Ok(false);
    }
    let plain = body["blob"].as_str().and_then(|b| open(&keys, b)).ok_or("No se pudieron descifrar los ajustes.")?;
    let remote: Value = serde_json::from_slice(&plain).map_err(|e| e.to_string())?;
    let Some(mut next) = merged(&s, &remote) else { return Err("Ajustes recibidos ilegibles.".into()) };
    next.sync_rev = rev;
    // Applied like a save from the settings window, but not sent back: that
    // would bounce between the two computers for ever.
    crate::apply_settings(app, next);
    log::line(format!("sync: settings rev {rev} applied"));
    Ok(true)
}

fn remember_rev(app: &AppHandle, rev: u64) {
    let Some(shared) = app.try_state::<Shared>() else { return };
    let snapshot = {
        let mut s = shared.settings.lock().unwrap();
        s.sync_rev = rev;
        s.clone()
    };
    let _ = settings::save(&snapshot);
}

/// Pulls a few seconds after launch, then every two minutes. One small HTTPS
/// request when sync is on, nothing at all when it is off.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        loop {
            if let Err(err) = pull(&app).await {
                log::line(format!("sync: {err}"));
            }
            tokio::time::sleep(std::time::Duration::from_secs(120)).await;
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub url: String,
    pub connected: bool,
    pub device: String,
}

pub fn status(app: &AppHandle) -> SyncStatus {
    let s = app.state::<Shared>().settings.lock().unwrap().clone();
    SyncStatus {
        connected: !s.sync_url.is_empty() && secrets::present(CODE_KEY),
        url: s.sync_url,
        device: s.sync_device,
    }
}

/// Turns sync on with `code` (a new account when `code` is None). Joining an
/// existing account takes its settings; creating one sends ours.
pub async fn connect(app: &AppHandle, url: String, code: Option<String>) -> Result<String, String> {
    let url = url.trim().trim_end_matches('/').to_string();
    if !(url.starts_with("https://") || url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost")) {
        return Err("La dirección del servidor debe empezar por https://".into());
    }
    let creating = code.is_none();
    let code = code.unwrap_or_else(new_code);
    if derive(&code).is_none() {
        return Err("El código debe tener 64 caracteres (0-9, a-f), con o sin guiones.".into());
    }
    secrets::set(CODE_KEY, code.trim())?;
    {
        let shared = app.state::<Shared>();
        let mut s = shared.settings.lock().unwrap();
        s.sync_url = url;
        s.sync_rev = 0;
        if s.sync_device.is_empty() {
            s.sync_device = device_id();
        }
        let _ = settings::save(&s);
    }
    let result = if creating { push(app).await } else { pull(app).await.map(|_| ()) };
    if let Err(err) = result {
        disconnect(app);
        return Err(err);
    }
    Ok(code.trim().to_string())
}

pub fn disconnect(app: &AppHandle) {
    let _ = secrets::clear(CODE_KEY);
    let shared = app.state::<Shared>();
    let mut s = shared.settings.lock().unwrap();
    s.sync_url.clear();
    s.sync_rev = 0;
    let _ = settings::save(&s);
}

/// "pc-jaime-3f9a": the computer's name, readable, plus a little randomness.
fn device_id() -> String {
    let name = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "pc".into());
    let clean: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(28)
        .collect();
    let tail = &hex(&Aes256Gcm::generate_key(OsRng))[..4];
    format!("{}-{tail}", if clean.is_empty() { "pc" } else { &clean })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE: &str = "00112233-44556677-8899aabb-ccddeeff-00112233-44556677-8899aabb-ccddeeff";

    #[test]
    fn the_code_gives_the_same_keys_however_it_is_typed() {
        let a = derive(CODE).unwrap();
        let b = derive(&CODE.replace('-', "").to_uppercase()).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.token, b.token);
        assert_eq!(a.id.len(), 32);
        assert_eq!(a.token.len(), 64);
        assert!(derive("not a code").is_none());
        assert!(derive(&CODE[..60]).is_none());
        assert!(derive(&new_code()).is_some());
    }

    #[test]
    fn sealed_settings_open_only_with_the_same_code() {
        let keys = derive(CODE).unwrap();
        let blob = seal(&keys, b"{\"userName\":\"Jaime\"}");
        assert_eq!(open(&keys, &blob).unwrap(), b"{\"userName\":\"Jaime\"}");
        let other = derive(&new_code()).unwrap();
        assert!(open(&other, &blob).is_none());
        assert!(open(&keys, "AAAA").is_none());
    }

    /// Against a running server: `SYNC_URL=http://127.0.0.1:8787 cargo test sync -- --ignored`.
    #[test]
    #[ignore]
    fn round_trip_through_a_real_server() {
        let url = std::env::var("SYNC_URL").expect("SYNC_URL");
        let keys = derive(&new_code()).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let blob = seal(&keys, b"{\"userName\":\"Jaime\"}");
            let put = client().put(endpoint(&url, &keys, "settings")).bearer_auth(&keys.token)
                .json(&serde_json::json!({ "blob": blob })).send().await.unwrap();
            assert_eq!(put.json::<Value>().await.unwrap()["rev"], 1);
            let got: Value = client().get(endpoint(&url, &keys, "settings")).bearer_auth(&keys.token)
                .send().await.unwrap().json().await.unwrap();
            assert_eq!(open(&keys, got["blob"].as_str().unwrap()).unwrap(), b"{\"userName\":\"Jaime\"}");
            let other = derive(&new_code()).unwrap();
            let denied = client().get(format!("{}/v1/{}/settings", url, keys.id)).bearer_auth(&other.token)
                .send().await.unwrap();
            assert_eq!(denied.status().as_u16(), 403);
        });
    }

    #[test]
    fn machine_settings_never_travel_and_are_kept_on_merge() {
        let mut local = settings::Settings::default();
        local.screen = "cursor".into();
        local.autostart = true;
        let sent = shared_part(&local);
        assert!(sent.get("screen").is_none() && sent.get("autostart").is_none());
        let remote = serde_json::json!({ "userName": "Jaime", "screen": "primary", "autostart": false });
        let next = merged(&local, &remote).unwrap();
        assert_eq!(next.user_name, "Jaime");
        assert_eq!(next.screen, "cursor");
        assert!(next.autostart);
    }
}
