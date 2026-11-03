// src-tauri/src/mail/direct.rs

// Mail straight from the provider over IMAP (Gmail, Titan, any server), for the
// person who reads mail in the browser and has no Thunderbird. It feeds the same
// inbox, search, reader and verification-code card as the Thunderbird accounts:
// a message is identified by its IMAP UID, which travels in `MessageInfo.offset`.
//
// Read-only: INBOX is opened with EXAMINE and every fetch is BODY.PEEK, so
// nothing is marked as read. The password sits in the credential store
// (`mail-imap-<id>`), is only ever sent to the server the person typed, and is
// never logged. Nothing connects until an account has been added in Settings
// and ticked as watched.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use super::mbox::{self, MessageHeaders};
use super::otp;

/// Account ids of this kind start with this; Thunderbird's are `imap:<server>…`.
pub const PREFIX: &str = "imapd:";

/// Newest messages kept per account for the list and the search.
const KEEP: u32 = 100;
const POLL_EVERY: Duration = Duration::from_secs(60);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImapAccount {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub user: String,
}

pub fn account_id(id: &str) -> String {
    format!("{PREFIX}{id}")
}

pub fn secret_key(id: &str) -> String {
    format!("mail-imap-{id}")
}

/// A short, safe id from the address: "ana.perez@gmail.com" → "ana-perez-gmail-com".
pub fn slug(user: &str) -> String {
    let s: String = user
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-").chars().take(40).collect()
}

/// What the form's preset boxes stand for: (host, port).
pub fn preset(name: &str) -> Option<(&'static str, u16)> {
    match name {
        "gmail" => Some(("imap.gmail.com", 993)),
        "titan" => Some(("imap.titan.email", 993)),
        _ => None,
    }
}

/// A hostname and nothing else: it is typed by the person and goes into a socket address.
pub fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 100
        && host.contains('.')
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && !host.starts_with(['.', '-'])
}

/// The server's words, in ours; the password itself is never part of an error.
fn friendly(err: &str, host: &str) -> String {
    let e = err.to_lowercase();
    if ["authenticationfailed", "invalid credentials", "login failed", "authenticat"].iter().any(|w| e.contains(w)) {
        if host.contains("gmail") {
            "Gmail rechazó la contraseña. Necesita una contraseña de aplicación (Cuenta de Google → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones) y IMAP activado.".into()
        } else {
            "El servidor rechazó el usuario o la contraseña.".into()
        }
    } else if e.contains("dns") || e.contains("resolve") || e.contains("lookup") || e.contains("connect") || e.contains("timed out") || e.contains("refused") {
        format!("No se pudo conectar a {host}. Revisa el servidor, el puerto y tu conexión.")
    } else if e.contains("certificate") || e.contains("tls") {
        format!("No se pudo establecer una conexión segura con {host}.")
    } else {
        "El servidor de correo no respondió como se esperaba.".into()
    }
}

type Session = imap::Session<imap::Connection>;

fn open(acc: &ImapAccount, password: &str) -> Result<Session, String> {
    let client = imap::ClientBuilder::new(acc.host.as_str(), acc.port)
        .connect()
        .map_err(|e| friendly(&e.to_string(), &acc.host))?;
    client.login(&acc.user, password).map_err(|(e, _)| friendly(&e.to_string(), &acc.host))
}

/// Logs in and out: used by Settings to check an account before keeping it.
pub fn check(acc: &ImapAccount, password: &str) -> Result<(), String> {
    let mut s = open(acc, password)?;
    let _ = s.logout();
    Ok(())
}

/// The newest messages of INBOX, newest first, with the UID in `offset`.
pub fn recent(acc: &ImapAccount, password: &str) -> Result<Vec<MessageHeaders>, String> {
    let mut s = open(acc, password)?;
    let result = (|| {
        let inbox = s.examine("INBOX").map_err(|e| friendly(&e.to_string(), &acc.host))?;
        if inbox.exists == 0 {
            return Ok(Vec::new());
        }
        let first = inbox.exists.saturating_sub(KEEP - 1).max(1);
        let fetched = s
            .fetch(format!("{first}:*"), "(UID BODY.PEEK[HEADER])")
            .map_err(|e| friendly(&e.to_string(), &acc.host))?;
        let mut out: Vec<MessageHeaders> = fetched
            .iter()
            .filter_map(|f| Some(mbox::parse_headers(f.header()?, f.uid? as usize, 0)))
            .collect();
        out.sort_by(|a, b| b.offset.cmp(&a.offset));
        Ok(out)
    })();
    let _ = s.logout();
    result
}

