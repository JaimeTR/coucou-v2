// Your own apps in Mochi's pills.
//
// Two ways for a program of yours to reach the island:
//
//   webhook  Coucou listens on 127.0.0.1 only. A POST to /hook/<secret> with
//            {"title": "...", "detail": "...", "status": "success|error|info"}
//            becomes a badge and a line in that pill. The secret is per pill.
//            Requests that come from a web page (they carry an Origin header)
//            are refused, so no site can poke the pill through your browser.
//   poll     Coucou asks a URL every so often (an optional token goes in a
//            header), reads one value out of the JSON answer with a dotted path
//            ("data.open_issues") and shows it; a change is an event.
//
// Everything stays local: the only network calls are to the URLs you gave.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::island::WINDOW_LABEL;
use crate::log;
use crate::secrets;
use crate::settings::CustomPill;

pub const PORT: u16 = 47821;
const MAX_BODY: usize = 16 * 1024;
const MAX_HEAD: usize = 8 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const POLL_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ANSWER: usize = 256 * 1024;

/// Same shape the island already handles for GitHub, Vercel and the rest.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Update {
    id: String,
    data: Value,
    error: Option<String>,
    event: Option<Event>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Event {
    success: bool,
    label: String,
    detail: Option<String>,
}

fn emit(app: &AppHandle, update: Update) {
    let _ = app.emit_to(WINDOW_LABEL, "integration", update);
}

fn pills(app: &AppHandle) -> Vec<CustomPill> {
    app.try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().custom_pills.clone())
        .unwrap_or_default()
}

pub fn secret_key(id: &str) -> String {
    format!("custom-{}-token", id.trim_start_matches("custom_"))
}

// ── Reading the request ───────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub has_origin: bool,
    pub body: Vec<u8>,
}

/// Parses one HTTP/1.1 request out of `raw`. `Err` carries the status to answer with.
pub fn parse_request(raw: &[u8]) -> Result<Request, u16> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or(400u16)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| 400u16)?;
    let mut lines = head.split("\r\n");
    let mut first = lines.next().ok_or(400u16)?.split(' ');
    let method = first.next().ok_or(400u16)?.to_string();
    let path = first.next().ok_or(400u16)?.to_string();
    let mut length = 0usize;
    let mut has_origin = false;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else { continue };
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => length = value.trim().parse().map_err(|_| 400u16)?,
            "origin" => has_origin = true,
            _ => {}
        }
    }
    if length > MAX_BODY {
        return Err(413);
    }
    let body = raw[split + 4..].to_vec();
    if body.len() < length {
        return Err(400);
    }
    Ok(Request { method, path, has_origin, body: body[..length].to_vec() })
}

/// "/hook/<secret>" → the secret.
pub fn hook_secret(path: &str) -> Option<&str> {
    let secret = path.strip_prefix("/hook/")?.split(['?', '#']).next()?;
    (secret.len() >= 16 && secret.chars().all(|c| c.is_ascii_alphanumeric())).then_some(secret)
}

pub struct Notice {
    pub title: String,
    pub detail: Option<String>,
    pub success: bool,
}

fn clip(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

/// A JSON object with `title` (and optionally `detail`, `status`), or a plain-text
/// body that is taken as the title.
pub fn parse_notice(body: &[u8]) -> Option<Notice> {
    let text = std::str::from_utf8(body).ok()?.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        if let Some(obj) = v.as_object() {
            let title = clip(obj.get("title").or_else(|| obj.get("message"))?.as_str()?, 120);
            if title.is_empty() {
                return None;
            }
            let detail = obj.get("detail").and_then(Value::as_str).map(|d| clip(d, 400)).filter(|d| !d.is_empty());
            let status = obj.get("status").and_then(Value::as_str).unwrap_or("success");
            return Some(Notice { title, detail, success: !matches!(status, "error" | "failure" | "failed" | "fail") });
        }
    }
    Some(Notice { title: clip(text, 120), detail: None, success: true })
}

// ── The webhook listener ──────────────────────────────────────────────────────

static LAST_EVENT: std::sync::LazyLock<Mutex<HashMap<String, Instant>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// One badge per second per pill is plenty; a flood only refreshes the card.
fn rate_ok(id: &str) -> bool {
    let mut map = LAST_EVENT.lock().unwrap();
    let now = Instant::now();
    match map.get(id) {
        Some(t) if now.duration_since(*t) < Duration::from_secs(1) => false,
        _ => {
            map.insert(id.to_string(), now);
            true
        }
    }
}

fn deliver(app: &AppHandle, pill: &CustomPill, notice: Notice) {
    let loud = rate_ok(&pill.id);
    log::line(format!("custom {} · {}", pill.id, notice.title));
    emit(
        app,
        Update {
            id: pill.id.clone(),
            data: json!({ "last": { "title": notice.title, "detail": notice.detail, "success": notice.success } }),
            error: None,
            event: loud.then(|| Event { success: notice.success, label: notice.title.clone(), detail: notice.detail.clone() }),
        },
    );
}