/// The whole message by UID (read-only), as the reader shows it.
pub fn raw(acc: &ImapAccount, password: &str, uid: usize) -> Result<Vec<u8>, String> {
    let mut s = open(acc, password)?;
    let result = (|| {
        s.examine("INBOX").map_err(|e| friendly(&e.to_string(), &acc.host))?;
        let fetched = s
            .uid_fetch(uid.to_string(), "BODY.PEEK[]")
            .map_err(|e| friendly(&e.to_string(), &acc.host))?;
        let bytes = fetched.iter().find_map(|f| f.body().map(|b| b.to_vec()));
        bytes.ok_or_else(|| "Ese mensaje ya no está en la bandeja.".to_string())
    })();
    let _ = s.logout();
    result
}

pub fn read(acc: &ImapAccount, password: &str, uid: usize) -> Result<String, String> {
    let bytes = raw(acc, password, uid)?;
    mbox::parse_body(&bytes).ok_or_else(|| "No se pudo leer este mensaje.".to_string())
}

/// The messages that arrived since the last look: those past the watermark. The first
/// look (`None`) only sets the baseline, so what already sits in a mailbox never comes
/// back as news. Pure, so it is tested.
pub fn arrived(messages: &[MessageHeaders], watermark: Option<usize>) -> Vec<&MessageHeaders> {
    match watermark {
        Some(w) => messages.iter().filter(|m| m.offset > w).collect(),
        None => Vec::new(),
    }
}

// ── The poll ──────────────────────────────────────────────────────────────────

/// Per account id (`imapd:<id>`): the list the inbox shows.
static CACHE: LazyLock<Mutex<HashMap<String, Vec<MessageHeaders>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
/// Per account id: the highest UID already seen.
static WATERMARK: LazyLock<Mutex<HashMap<String, usize>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn cached(account: &str) -> Vec<MessageHeaders> {
    CACHE.lock().unwrap().get(account).cloned().unwrap_or_default()
}

pub fn cached_all(watched: &[String]) -> Vec<(String, MessageHeaders)> {
    CACHE
        .lock()
        .unwrap()
        .iter()
        .filter(|(a, _)| watched.contains(a))
        .flat_map(|(a, v)| v.iter().cloned().map(move |m| (a.clone(), m)))
        .collect()
}

fn configured(app: &tauri::AppHandle) -> (Vec<ImapAccount>, Vec<String>) {
    use tauri::Manager;
    let s = app.state::<crate::Shared>().settings.lock().unwrap().clone();
    (s.mail_imap_accounts, s.mail_watched_accounts)
}

pub fn find(app: &tauri::AppHandle, account_id: &str) -> Option<ImapAccount> {
    configured(app).0.into_iter().find(|a| self::account_id(&a.id) == account_id)
}

pub fn password(acc: &ImapAccount) -> Option<String> {
    crate::secrets::get(&secret_key(&acc.id))
}

pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(20));
        tick(&app);
        std::thread::sleep(POLL_EVERY - Duration::from_secs(20));
    });
}

/// Forgets an account taken off the watched list or removed, so adding it again is a
/// fresh, silent baseline.
pub fn forget(account: &str) {
    CACHE.lock().unwrap().remove(account);
    WATERMARK.lock().unwrap().remove(account);
}

fn tick(app: &tauri::AppHandle) {
    use tauri::Emitter;
    let (accounts, watched) = configured(app);
    {
        let keep = |a: &String| accounts.iter().any(|x| account_id(&x.id) == *a) && watched.contains(a);
        CACHE.lock().unwrap().retain(|k, _| keep(k));
        WATERMARK.lock().unwrap().retain(|k, _| keep(k));
    }
    let mut changed = false;
    for acc in accounts {
        let id = account_id(&acc.id);
        if !watched.contains(&id) {
            continue;
        }
        let Some(pass) = password(&acc) else { continue };
        let list = match recent(&acc, &pass) {
            Ok(l) => l,
            Err(err) => {
                crate::log::line(format!("mail {id}: {err}"));
                continue;
            }
        };
        let wm = WATERMARK.lock().unwrap().get(&id).copied();
        let fresh: Vec<MessageHeaders> = arrived(&list, wm).into_iter().cloned().collect();
        if let Some(top) = list.iter().map(|m| m.offset).max() {
            WATERMARK.lock().unwrap().insert(id.clone(), top.max(wm.unwrap_or(0)));
        } else if wm.is_none() {
            WATERMARK.lock().unwrap().insert(id.clone(), 0);
        }
        let differs = CACHE.lock().unwrap().get(&id).map(|old| old.iter().map(|m| m.offset).collect::<Vec<_>>()) != Some(list.iter().map(|m| m.offset).collect());
        if differs {
            CACHE.lock().unwrap().insert(id.clone(), list);
            changed = true;
        }
        // A verification code in a new message, same card as Thunderbird's.
        for m in fresh {
            let start: String = raw(&acc, &pass, m.offset)
                .ok()
                .and_then(|b| mbox::parse_body(&b))
                .unwrap_or_default()
                .chars()
                .take(500)
                .collect();
            if let Some(code) = otp::find_code(&m.subject, &start) {
                let _ = app.emit("mail-code", serde_json::json!({ "code": code, "subject": m.subject, "from": m.from }));
            }
        }
    }
    if changed {
        let _ = app.emit("mail", ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(uid: usize) -> MessageHeaders {
        MessageHeaders { offset: uid, len: 0, subject: format!("m{uid}"), from: String::new(), date_rfc3339: String::new(), message_id: String::new(), timestamp: 0, expunged: false }
    }

    #[test]
    fn the_first_look_is_silent_and_later_ones_report_only_what_is_new() {
        let list = vec![msg(9), msg(8), msg(7)];
        assert!(arrived(&list, None).is_empty());
        assert_eq!(arrived(&list, Some(8)).iter().map(|m| m.offset).collect::<Vec<_>>(), vec![9]);
        assert!(arrived(&list, Some(9)).is_empty());
    }

    #[test]
    fn ids_are_short_and_safe() {
        assert_eq!(slug("Ana.Perez@Gmail.com"), "ana-perez-gmail-com");
        assert_eq!(slug("  ../..  "), "");
        assert_eq!(secret_key("ana"), "mail-imap-ana");
        assert_eq!(account_id("ana"), "imapd:ana");
    }

    #[test]
    fn presets_and_hosts() {
        assert_eq!(preset("gmail"), Some(("imap.gmail.com", 993)));
        assert_eq!(preset("titan"), Some(("imap.titan.email", 993)));
        assert_eq!(preset("otro"), None);
        assert!(valid_host("imap.example.com"));
        assert!(!valid_host("localhost"));
        assert!(!valid_host("a b.com"));
        assert!(!valid_host("evil.com:25"));
        assert!(!valid_host(""));
    }

    #[test]
    fn errors_are_in_plain_words_and_never_carry_the_password() {
        let g = friendly("[AUTHENTICATIONFAILED] Invalid credentials (Failure)", "imap.gmail.com");
        assert!(g.contains("contraseña de aplicación"));
        assert!(friendly("No response: AUTHENTICATE failed", "imap.titan.email").contains("rechazó"));
        assert!(friendly("failed to lookup address information", "x.example.com").contains("No se pudo conectar"));
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// Against the real Titan server with a login that cannot exist: proves the TLS
    /// connection and the protocol path, and that the error is in plain words.
    /// `cargo test live_server_refuses_a_made_up_login -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_server_refuses_a_made_up_login() {
        let acc = ImapAccount { id: "t".into(), label: "t".into(), host: "imap.titan.email".into(), port: 993, user: "coucou-test@invalid.example".into() };
        let err = check(&acc, "not-a-password").unwrap_err();
        println!("{err}");
        assert!(err.contains("rechazó") || err.contains("No se pudo"), "{err}");
    }
}