async fn read_request(sock: &mut TcpStream) -> Result<Request, u16> {
    let mut raw = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    loop {
        match parse_request(&raw) {
            Ok(req) => return Ok(req),
            Err(413) => return Err(413),
            Err(_) if raw.len() > MAX_HEAD + MAX_BODY => return Err(413),
            Err(_) => {}
        }
        let n = tokio::time::timeout(READ_TIMEOUT, sock.read(&mut chunk))
            .await
            .map_err(|_| 408u16)?
            .map_err(|_| 400u16)?;
        if n == 0 {
            return parse_request(&raw);
        }
        raw.extend_from_slice(&chunk[..n]);
    }
}

async fn answer(sock: &mut TcpStream, status: u16) {
    let text = match status {
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        413 => "Payload Too Large",
        _ => "Error",
    };
    let _ = sock
        .write_all(format!("HTTP/1.1 {status} {text}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes())
        .await;
}

async fn handle(app: AppHandle, mut sock: TcpStream) {
    let status = match read_request(&mut sock).await {
        Err(code) => code,
        Ok(req) if req.has_origin => 403, // a web page, not a program
        Ok(req) if req.method != "POST" => 405,
        Ok(req) => match hook_secret(&req.path)
            .and_then(|s| pills(&app).into_iter().find(|p| p.kind == "webhook" && p.hook_token == s))
        {
            None => 404,
            Some(pill) => match parse_notice(&req.body) {
                Some(notice) => {
                    deliver(&app, &pill, notice);
                    204
                }
                None => 400,
            },
        },
    };
    answer(&mut sock, status).await;
}

async fn listen(app: AppHandle) {
    let listener = match TcpListener::bind(("127.0.0.1", PORT)).await {
        Ok(l) => l,
        Err(err) => {
            log::line(format!("custom webhook port {PORT} unavailable: {err}"));
            return;
        }
    };
    loop {
        let Ok((sock, _)) = listener.accept().await else { continue };
        tauri::async_runtime::spawn(handle(app.clone(), sock));
    }
}

// ── Polling a URL ─────────────────────────────────────────────────────────────

/// "data.items.0.count" read out of a JSON value; numbers and booleans become text.
pub fn extract(value: &Value, path: &str) -> Option<String> {
    let mut at = value;
    for part in path.split('.').filter(|p| !p.is_empty()) {
        at = match at {
            Value::Array(list) => list.get(part.parse::<usize>().ok()?)?,
            _ => at.get(part)?,
        };
    }
    match at {
        Value::String(s) => Some(clip(s, 80)),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Null => None,
        other => Some(clip(&other.to_string(), 80)),
    }
}

/// Reads the URL once. `Ok(Some(text))` is the value (or the whole answer when no path is set).
async fn read_once(pill: &CustomPill) -> Result<String, String> {
    if !(pill.poll_url.starts_with("http://") || pill.poll_url.starts_with("https://")) {
        return Err("La dirección debe empezar por http:// o https://".into());
    }
    let client = reqwest::Client::builder().timeout(POLL_TIMEOUT).build().map_err(|e| e.to_string())?;
    let mut request = client.get(&pill.poll_url);
    if let Some(token) = secrets::get(&secret_key(&pill.id)) {
        let header = if pill.auth_header.is_empty() { "Authorization" } else { pill.auth_header.as_str() };
        let value = if header.eq_ignore_ascii_case("authorization") && !token.to_ascii_lowercase().starts_with("bearer ") {
            format!("Bearer {token}")
        } else {
            token
        };
        request = request.header(header, value);
    }
    let response = request.send().await.map_err(|e| format!("Sin conexión: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => format!("Acceso rechazado ({status}). Revisa el token."),
            404 => "La dirección no existe (404).".to_string(),
            _ => format!("La dirección respondió {status}."),
        });
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_ANSWER {
        return Err("La respuesta es demasiado grande.".into());
    }
    if pill.poll_path.trim().is_empty() {
        return Ok(clip(&String::from_utf8_lossy(&bytes), 80));
    }
    let json: Value = serde_json::from_slice(&bytes).map_err(|_| "La respuesta no es JSON.".to_string())?;
    extract(&json, pill.poll_path.trim()).ok_or_else(|| format!("No hay nada en «{}» dentro de la respuesta.", pill.poll_path.trim()))
}

/// "Probar" in Settings: what the pill would show right now.
pub async fn test(app: &AppHandle, id: &str) -> Result<String, String> {
    let pill = pills(app).into_iter().find(|p| p.id == id).ok_or("Esa app ya no existe.")?;
    if pill.kind == "webhook" {
        deliver(app, &pill, Notice { title: "Prueba de Mochi".into(), detail: Some("Si ves esto, el aviso llegó.".into()), success: true });
        return Ok("Enviado: mira la isla.".into());
    }
    read_once(&pill).await
}

async fn poll_loop(app: AppHandle, id: String) {
    tokio::time::sleep(Duration::from_secs(3)).await;
    let mut previous: Option<String> = None;
    loop {
        let Some(pill) = pills(&app).into_iter().find(|p| p.id == id && p.kind == "poll") else {
            return;
        };
        if !crate::integrations::PAUSED.load(std::sync::atomic::Ordering::Relaxed) {
            match read_once(&pill).await {
                Ok(value) => {
                    let changed = previous.as_ref().is_some_and(|p| *p != value);
                    previous = Some(value.clone());
                    emit(
                        &app,
                        Update {
                            id: id.clone(),
                            data: json!({ "value": value }),
                            error: None,
                            event: changed.then(|| Event { success: true, label: format!("{}: {value}", pill.name), detail: None }),
                        },
                    );
                }
                Err(message) => emit(&app, Update { id: id.clone(), data: json!({}), error: Some(message), event: None }),
            }
        }
        tokio::time::sleep(Duration::from_secs(u64::from(pill.poll_every.clamp(30, 86_400)))).await;
    }
}

// ── Starting and restarting ───────────────────────────────────────────────────

static LOOPS: std::sync::LazyLock<Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>> =
    std::sync::LazyLock::new(|| Mutex::new(Vec::new()));

/// (Re)starts one poller per `poll` pill; called at launch and when they change.
pub fn reload(app: &AppHandle) {
    let mut loops = LOOPS.lock().unwrap();
    for handle in loops.drain(..) {
        handle.abort();
    }
    for pill in pills(app).into_iter().filter(|p| p.kind == "poll") {
        loops.push(tauri::async_runtime::spawn(poll_loop(app.clone(), pill.id)));
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(listen(app.clone()));
    reload(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(method: &str, path: &str, extra: &str, body: &str) -> Vec<u8> {
        format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {}\r\n{extra}\r\n{body}", body.len()).into_bytes()
    }

    #[test]
    fn a_post_is_read_with_its_body() {
        let req = parse_request(&raw("POST", "/hook/abcdef0123456789", "", "{\"title\":\"hi\"}")).unwrap();
        assert_eq!(req.method, "POST");
        assert_eq!(req.path, "/hook/abcdef0123456789");
        assert!(!req.has_origin);
        assert_eq!(req.body, b"{\"title\":\"hi\"}");
    }

    #[test]
    fn a_request_from_a_web_page_is_recognised() {
        let req = parse_request(&raw("POST", "/hook/x", "Origin: https://evil.example\r\n", "{}")).unwrap();
        assert!(req.has_origin);
    }

    #[test]
    fn incomplete_or_oversized_requests_are_refused() {
        assert_eq!(parse_request(b"POST /x HTTP/1.1\r\nContent-Length: 10\r\n\r\nabc"), Err(400));
        assert_eq!(parse_request(b"POST /x HTTP/1.1\r\nContent-Length: 99999999\r\n\r\n"), Err(413));
        assert_eq!(parse_request(b"garbage"), Err(400));
    }

    #[test]
    fn only_a_long_alphanumeric_secret_is_a_hook() {
        assert_eq!(hook_secret("/hook/abcdef0123456789"), Some("abcdef0123456789"));
        assert_eq!(hook_secret("/hook/abcdef0123456789?x=1"), Some("abcdef0123456789"));
        assert_eq!(hook_secret("/hook/short"), None);
        assert_eq!(hook_secret("/hook/../../etc/passwd0000"), None);
        assert_eq!(hook_secret("/other/abcdef0123456789"), None);
    }

    #[test]
    fn a_notice_is_json_or_plain_text() {
        let n = parse_notice(br#"{"title":"Deploy listo","detail":"v1.2","status":"success"}"#).unwrap();
        assert_eq!((n.title.as_str(), n.detail.as_deref(), n.success), ("Deploy listo", Some("v1.2"), true));
        assert!(!parse_notice(r#"{"title":"Falló","status":"error"}"#.as_bytes()).unwrap().success);
        assert_eq!(parse_notice(b"hola mundo").unwrap().title, "hola mundo");
        assert!(parse_notice(b"   ").is_none());
        assert!(parse_notice(r#"{"detail":"sin título"}"#.as_bytes()).is_none());
        assert_eq!(parse_notice(&vec![b'a'; 500]).unwrap().title.chars().count(), 120);
    }

    #[test]
    fn a_dotted_path_reads_one_value() {
        let v = json!({ "data": { "open": 7, "items": [{ "name": "a" }, { "name": "b" }], "ok": true, "nope": null } });
        assert_eq!(extract(&v, "data.open").as_deref(), Some("7"));
        assert_eq!(extract(&v, "data.items.1.name").as_deref(), Some("b"));
        assert_eq!(extract(&v, "data.ok").as_deref(), Some("true"));
        assert_eq!(extract(&v, "data.nope"), None);
        assert_eq!(extract(&v, "data.missing"), None);
        assert_eq!(extract(&v, "data.items.9"), None);
    }
}
