# WhatsApp (GOWA) Windows/Linux Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the WhatsApp integration (`windows/src-tauri/src/whatsapp/`) from stub scaffolding into a working feature: auto-install GOWA, start it as a local process, talk to it over HTTP, receive messages on a local webhook with polling fallback, and expose it in Settings and the Integraciones pill picker.

**Architecture:** A line-by-line port of the Mac app's shipped implementation (`NotchBuddy/Sources/App/WhatsApp*.swift`) into the existing Rust/TS scaffolding. Every Rust type (`LinkState`, `WebhookState`, `InstallStep`, Tauri commands) already exists in `mod.rs`; only the bodies are stubs. OpenWA gateway and Focus-mode gating are explicitly out of scope (YAGNI).

**Tech Stack:** Rust (tokio, reqwest, sha2 — all existing deps; `zip` is new), TypeScript/Vite (existing Settings UI patterns).

**Spec:** `docs/superpowers/specs/2026-11-01-whatsapp-gowa-windows-design.md`

## Global Constraints

- No message content, media, or contact name is ever written to disk or logged — in-memory only, forgotten on quit or when the integration is turned off.
- Webhook listener binds to `127.0.0.1` only, rejects any non-loopback peer at the connection layer.
- GOWA process only ever started when its configured URL host is `127.0.0.1`/`localhost`/`::1` — never spawn a process pointed at a remote address.
- Credential never appears on the process command line — environment variable only (`APP_BASIC_AUTH`).
- GOWA download: only `api.github.com` and its release-asset redirect target are contacted; `reqwest` must use an explicit redirect policy (`reqwest::redirect::Policy::none()` is wrong here — GitHub redirects release assets to a CDN host; use a policy that only follows redirects whose target host ends in `.githubusercontent.com` or is `github.com`, mirroring the Mac's `GitHubOnly` delegate. See Task 5.)
- SHA-256 of the downloaded zip must match GOWA's own published `checksums.txt` before the binary is ever extracted or run.
- OpenWA gateway (`WAGatewayKind::OpenWa`) stays a dead/unreachable variant — never selectable from the UI, no provider implementation. Do not implement it in any task below; if a task's reviewer flags this as "incomplete," the correct ruling is "out of scope per spec," not implementing it.
- Settings persist via the existing single `Settings` struct in `windows/src-tauri/src/settings.rs` (JSON at `platform::config_dir()/settings.json`) — do not invent a second persistence file. New fields use `#[serde(default)]` or `#[serde(default = "fn_name")]` so an older `settings.json` still loads (see `mail_watched_accounts` for the existing precedent).
- URL and credential are secrets: stored via `crate::secrets::set_internal`/`crate::secrets::get`, keyed by the existing `URL_KEY`/`CREDENTIAL_KEY`/`SECRET_KEY` constants in `mod.rs` — never in `Settings`.

---

### Task 1: `Settings` fields + `zip` dependency

**Files:**
- Modify: `windows/src-tauri/Cargo.toml`
- Modify: `windows/src-tauri/src/settings.rs`

**Interfaces:**
- Produces: `Settings` struct gains these fields (all `#[serde(default)]` unless noted), consumed by Task 2 (process.rs reads `whatsapp_port`/`whatsapp_auto_start`/`whatsapp_gowa_path`) and Task 6 (mod.rs reads/writes all of them):
  - `pub whatsapp_enabled: bool`
  - `pub whatsapp_port: u16` — `#[serde(default = "default_whatsapp_port")]`, default `47823` (same default as Mac's `WhatsAppSettings.defaultPort`)
  - `pub whatsapp_mute_groups: bool` — `#[serde(default = "default_true")]` (reuse the existing `default_true` helper already in this file)
  - `pub whatsapp_mark_read_on_open: bool` — `#[serde(default = "default_true")]`
  - `pub whatsapp_auto_start: bool`
  - `pub whatsapp_gowa_path: String`
  - `pub whatsapp_ignored: Vec<String>`

- [ ] **Step 1: Add the `zip` dependency**

In `windows/src-tauri/Cargo.toml`, add this line under `[dependencies]`, right after `mail-parser = "1.0.0"`:

```toml
zip = { version = "2", default-features = false, features = ["deflate"] }
```

- [ ] **Step 2: Write the failing test**

In `windows/src-tauri/src/settings.rs`, inside `mod tests` (find the existing `mail_watched_accounts_defaults_to_empty_and_round_trips` test and add this right after it):

```rust
    #[test]
    fn whatsapp_fields_default_and_round_trip() {
        let s = Settings::default_for_test();
        assert_eq!(s.whatsapp_enabled, false);
        assert_eq!(s.whatsapp_port, 47823);
        assert_eq!(s.whatsapp_mute_groups, true);
        assert_eq!(s.whatsapp_mark_read_on_open, true);
        assert_eq!(s.whatsapp_auto_start, false);
        assert_eq!(s.whatsapp_gowa_path, "");
        assert!(s.whatsapp_ignored.is_empty());

        let mut s2 = s.clone();
        s2.whatsapp_enabled = true;
        s2.whatsapp_port = 9000;
        s2.whatsapp_ignored = vec!["33612345678@s.whatsapp.net".to_string()];
        let json = serde_json::to_string(&s2).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.whatsapp_enabled, true);
        assert_eq!(back.whatsapp_port, 9000);
        assert_eq!(back.whatsapp_ignored, vec!["33612345678@s.whatsapp.net".to_string()]);
    }

    #[test]
    fn settings_json_missing_whatsapp_fields_still_loads() {
        // An older settings.json, written before this field existed.
        let json = r#"{"soundEnabled":true,"soundVolume":1.0,"autoCloseInterval":5.0,"absenceInterval":60.0,"activeIntegrations":[],"screen":"primary","autostart":false,"hooksInstalled":false}"#;
        let s: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(s.whatsapp_port, 47823);
        assert_eq!(s.whatsapp_mute_groups, true);
    }
```

Check the test helper name: search this file for how `load()`'s test builds a baseline `Settings` (grep for `fn default_for_test` or similar in the existing `mod tests` block). If no such helper exists, build the literal struct instead — copy the field list from the `impl Default for Settings` block (or wherever defaults are constructed, e.g. around line 474 where `mail_watched_accounts: Vec::new()` appears) and add the six new fields with their default values. Use whatever pattern the file already uses; do not introduce a new one.

- [ ] **Step 2b: Run test to verify it fails**

Run: `cd windows/src-tauri && cargo test whatsapp_fields_default_and_round_trip -- --nocapture`
Expected: FAIL with "no field `whatsapp_enabled` on type `Settings`" (compile error).

- [ ] **Step 3: Add the fields**

In `windows/src-tauri/src/settings.rs`, add right after the `mail_watched_accounts` field (around line 47):

```rust
    /// WhatsApp (GOWA gateway): on/off. URL and credential are secrets (see secrets.rs).
    #[serde(default)]
    pub whatsapp_enabled: bool,
    /// Local webhook listener port.
    #[serde(default = "default_whatsapp_port")]
    pub whatsapp_port: u16,
    #[serde(default = "default_true")]
    pub whatsapp_mute_groups: bool,
    #[serde(default = "default_true")]
    pub whatsapp_mark_read_on_open: bool,
    /// Start GOWA automatically when Coucou does (only when it's installed and the
    /// configured URL is loopback).
    #[serde(default)]
    pub whatsapp_auto_start: bool,
    /// Path to the GOWA binary Coucou installed, or one the user pointed at.
    #[serde(default)]
    pub whatsapp_gowa_path: String,
    /// Conversation ids (JIDs) hidden from the island.
    #[serde(default)]
    pub whatsapp_ignored: Vec<String>,
```

Then add the new default-value function near the file's other `fn default_*() -> ...` helpers (search for `fn default_model` or `fn default_true` to find where they live):

```rust
fn default_whatsapp_port() -> u16 {
    47823
}
```

Wherever the struct literal with `mail_watched_accounts: Vec::new()` is built (the function/const that produces the baseline `Settings`, e.g. `impl Default for Settings` or a `fn default_for_test()`), add the six fields in the same place with the same default values as above (`whatsapp_enabled: false`, `whatsapp_port: 47823`, `whatsapp_mute_groups: true`, `whatsapp_mark_read_on_open: true`, `whatsapp_auto_start: false`, `whatsapp_gowa_path: String::new()`, `whatsapp_ignored: Vec::new()`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd windows/src-tauri && cargo test whatsapp_fields_default_and_round_trip settings_json_missing_whatsapp_fields_still_loads -- --nocapture`
Expected: PASS, both tests.

Run: `cd windows/src-tauri && cargo build 2>&1 | tail -30`
Expected: builds clean (confirms the `zip` dependency resolves).

- [ ] **Step 5: Commit**

```bash
git add windows/src-tauri/Cargo.toml windows/src-tauri/Cargo.lock windows/src-tauri/src/settings.rs
git commit -m "whatsapp: add Settings fields and the zip dependency"
```

---

### Task 2: `webhook.rs` — real local HTTP listener

**Files:**
- Modify: `windows/src-tauri/src/whatsapp/webhook.rs`
- Test: inline `#[cfg(test)]` in the same file

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (consumed by Task 6):
  ```rust
  pub struct Request {
      pub method: String,
      pub path: String,
      pub headers: std::collections::HashMap<String, String>, // lower-cased keys
      pub body: Vec<u8>,
  }

  pub struct Listener {
      pub fn new() -> Self;
      /// Starts listening on 127.0.0.1:port. Returns false if the port is taken or invalid.
      /// `on_request` is called for each complete request; its return value is the HTTP
      /// status code to answer with.
      pub async fn start(&mut self, port: u16, on_request: impl Fn(Request) -> u16 + Send + Sync + 'static) -> bool;
      pub fn stop(&mut self);
  }
  ```

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `windows/src-tauri/src/whatsapp/webhook.rs` with:

```rust
// Local HTTP listener for the WhatsApp gateway's webhook: bound to 127.0.0.1 only, parses
// one request per connection, hands it to the caller, closes. No HTTP framework — tokio's
// own TcpListener is enough for one POST route, same approach as the Mac's hand-rolled
// NWListener parser (WhatsAppWebhook.swift).

use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout, Duration};

const MAX_BODY: usize = 1_000_000; // 1 MB cap — a webhook payload is small.
const IDLE_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub struct Listener {
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Listener {
    pub fn new() -> Self {
        Self { stop_tx: None }
    }

    pub async fn start<F>(&mut self, port: u16, on_request: F) -> bool
    where
        F: Fn(Request) -> u16 + Send + Sync + 'static,
    {
        self.stop();
        if port == 0 {
            return false;
        }
        let listener = match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(l) => l,
            Err(_) => return false,
        };
        let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
        self.stop_tx = Some(stop_tx);
        let handler = Arc::new(on_request);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    accepted = listener.accept() => {
                        let Ok((stream, peer)) = accepted else { continue };
                        if !peer.ip().is_loopback() {
                            continue;
                        }
                        let handler = handler.clone();
                        tokio::spawn(async move {
                            let _ = serve(stream, handler).await;
                        });
                    }
                }
            }
        });
        true
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
    }
}

async fn serve<F>(mut stream: TcpStream, handler: Arc<F>) -> std::io::Result<()>
where
    F: Fn(Request) -> u16 + Send + Sync + 'static,
{
    let result = timeout(IDLE_TIMEOUT, read_request(&mut stream)).await;
    let status = match result {
        Ok(Ok(req)) => handler(req),
        Ok(Err(_)) => 400,
        Err(_) => 400, // timed out
    };
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).await?;
    Ok(())
}

async fn read_request(stream: &mut TcpStream) -> std::io::Result<Request> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "closed"));
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_header_end(&buf) {
            break pos;
        }
        if buf.len() > MAX_BODY {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "headers too large"));
        }
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split(' ');
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    if method.is_empty() || path.is_empty() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "bad request line"));
    }

    let mut headers = HashMap::new();
    let mut content_length = 0usize;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_lowercase();
            let val = v.trim().to_string();
            if key == "content-length" {
                content_length = val.parse().unwrap_or(0);
            }
            headers.insert(key, val);
        }
    }
    if content_length > MAX_BODY {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "body too large"));
    }

    let body_start = header_end + 4; // past "\r\n\r\n"
    let mut body = buf[body_start.min(buf.len())..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);

    Ok(Request { method, path, headers, body })
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt as _;
    use tokio::net::TcpStream as ClientStream;

    async fn free_port() -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    }

    #[tokio::test]
    async fn responds_200_for_a_well_formed_post_and_runs_the_handler() {
        let port = free_port().await;
        let mut listener = Listener::new();
        let got = std::sync::Arc::new(std::sync::Mutex::new(None));
        let got2 = got.clone();
        assert!(listener.start(port, move |req| {
            *got2.lock().unwrap() = Some((req.method.clone(), req.path.clone(), req.body.clone()));
            200
        }).await);

        tokio::time::sleep(Duration::from_millis(50)).await;
        let mut client = ClientStream::connect(("127.0.0.1", port)).await.unwrap();
        let request = b"POST /whatsapp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 5\r\n\r\nhello";
        client.write_all(request).await.unwrap();
        let mut resp = Vec::new();
        use tokio::io::AsyncReadExt as _;
        let _ = tokio::time::timeout(Duration::from_secs(2), client.read_to_end(&mut resp)).await;
        assert!(String::from_utf8_lossy(&resp).starts_with("HTTP/1.1 200 OK"));

        tokio::time::sleep(Duration::from_millis(50)).await;
        let captured = got.lock().unwrap().clone().unwrap();
        assert_eq!(captured.0, "POST");
        assert_eq!(captured.1, "/whatsapp");
        assert_eq!(captured.2, b"hello");
        listener.stop();
    }

    #[tokio::test]
    async fn rejects_unknown_path_with_the_handlers_status() {
        let port = free_port().await;
        let mut listener = Listener::new();
        assert!(listener.start(port, |_req| 404).await);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let mut client = ClientStream::connect(("127.0.0.1", port)).await.unwrap();
        client.write_all(b"GET /nope HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n").await.unwrap();
        let mut resp = Vec::new();
        use tokio::io::AsyncReadExt as _;
        let _ = tokio::time::timeout(Duration::from_secs(2), client.read_to_end(&mut resp)).await;
        assert!(String::from_utf8_lossy(&resp).starts_with("HTTP/1.1 404 Not Found"));
        listener.stop();
    }

    #[tokio::test]
    async fn two_listeners_cannot_bind_the_same_port() {
        let port = free_port().await;
        let mut a = Listener::new();
        assert!(a.start(port, |_| 200).await);
        tokio::time::sleep(Duration::from_millis(20)).await;
        let mut b = Listener::new();
        assert!(!b.start(port, |_| 200).await);
        a.stop();
    }

    #[test]
    fn find_header_end_locates_the_blank_line() {
        assert_eq!(find_header_end(b"GET / HTTP/1.1\r\nHost: x\r\n\r\nbody"), Some(25));
        assert_eq!(find_header_end(b"incomplete"), None);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd windows/src-tauri && cargo test --lib whatsapp::webhook -- --nocapture 2>&1 | tail -40`
Expected: compile error or FAIL — module content was just replaced, so this confirms the module compiles under test before checking `mod.rs` still builds (Step 3 wires it; for now the stub `pub struct Listener;` that `mod.rs` constructs via `webhook::Listener` will mismatch — that's expected and fixed in Task 6, not here). If `cargo test --lib` fails to build the whole crate because `mod.rs` still references the old `Listener::new()`/`.start()`/`.on_event()` API, that's fine for this task: run the narrower check instead:

Run: `cd windows/src-tauri && cargo test --lib whatsapp::webhook::tests -- --nocapture 2>&1 | tail -60`

If the whole-crate build error blocks even this, temporarily comment out the two lines in `mod.rs` that reference `webhook::Listener` (search for `webhook::` in `mod.rs` — there should be none yet, since `webhook.rs`'s old stub was never wired into `mod.rs`'s `Control` struct; confirm by grepping `grep -n webhook windows/src-tauri/src/whatsapp/mod.rs` — expect no matches). If there are truly no references yet, the crate builds fine and this concern doesn't apply.

- [ ] **Step 3: Confirm tests pass**

Run: `cd windows/src-tauri && cargo test --lib whatsapp::webhook -- --nocapture 2>&1 | tail -40`
Expected: PASS, all 4 tests (3 `tokio::test` + 1 plain `#[test]`).

- [ ] **Step 4: Commit**

```bash
git add windows/src-tauri/src/whatsapp/webhook.rs
git commit -m "whatsapp: implement the local webhook HTTP listener"
```

---

### Task 3: `provider.rs` — real GOWA HTTP client

**Files:**
- Modify: `windows/src-tauri/src/whatsapp/provider.rs`
- Modify: `windows/src-tauri/src/whatsapp/model.rs` (add `Message` fields the provider needs to construct, if missing — check first)
- Test: inline `#[cfg(test)]` in `provider.rs`, against a hand-rolled fixture server using `tokio::net::TcpListener` (no new dev-dependency)

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of Task 2).
- Produces (consumed by Task 6):
  ```rust
  pub enum WaError { NotLinked, TooLong, TooFast, Unreachable, Unauthorized, NeedsQr, Refused { detail: String }, Other { detail: String } }
  pub enum WaLink { NeedsQr, Connected { who: String } }
  pub struct Provider { pub fn new(base_url: String, api_key: Option<String>) -> Self; ... }
  impl Provider {
      pub async fn status(&self) -> Result<WaLink, WaError>;
      pub async fn qr_code(&self) -> Result<Option<(Vec<u8>, u32)>, WaError>; // (PNG bytes, valid_seconds)
      pub async fn register_webhook(&self, url: &str, secret: &str) -> Result<(), WaError>;
      pub async fn send(&self, chat: &str, text: &str) -> Result<Option<String>, WaError>;
  }
  ```

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `windows/src-tauri/src/whatsapp/provider.rs` with:

```rust
// HTTP provider: calls to the local GOWA gateway (go-whatsapp-web-multidevice, `whatsapp rest`,
// default port 3000). Auth: HTTP basic `user:pass` when the gateway was started with
// `--basic-auth`. Coucou works on one device, named "coucou", created if none exists.
// Ported from WhatsAppProvider.swift's GOWAProvider actor.

use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

#[derive(Clone, Debug, PartialEq)]
pub enum WaError {
    NotLinked,
    TooLong,
    TooFast,
    Unreachable,
    Unauthorized,
    NeedsQr,
    Refused { detail: String },
    Other { detail: String },
}

impl std::fmt::Display for WaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WaError::NotLinked => write!(f, "not linked"),
            WaError::TooLong => write!(f, "message too long"),
            WaError::TooFast => write!(f, "too fast"),
            WaError::Unreachable => write!(f, "gateway unreachable"),
            WaError::Unauthorized => write!(f, "unauthorized"),
            WaError::NeedsQr => write!(f, "needs QR"),
            WaError::Refused { detail } => write!(f, "refused: {detail}"),
            WaError::Other { detail } => write!(f, "error: {detail}"),
        }
    }
}
impl std::error::Error for WaError {}

#[derive(Debug, Clone, PartialEq)]
pub enum WaLink {
    NeedsQr,
    Connected { who: String },
}

#[derive(Clone)]
pub struct Provider {
    client: Client,
    base_url: String,
    api_key: Option<String>,
}

impl Provider {
    pub fn new(base_url: String, api_key: Option<String>) -> Self {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { client, base_url: base_url.trim_end_matches('/').to_string(), api_key }
    }

    fn auth_header(&self) -> Option<String> {
        let key = self.api_key.as_ref()?;
        if !key.contains(':') {
            return None;
        }
        Some(format!("Basic {}", base64::Engine::encode(&base64::engine::general_purpose::STANDARD, key.as_bytes())))
    }

    async fn call(&self, method: reqwest::Method, path: &str, json: Option<Value>) -> Result<(u16, Value), WaError> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method, &url);
        if let Some(h) = self.auth_header() {
            req = req.header("Authorization", h);
        }
        if let Some(body) = &json {
            req = req.json(body);
        }
        let resp = req.send().await.map_err(|_| WaError::Unreachable)?;
        let status = resp.status().as_u16();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        Ok((status, body))
    }

    fn error_code(body: &Value) -> Option<String> {
        body.get("code").and_then(|v| v.as_str()).map(|s| s.to_string())
    }

    fn check(status: u16, body: &Value) -> Result<(), WaError> {
        if status == 401 {
            if Self::error_code(body).as_deref() == Some("AUTHENTICATION_ERROR") {
                return Err(WaError::Unauthorized);
            }
            return Err(WaError::NotLinked);
        }
        if !(200..300).contains(&status) {
            return Err(WaError::Refused { detail: Self::error_code(body).unwrap_or_else(|| format!("HTTP {status}")) });
        }
        Ok(())
    }

    /// Finds the "coucou" device, or creates it. Returns its id and link state.
    async fn device(&self) -> Result<(String, WaLink), WaError> {
        let (status, body) = self.call(reqwest::Method::GET, "/devices", None).await?;
        Self::check(status, &body)?;
        if let Some(found) = Self::find_device(&body) {
            return Ok(found);
        }
        let (status, body) = self.call(reqwest::Method::POST, "/devices", Some(serde_json::json!({"device_id": "coucou"}))).await?;
        Self::check(status, &body)?;
        Ok(("coucou".to_string(), WaLink::NeedsQr))
    }

    fn find_device(body: &Value) -> Option<(String, WaLink)> {
        let results = body.get("results")?.as_array()?;
        let first = results.first()?;
        let id = first.get("device_id")?.as_str()?.to_string();
        let connected = first.get("connected").and_then(|v| v.as_bool()).unwrap_or(false);
        let phone = first.get("phone_number").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let link = if connected { WaLink::Connected { who: phone } } else { WaLink::NeedsQr };
        Some((id, link))
    }

    pub async fn status(&self) -> Result<WaLink, WaError> {
        Ok(self.device().await?.1)
    }

    pub async fn qr_code(&self) -> Result<Option<(Vec<u8>, u32)>, WaError> {
        let (id, _) = self.device().await?;
        let (status, body) = self.call(reqwest::Method::GET, &format!("/devices/{id}/login"), None).await?;
        if Self::error_code(&body).as_deref() == Some("ALREADY_LOGGED_IN") {
            return Ok(None);
        }
        Self::check(status, &body)?;
        let Some(qr_path) = body.get("results").and_then(|r| r.get("qr_link")).and_then(|v| v.as_str()) else {
            return Ok(None);
        };
        let seconds = body.get("results").and_then(|r| r.get("qr_duration")).and_then(|v| v.as_u64()).unwrap_or(30) as u32;
        let (png_status, png) = self.call_raw(reqwest::Method::GET, qr_path).await?;
        if png_status != 200 || !png.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            return Ok(None);
        }
        Ok(Some((png, (seconds * 2).saturating_sub(5).max(20))))
    }

    async fn call_raw(&self, method: reqwest::Method, path: &str) -> Result<(u16, Vec<u8>), WaError> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method, &url);
        if let Some(h) = self.auth_header() {
            req = req.header("Authorization", h);
        }
        let resp = req.send().await.map_err(|_| WaError::Unreachable)?;
        let status = resp.status().as_u16();
        let bytes = resp.bytes().await.map_err(|_| WaError::Unreachable)?;
        Ok((status, bytes.to_vec()))
    }

    pub async fn register_webhook(&self, url: &str, secret: &str) -> Result<(), WaError> {
        let (id, _) = self.device().await?;
        let (status, body) = self.call(
            reqwest::Method::PATCH,
            &format!("/devices/{id}/webhook"),
            Some(serde_json::json!({"webhook_url": url, "webhook_secret": secret, "webhook_events": "message"})),
        ).await?;
        Self::check(status, &body)
    }

    pub async fn send(&self, chat: &str, text: &str) -> Result<Option<String>, WaError> {
        let (status, body) = self.call(
            reqwest::Method::POST,
            "/send/message",
            Some(serde_json::json!({"phone": chat, "message": text})),
        ).await?;
        Self::check(status, &body)?;
        Ok(body.get("results").and_then(|r| r.get("message_id")).and_then(|v| v.as_str()).map(|s| s.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A tiny fixture HTTP server: answers whatever (status, json body) `response` says to
    /// every request, once. Returns the base URL to point a `Provider` at.
    async fn fixture(status: u16, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf).await;
                let resp = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(), body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    #[tokio::test]
    async fn status_reports_needs_qr_for_a_disconnected_device() {
        let base = fixture(200, r#"{"results":[{"device_id":"coucou","connected":false}]}"#).await;
        let p = Provider::new(base, None);
        assert_eq!(p.status().await.unwrap(), WaLink::NeedsQr);
    }

    #[tokio::test]
    async fn status_reports_connected_with_the_phone_number() {
        let base = fixture(200, r#"{"results":[{"device_id":"coucou","connected":true,"phone_number":"33612345678"}]}"#).await;
        let p = Provider::new(base, None);
        assert_eq!(p.status().await.unwrap(), WaLink::Connected { who: "33612345678".to_string() });
    }

    #[tokio::test]
    async fn unreachable_base_url_errors_as_unreachable() {
        let p = Provider::new("http://127.0.0.1:1".to_string(), None);
        assert_eq!(p.status().await.unwrap_err(), WaError::Unreachable);
    }

    #[tokio::test]
    async fn a_401_with_a_non_auth_code_means_not_linked() {
        let base = fixture(401, r#"{"code":"SOMETHING_ELSE"}"#).await;
        let p = Provider::new(base, None);
        assert_eq!(p.status().await.unwrap_err(), WaError::NotLinked);
    }

    #[tokio::test]
    async fn a_401_with_the_auth_code_means_unauthorized() {
        let base = fixture(401, r#"{"code":"AUTHENTICATION_ERROR"}"#).await;
        let p = Provider::new(base, None);
        assert_eq!(p.status().await.unwrap_err(), WaError::Unauthorized);
    }

    #[tokio::test]
    async fn send_returns_the_message_id() {
        let base = fixture(200, r#"{"results":{"message_id":"abc123"}}"#).await;
        let p = Provider::new(base, None);
        assert_eq!(p.send("33612345678@s.whatsapp.net", "hi").await.unwrap(), Some("abc123".to_string()));
    }
}
```

Add `base64 = "0.22"` usage check: `base64` is already a dependency in `Cargo.toml` (line 32) — confirm the import path above (`base64::Engine`, `base64::engine::general_purpose::STANDARD`) matches the installed version's API by running `cargo doc -p base64 --no-deps 2>&1 | head -5` or checking how `secrets.rs`/`sync.rs` already import `base64` in this codebase (grep `use base64` across `windows/src-tauri/src/`) and match that exact import style instead of guessing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd windows/src-tauri && cargo test --lib whatsapp::provider -- --nocapture 2>&1 | tail -60`
Expected: compiles (this file has no external dependents yet) and all 6 tests PASS already if the implementation above is correct — this task's "RED" step is really "does it compile," since the body isn't a placeholder. If any test fails, fix the implementation (most likely culprit: GOWA's actual JSON field names — cross-check against `recentMessages`/`device()` in `WhatsAppProvider.swift` lines 128–153 and adjust `find_device`/`qr_code` field names to match exactly, e.g. `qr_link` vs `qr_path`, `qr_duration` — the Swift source's `WAGOWA.device(data)`/`WAGOWA.qrPath(data)` helpers in `WhatsAppGateway.swift` are the ground truth for exact JSON keys; read that file's `WAGOWA` enum before trusting the field names guessed above).

- [ ] **Step 3: Confirm tests pass**

Run: `cd windows/src-tauri && cargo test --lib whatsapp::provider -- --nocapture 2>&1 | tail -60`
Expected: PASS, all 6 tests.

- [ ] **Step 4: Commit**

```bash
git add windows/src-tauri/src/whatsapp/provider.rs
git commit -m "whatsapp: implement the GOWA HTTP provider"
```

---

### Task 4: `process.rs` — GOWA process management

**Files:**
- Modify: `windows/src-tauri/src/whatsapp/process.rs`
- Test: inline `#[cfg(test)]`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (consumed by Task 6):
  ```rust
  pub fn working_dir() -> std::path::PathBuf; // platform::local_dir().join("GOWA")
  pub fn binary_name() -> &'static str; // "gowa.exe" on Windows, "gowa" elsewhere
  pub fn is_loopback_url(url: &str) -> bool; // host is 127.0.0.1 / localhost / ::1
  pub struct Process { pub fn new() -> Self; pub fn is_running(&self) -> bool; pub fn sync(&mut self, binary_path: &str, url: &str, credential: Option<&str>) -> bool; pub fn stop_now(&mut self); }
  ```

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `windows/src-tauri/src/whatsapp/process.rs` with:

```rust
// GOWA process management: start Coucou's own copy of GOWA as a child process, stop it, and
// decide whether it's even safe to start (loopback URL only). Ported from
// WhatsAppGOWAProcess.swift.

use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::process::{Child, Command};

pub fn working_dir() -> PathBuf {
    crate::platform::local_dir().join("GOWA")
}

#[cfg(windows)]
pub fn binary_name() -> &'static str {
    "gowa.exe"
}
#[cfg(not(windows))]
pub fn binary_name() -> &'static str {
    "gowa"
}

/// Only ever start a process pointed at this machine: an address elsewhere is someone
/// else's gateway, never something Coucou should spawn a process to reach.
pub fn is_loopback_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else { return false };
    matches!(parsed.host_str(), Some("127.0.0.1") | Some("localhost") | Some("::1"))
}

pub struct Process {
    child: Option<Child>,
    launched_with: Option<String>,
    last_start: Instant,
}

impl Process {
    pub fn new() -> Self {
        Self { child: None, launched_with: None, last_start: Instant::now() - Duration::from_secs(3600) }
    }

    pub fn is_running(&mut self) -> bool {
        match &mut self.child {
            Some(c) => matches!(c.try_wait(), Ok(None)),
            None => false,
        }
    }

    fn signature(binary_path: &str, url: &str, credential: Option<&str>) -> String {
        format!("{binary_path}\u{1F}{url}\u{1F}{}", credential.unwrap_or(""))
    }

    /// Starts (or restarts, if the signature changed) GOWA. Returns false when it can't run
    /// (binary missing, URL not loopback, or the process failed to spawn).
    pub fn sync(&mut self, binary_path: &str, url: &str, credential: Option<&str>) -> bool {
        if binary_path.is_empty() || !is_loopback_url(url) {
            self.stop_now();
            return false;
        }
        if !std::path::Path::new(binary_path).is_file() {
            self.stop_now();
            return false;
        }
        let sig = Self::signature(binary_path, url, credential);
        if self.is_running() {
            if self.launched_with.as_deref() == Some(sig.as_str()) {
                return true;
            }
            self.stop_now();
        } else if self.launched_with.as_deref() == Some(sig.as_str()) && self.last_start.elapsed() < Duration::from_secs(60) {
            return true; // retried too recently; wait out the minute like the Mac does
        }

        let dir = working_dir();
        if std::fs::create_dir_all(&dir).is_err() {
            return false;
        }
        let mut cmd = Command::new(binary_path);
        cmd.current_dir(&dir).env("APP_UI_ENABLED", "false");
        if let Some(cred) = credential {
            if cred.contains(':') {
                cmd.env("APP_BASIC_AUTH", cred);
            }
        }
        cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        match cmd.spawn() {
            Ok(child) => {
                self.child = Some(child);
                self.launched_with = Some(sig);
                self.last_start = Instant::now();
                true
            }
            Err(_) => false,
        }
    }

    pub fn stop_now(&mut self) {
        self.launched_with = None;
        if let Some(mut c) = self.child.take() {
            let _ = c.start_kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_hosts_are_recognized() {
        assert!(is_loopback_url("http://127.0.0.1:3000"));
        assert!(is_loopback_url("http://localhost:3000"));
        assert!(is_loopback_url("http://[::1]:3000"));
    }

    #[test]
    fn a_remote_host_is_not_loopback() {
        assert!(!is_loopback_url("http://example.com:3000"));
        assert!(!is_loopback_url("http://192.168.1.5:3000"));
        assert!(!is_loopback_url("not a url"));
    }

    #[test]
    fn sync_refuses_a_non_loopback_url_without_spawning() {
        let mut p = Process::new();
        assert!(!p.sync("/bin/true", "http://example.com:3000", None));
        assert!(!p.is_running());
    }

    #[test]
    fn sync_refuses_a_missing_binary() {
        let mut p = Process::new();
        assert!(!p.sync("/nonexistent/gowa", "http://127.0.0.1:3000", None));
    }

    #[test]
    fn binary_name_matches_the_platform() {
        #[cfg(windows)]
        assert_eq!(binary_name(), "gowa.exe");
        #[cfg(not(windows))]
        assert_eq!(binary_name(), "gowa");
    }
}
```

This needs the `url` crate for parsing, which is not yet a dependency. Add it: in `windows/src-tauri/Cargo.toml`, add `url = "2"` under `[dependencies]` (a transitive dependency of `reqwest` already, so this adds no new compiled code, just exposes it directly — confirm with `cargo tree -i url` after adding, expect to see it already present via reqwest).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd windows/src-tauri && cargo test --lib whatsapp::process -- --nocapture 2>&1 | tail -40`
Expected: compile error before `url = "2"` is added to `Cargo.toml`; add it, then re-run — expect PASS or a real logic failure to fix.

- [ ] **Step 3: Confirm tests pass**

Run: `cd windows/src-tauri && cargo test --lib whatsapp::process -- --nocapture 2>&1 | tail -40`
Expected: PASS, all 5 tests.

- [ ] **Step 4: Commit**

```bash
git add windows/src-tauri/Cargo.toml windows/src-tauri/Cargo.lock windows/src-tauri/src/whatsapp/process.rs
git commit -m "whatsapp: implement GOWA process management"
```

---

### Task 5: `install.rs` + `archive.rs` — GOWA installer

**Files:**
- Modify: `windows/src-tauri/src/whatsapp/install.rs`
- Modify: `windows/src-tauri/src/whatsapp/archive.rs`
- Test: inline `#[cfg(test)]` in both files (no live network calls in tests — use fixture bytes)

**Interfaces:**
- Consumes: `process::working_dir()`, `process::binary_name()` (Task 4).
- Produces (consumed by Task 6):
  ```rust
  // archive.rs
  pub fn extract(zip_bytes: &[u8], entry_suffix: &str) -> Option<Vec<u8>>; // finds the first entry whose name ends with entry_suffix

  // install.rs
  pub enum InstallError { NoBuildForThisPlatform, NoChecksum, DownloadFailed, BadChecksum, UnpackFailed, Network(String) }
  pub struct ReleaseAsset { pub name: String, pub download_url: String, pub size: u64 }
  pub fn pick_asset(assets: &[ReleaseAsset]) -> Option<&ReleaseAsset>; // platform+arch match, pure function, testable without network
  pub fn expected_sha256(asset_name: &str, checksums_txt: &str) -> Option<String>; // pure function, testable without network
  pub async fn install(progress: impl Fn(crate::whatsapp::InstallStep) + Send + 'static) -> Result<String, InstallError>; // returns installed version
  ```

- [ ] **Step 1: Write the failing tests for the pure, network-free functions**

Replace `windows/src-tauri/src/whatsapp/archive.rs` with:

```rust
// Minimal zip reading for GOWA's release archive: find one named entry, return its bytes.

pub fn extract(zip_bytes: &[u8], entry_suffix: &str) -> Option<Vec<u8>> {
    let reader = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader).ok()?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).ok()?;
        if file.name().ends_with(entry_suffix) {
            let mut out = Vec::new();
            std::io::Read::read_to_end(&mut file, &mut out).ok()?;
            return Some(out);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip(entry_name: &str, content: &[u8]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut writer = zip::ZipWriter::new(cursor);
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file(entry_name, options).unwrap();
            writer.write_all(content).unwrap();
            writer.finish().unwrap();
        }
        buf
    }

    #[test]
    fn extracts_the_entry_matching_the_suffix() {
        let zip = make_zip("whatsapp_9.8.0_windows_amd64/whatsapp.exe", b"fake binary bytes");
        let found = extract(&zip, "whatsapp.exe").unwrap();
        assert_eq!(found, b"fake binary bytes");
    }

    #[test]
    fn returns_none_when_nothing_matches() {
        let zip = make_zip("readme.txt", b"hello");
        assert!(extract(&zip, "whatsapp.exe").is_none());
    }

    #[test]
    fn returns_none_for_bytes_that_are_not_a_zip() {
        assert!(extract(b"not a zip file at all", "whatsapp.exe").is_none());
    }
}
```

Replace `windows/src-tauri/src/whatsapp/install.rs` with:

```rust
// GOWA install/update: downloads the latest release from GitHub, verifies its SHA-256
// against GOWA's own published checksums.txt, extracts the binary. Ported from
// WhatsAppGOWAInstaller.swift. GOWA repo: aldinokemal/go-whatsapp-web-multidevice.

use super::archive;
use std::time::Duration;

const RELEASES_API: &str = "https://api.github.com/repos/aldinokemal/go-whatsapp-web-multidevice/releases/latest";

#[derive(Debug, Clone, PartialEq)]
pub enum InstallError {
    NoBuildForThisPlatform,
    NoChecksum,
    DownloadFailed,
    BadChecksum,
    UnpackFailed,
    Network(String),
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InstallError::NoBuildForThisPlatform => write!(f, "no build for this platform"),
            InstallError::NoChecksum => write!(f, "no checksum published"),
            InstallError::DownloadFailed => write!(f, "download failed"),
            InstallError::BadChecksum => write!(f, "checksum mismatch"),
            InstallError::UnpackFailed => write!(f, "could not unpack the archive"),
            InstallError::Network(d) => write!(f, "network error: {d}"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ReleaseAsset {
    pub name: String,
    pub download_url: String,
    pub size: u64,
}

/// `whatsapp_<version>_<os>_<arch>.zip` — windows/amd64 or linux/amd64 only (the platforms
/// this app ships for; see Cargo.toml's `[target.'cfg(...)'.dependencies]` sections).
pub fn platform_suffix() -> &'static str {
    #[cfg(windows)]
    { "windows_amd64.zip" }
    #[cfg(all(unix, not(target_os = "macos")))]
    { "linux_amd64.zip" }
    #[cfg(target_os = "macos")]
    { "darwin_amd64.zip" } // not shipped on this platform, kept for completeness
}

pub fn pick_asset(assets: &[ReleaseAsset]) -> Option<&ReleaseAsset> {
    assets.iter().find(|a| a.name.ends_with(platform_suffix()))
}

/// `checksums.txt` is one `<sha256>  <filename>` line per asset (sha256sum format).
pub fn expected_sha256(asset_name: &str, checksums_txt: &str) -> Option<String> {
    checksums_txt.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == asset_name).then(|| hash.to_string())
    })
}

/// Extracts the version from a release name like "whatsapp_9.8.0_windows_amd64.zip" → "9.8.0".
pub fn version_from_asset_name(name: &str) -> Option<String> {
    name.strip_prefix("whatsapp_")?.split('_').next().map(|s| s.to_string())
}

pub async fn install(
    progress: impl Fn(crate::whatsapp::InstallStep) + Send + 'static,
) -> Result<String, InstallError> {
    progress(crate::whatsapp::InstallStep::Checking);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| InstallError::Network(e.to_string()))?;

    let release: serde_json::Value = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "coucou")
        .send()
        .await
        .map_err(|e| InstallError::Network(e.to_string()))?
        .json()
        .await
        .map_err(|e| InstallError::Network(e.to_string()))?;

    let assets: Vec<ReleaseAsset> = release
        .get("assets")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    Some(ReleaseAsset {
                        name: a.get("name")?.as_str()?.to_string(),
                        download_url: a.get("browser_download_url")?.as_str()?.to_string(),
                        size: a.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let picked = pick_asset(&assets).ok_or(InstallError::NoBuildForThisPlatform)?.clone();
    let checksums_asset = assets.iter().find(|a| a.name == "checksums.txt").ok_or(InstallError::NoChecksum)?;
    let checksums_txt = client
        .get(&checksums_asset.download_url)
        .header("User-Agent", "coucou")
        .send()
        .await
        .map_err(|e| InstallError::Network(e.to_string()))?
        .text()
        .await
        .map_err(|e| InstallError::Network(e.to_string()))?;
    let expected = expected_sha256(&picked.name, &checksums_txt).ok_or(InstallError::NoChecksum)?;

    progress(crate::whatsapp::InstallStep::Downloading { megabytes: (picked.size / 1_000_000).max(1) });
    let zip_bytes = client
        .get(&picked.download_url)
        .header("User-Agent", "coucou")
        .send()
        .await
        .map_err(|_| InstallError::DownloadFailed)?
        .bytes()
        .await
        .map_err(|_| InstallError::DownloadFailed)?;

    progress(crate::whatsapp::InstallStep::Verifying);
    let digest = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&zip_bytes);
        hex::encode(hasher.finalize())
    };
    if digest != expected {
        return Err(InstallError::BadChecksum);
    }

    progress(crate::whatsapp::InstallStep::Installing);
    let binary_bytes = archive::extract(&zip_bytes, super::process::binary_name())
        .ok_or(InstallError::UnpackFailed)?;
    let dir = super::process::working_dir();
    std::fs::create_dir_all(&dir).map_err(|_| InstallError::UnpackFailed)?;
    let dest = dir.join(super::process::binary_name());
    std::fs::write(&dest, &binary_bytes).map_err(|_| InstallError::UnpackFailed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    }

    let version = version_from_asset_name(&picked.name).unwrap_or_else(|| "unknown".to_string());
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> ReleaseAsset {
        ReleaseAsset { name: name.to_string(), download_url: format!("https://example.com/{name}"), size: 12_000_000 }
    }

    #[test]
    fn picks_the_asset_for_this_platform() {
        let assets = vec![
            asset("whatsapp_9.8.0_darwin_amd64.zip"),
            asset("whatsapp_9.8.0_linux_amd64.zip"),
            asset("whatsapp_9.8.0_windows_amd64.zip"),
            asset("checksums.txt"),
        ];
        let picked = pick_asset(&assets).unwrap();
        assert!(picked.name.ends_with(platform_suffix()));
    }

    #[test]
    fn returns_none_when_no_asset_matches() {
        let assets = vec![asset("whatsapp_9.8.0_darwin_arm64.zip")];
        assert!(pick_asset(&assets).is_none());
    }

    #[test]
    fn finds_the_matching_checksum_line() {
        let checksums = "aabbcc  whatsapp_9.8.0_windows_amd64.zip\nddeeff  whatsapp_9.8.0_linux_amd64.zip\n";
        assert_eq!(expected_sha256("whatsapp_9.8.0_windows_amd64.zip", checksums), Some("aabbcc".to_string()));
        assert_eq!(expected_sha256("whatsapp_9.8.0_linux_amd64.zip", checksums), Some("ddeeff".to_string()));
        assert_eq!(expected_sha256("whatsapp_9.8.0_darwin_amd64.zip", checksums), None);
    }

    #[test]
    fn checksum_lines_may_have_a_leading_binary_marker_asterisk() {
        let checksums = "aabbcc *whatsapp_9.8.0_windows_amd64.zip\n";
        assert_eq!(expected_sha256("whatsapp_9.8.0_windows_amd64.zip", checksums), Some("aabbcc".to_string()));
    }

    #[test]
    fn extracts_the_version_from_the_asset_name() {
        assert_eq!(version_from_asset_name("whatsapp_9.8.0_windows_amd64.zip"), Some("9.8.0".to_string()));
        assert_eq!(version_from_asset_name("garbage.zip"), None);
    }
}
```

This needs the `hex` crate (not yet a dependency — `sha2` gives raw bytes, and the rest of the codebase's SHA-256 usage should be checked first: grep `sha2::Sha256` usage elsewhere in `src-tauri/src/` for how this project already formats a digest as a hex string, e.g. in `secrets.rs` or `sync.rs`; reuse that exact pattern — a manual `format!("{:02x}", b)` fold, matching `profile.rs`'s own `default_profile_dir` neighbor pattern, is likely already used and needs no new dependency). If no existing hex-formatting helper is found, add this instead of the `hex` crate (zero new dependencies):

```rust
    let digest = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&zip_bytes);
        hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect::<String>()
    };
```

Use whichever of the two forms matches existing codebase convention; do not add the `hex` crate if a manual fold is already the pattern elsewhere.

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd windows/src-tauri && cargo test --lib whatsapp::archive whatsapp::install -- --nocapture 2>&1 | tail -60`
Expected: PASS for all pure-function tests (`extract`, `pick_asset`, `expected_sha256`, `version_from_asset_name`). The `install()` async function itself has no unit test here (it needs live network — covered by manual testing per the spec's Testing section), but it must compile.

- [ ] **Step 3: Commit**

```bash
git add windows/src-tauri/src/whatsapp/archive.rs windows/src-tauri/src/whatsapp/install.rs
git commit -m "whatsapp: implement the GOWA installer (download, verify, unzip)"
```

---

### Task 6: `mod.rs` — wire it all together

**Files:**
- Modify: `windows/src-tauri/src/whatsapp/mod.rs`
- Modify: `windows/src-tauri/src/whatsapp/prefs.rs`
- Modify: wherever `Settings` is loaded/saved into the app's runtime state at startup and whatsapp's `start(app, active_integrations)` is called (grep `whatsapp::start\(` across `windows/src-tauri/src/` — likely `lib.rs` or `main.rs` — read that call site before changing it)
- Test: inline `#[cfg(test)]` in `mod.rs`

**Interfaces:**
- Consumes: `webhook::Listener` (Task 2), `provider::Provider`/`WaLink`/`WaError` (Task 3), `process::Process`/`working_dir`/`binary_name` (Task 4), `install::install`/`InstallError` (Task 5), `Settings.whatsapp_*` fields (Task 1).
- Produces: nothing further downstream in Rust — Task 7 (TS) only consumes the existing Tauri command signatures, which do not change shape (only their bodies, already stubbed-but-typed, become real).

- [ ] **Step 1: Read the real `WhatsAppController.swift` sections this task ports**

Before writing code, re-read `NotchBuddy/Sources/App/WhatsAppController.swift` lines 173–420 (`start()`, `settingsChanged()`, `update()`, `begin()`, `stop()`, `onTick()`, `poll()`, `startListener()`, `register()`, `received()`, `backfill()`) — this task ports that control flow, and guessing it from memory risks drifting from the proven behavior. Pay specific attention to: the 5-tick poll gate (`tick % 4 == 0`) and the `webhookAlive` 300-second window — both are easy to get backwards.

- [ ] **Step 2: Rewrite `prefs.rs` to route through `Settings`**

Replace `windows/src-tauri/src/whatsapp/prefs.rs` with:

```rust
// WhatsApp preferences live on the app's main Settings struct (settings.rs) — same
// persistence as every other non-secret setting, no separate file.

#[derive(Clone, Debug, Default)]
pub struct Prefs {
    pub enabled: bool,
    pub mute_groups: bool,
    pub mark_read_on_open: bool,
    pub port: u16,
    pub auto_start: bool,
    pub gowa_path: String,
    pub ignored: Vec<String>,
}

impl Prefs {
    pub fn cleaned(mut self) -> Self {
        self.ignored.sort_unstable();
        self.ignored.dedup();
        self
    }

    pub fn from_settings(s: &crate::settings::Settings) -> Self {
        Self {
            enabled: s.whatsapp_enabled,
            mute_groups: s.whatsapp_mute_groups,
            mark_read_on_open: s.whatsapp_mark_read_on_open,
            port: s.whatsapp_port,
            auto_start: s.whatsapp_auto_start,
            gowa_path: s.whatsapp_gowa_path.clone(),
            ignored: s.whatsapp_ignored.clone(),
        }
    }

    pub fn write_into(&self, s: &mut crate::settings::Settings) {
        s.whatsapp_enabled = self.enabled;
        s.whatsapp_mute_groups = self.mute_groups;
        s.whatsapp_mark_read_on_open = self.mark_read_on_open;
        s.whatsapp_port = self.port;
        s.whatsapp_auto_start = self.auto_start;
        s.whatsapp_gowa_path = self.gowa_path.clone();
        s.whatsapp_ignored = self.ignored.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleaned_sorts_and_dedupes_ignored() {
        let p = Prefs { ignored: vec!["b".into(), "a".into(), "a".into()], ..Default::default() };
        assert_eq!(p.cleaned().ignored, vec!["a".to_string(), "b".to_string()]);
    }
}
```

- [ ] **Step 3: Rewrite `mod.rs`'s runtime wiring**

In `windows/src-tauri/src/whatsapp/mod.rs`, keep every existing type (`LinkState`, `WebhookState`, `SendError`, `IslandView`, `SettingsView`, `InstallStep`, `TestResult`, etc.) and every existing `#[tauri::command]` signature exactly as they are — do not rename any of them, since Task 7's TS calls them by name. Change `LinkState::NeedsQr` from a unit variant to carry data (per the spec's Component section for `core/whatsapp.ts`):

```rust
pub enum LinkState {
    Off,
    BadUrl,
    Connecting,
    NeedsQr { png_base64: String },
    Connected,
    Unreachable,
    Unauthorized,
    Failed { detail: String },
}
```

Change the `Control` struct's fields to hold the real pieces:

```rust
struct Control {
    link: LinkState,
    webhook: WebhookState,
    url: String,
    has_credential: bool,
    prefs: Prefs,
    inbox: Inbox,
    provider: Option<provider::Provider>,
    process: process::Process,
    listener: webhook::Listener,
    webhook_secret: String,
    last_webhook: Option<std::time::Instant>,
    tick: u32,
    generation: u64,
}
```

Remove the `provider: OnceLock<Provider>` field and its two uses (`ctl().provider.get()` in `whatsapp_send` and `test_connection`) — replace each `.get()` call with `.as_ref()` against the new `Option<provider::Provider>` field, same error message ("not connected"/"not configured") on `None`.

Rewrite `pub fn start(app: &AppHandle, active_integrations: &[String])`:

```rust
pub fn start(app: &AppHandle, active_integrations: &[String]) {
    if !active_integrations.contains(&PILL_ID.to_string()) {
        return;
    }
    let settings = crate::settings::load();
    {
        let mut c = ctl();
        c.prefs = Prefs::from_settings(&settings);
        c.url = crate::secrets::get(URL_KEY).unwrap_or_default();
        c.has_credential = crate::secrets::get(CREDENTIAL_KEY).map(|v| !v.trim().is_empty()).unwrap_or(false);
        c.webhook_secret = webhook_secret();
        if !c.prefs.enabled {
            return;
        }
    }
    begin(app);
}

fn webhook_secret() -> String {
    if let Some(s) = crate::secrets::get(SECRET_KEY) {
        if s.len() >= 16 {
            return s;
        }
    }
    let mut bytes = [0u8; 32];
    for b in bytes.iter_mut() {
        *b = (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos() ^ rand_byte()) as u8;
    }
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let _ = crate::secrets::set_internal(SECRET_KEY, &hex);
    hex
}

fn rand_byte() -> u32 {
    // No `rand` crate dependency for one random value: seed from the address of a fresh
    // allocation, which ASLR already randomizes per run — good enough for a local-only
    // webhook signing secret that only needs to differ from a guess, not be
    // cryptographically perfect across the app's lifetime (it's regenerated if ever lost).
    let x = Box::new(0u8);
    (&*x as *const u8 as usize as u32).wrapping_mul(2654435761)
}
```

Note on `rand_byte`: before writing this, grep the codebase for an existing random-bytes helper (`grep -rn "fn random\|rand::" windows/src-tauri/src/` ) — `sync.rs` almost certainly already generates random bytes for encryption nonces (`aes-gcm` needs them). If one exists, reuse it instead of the ASLR trick above; do not add the `rand` crate if the project already has an in-house helper, and do not invent a second weak RNG if a good one already exists in this codebase.

Rewrite `begin`, `stop`, `on_tick` (replacing the Swift `Timer`/`onTick`/`poll`/`wake` logic), `register`, `received`, and the Tauri commands' bodies that touch `provider`/`process`/`listener`. Mirror this control flow exactly (from `WhatsAppController.swift`):

```rust
fn begin(app: &AppHandle) {
    let (url, has_cred, generation) = {
        let mut c = ctl();
        if !url::Url::parse(&c.url).is_ok() {
            c.link = LinkState::BadUrl;
            drop(c);
            changed(app);
            return;
        }
        c.generation += 1;
        c.link = LinkState::Connecting;
        (c.url.clone(), c.has_credential, c.generation)
    };
    let credential = has_cred.then(|| crate::secrets::get(CREDENTIAL_KEY)).flatten();
    {
        let mut c = ctl();
        c.provider = Some(provider::Provider::new(url.clone(), credential.clone()));
    }
    start_listener(app, generation);
    {
        let mut c = ctl();
        let gowa_path = c.prefs.gowa_path.clone();
        let auto_start = c.prefs.auto_start;
        if auto_start {
            c.process.sync(&gowa_path, &url, credential.as_deref());
        }
    }
    changed(app);
    settings_changed(app);
    refresh(app, generation);
}

fn start_listener(app: &AppHandle, generation: u64) {
    let port = ctl().prefs.port;
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let started = {
            let mut c = ctl();
            c.listener.start(port, move |req| {
                handle_webhook_request(&app2, generation, req)
            }).await
        };
        let mut c = ctl();
        if c.generation == generation {
            c.webhook = if started { WebhookState::Listening } else { WebhookState::PortBusy { port } };
        }
        drop(c);
        settings_changed(&app2);
    });
}

fn handle_webhook_request(app: &AppHandle, generation: u64, req: webhook::Request) -> u16 {
    if req.method != "POST" || !req.path.starts_with(WEBHOOK_PATH) {
        return 404;
    }
    let secret = ctl().webhook_secret.clone();
    // Gateways sign the body; exact header name follows GOWA's webhook docs. GOWA signs with
    // a header the gateway's own config names (set via register_webhook's webhook_secret
    // field) — verify by comparing the body against a value the gateway is configured to
    // send back, mirroring Mac's WAWebhook.verify(kind:headers:body:secret:). If GOWA's
    // webhook payload includes the secret in the JSON body itself rather than a header
    // (check a real captured payload during manual testing), compare that field instead of
    // a header — do not ship this unverified against the real gateway.
    if !verify_webhook(&req, &secret) {
        return 401;
    }
    let mut c = ctl();
    if c.generation != generation {
        return 200;
    }
    c.last_webhook = Some(std::time::Instant::now());
    if c.webhook != WebhookState::Registered {
        c.webhook = WebhookState::Registered;
    }
    drop(c);
    on_message(app);
    200
}

fn verify_webhook(req: &webhook::Request, secret: &str) -> bool {
    // GOWA's webhook_secret is echoed back; exact mechanism to confirm against a real
    // payload during manual testing (see spec's Testing section).
    req.headers.get("x-hub-signature").map(|s| s.contains(secret)).unwrap_or(!secret.is_empty())
}
```

Flag `verify_webhook` and the signing-header assumption inside it explicitly in this task's completion report — it is a best-effort port of a detail the Mac's `WAWebhook.verify()` (in `WhatsAppGateway.swift`) implements precisely; read that function and replace the body above with its exact logic rather than the placeholder comparison shown here, which is almost certainly wrong as written and exists only to keep the file compiling while the task is drafted.

Rewrite `on_tick` for the controller's refresh loop (called from a `tauri::async_runtime::spawn` 5-second interval loop started once at app launch — find where `AppHandle` already runs a periodic timer for another feature, e.g. the mail watcher's poll loop in `mail/watch.rs`, and mirror that exact scheduling mechanism rather than inventing a new one):

```rust
fn on_tick(app: &AppHandle, generation: u64) {
    let mut c = ctl();
    if c.generation != generation || c.provider.is_none() {
        return;
    }
    c.tick += 1;
    let webhook_alive = c.last_webhook.map(|t| t.elapsed() < std::time::Duration::from_secs(300)).unwrap_or(false);
    let should_refresh = c.tick % 12 == 0;
    let should_poll = c.tick % 4 == 0 && !webhook_alive;
    drop(c);
    if should_refresh {
        refresh(app, generation);
    }
    if should_poll {
        poll(app, generation);
    }
}
```

`refresh` calls `provider.status()`, updates `link`, fetches the QR on `NeedsQr` via `provider.qr_code()` (base64-encode with the already-present `base64` dependency), and calls `register()` (which calls `provider.register_webhook()`) once `webhook == Listening`. `poll` calls `provider.recent_messages` equivalent — note `recent_messages`/`messages` were **not** added to `provider.rs` in Task 3's interface list above because the spec's backfill requirement is a "recent window, not full history" nicety; if Task 3's reviewer or this task's implementer finds the full poll loop needs them, add `recent_messages(&self, since: SystemTime) -> Result<Vec<Message>, WaError>` to `provider.rs` as part of this task (not a new task) — port it from `WhatsAppProvider.swift` lines 181–197, following the same `/chat/{id}/messages` pattern already proven in `messages()`'s sibling calls in Task 3.

- [ ] **Step 4: Update the existing unit test and add new ones**

The existing test in `mod.rs`:

```rust
    #[test]
    fn pill_id_is_whatsapp() {
        assert_eq!(PILL_ID, "integration_whatsapp");
    }
```

stays as-is. Add:

```rust
    #[test]
    fn webhook_secret_persists_across_calls() {
        // Needs crate::secrets to be mockable or this test run in isolation; if secrets.rs
        // has no test seam, skip persistence and test only the length/format invariant:
        let a = super::webhook_secret();
        assert_eq!(a.len(), 64); // 32 bytes, hex
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }
```

- [ ] **Step 5: Wire `start()` into app launch**

Find the existing call site: `grep -rn "whatsapp::start" windows/src-tauri/src/`. Confirm it already passes `active_integrations` from loaded settings at startup — if it does, no change needed there. If `start()`'s new body (Step 3) now needs the app to have already loaded `Settings` before this call, confirm ordering in that call site; reorder only if genuinely necessary, and say so explicitly in the task report (don't silently restructure startup order without flagging it).

- [ ] **Step 6: Build and test**

Run: `cd windows/src-tauri && cargo build 2>&1 | tail -60`
Expected: builds clean. Fix any type errors from the `LinkState::NeedsQr` shape change rippling into other match arms in this file.

Run: `cd windows/src-tauri && cargo test --lib whatsapp -- --nocapture 2>&1 | tail -80`
Expected: PASS, every test across all `whatsapp::*` modules (archive, install, mod, prefs, process, provider, webhook).

- [ ] **Step 7: Commit**

```bash
git add windows/src-tauri/src/whatsapp/mod.rs windows/src-tauri/src/whatsapp/prefs.rs
git commit -m "whatsapp: wire provider, process, listener and installer together"
```

---

### Task 7: Settings UI + Integraciones picker entry

**Files:**
- Modify: `windows/src/settings/main.ts`
- Modify: `windows/src/core/whatsapp.ts`
- Modify: `windows/tsconfig.test.json` (only if a new test file is added — check Step 4 below)

**Interfaces:**
- Consumes: Tauri commands already defined in `mod.rs` (unchanged signatures): `whatsapp_settings`, `whatsapp_set_options(enabled, mute_groups, mark_read_on_open)`, `whatsapp_save_gateway(gateway, url, credential, port, auto_start, gowa_path)`, `whatsapp_test`, `whatsapp_install`. The `WhatsAppLinkState` TS type needs its `needsQr` variant updated to match Task 6's Rust change.
- Produces: nothing further downstream.

- [ ] **Step 1: Update `core/whatsapp.ts`'s `needsQr` shape**

In `windows/src/core/whatsapp.ts`, change:

```ts
export type WhatsAppLinkState =
  | "off"
  | "badUrl"
  | "connecting"
  | "needsQr"
  | "connected"
  | "unreachable"
  | "unauthorized"
  | { failed: { detail: string } };
```

to:

```ts
export type WhatsAppLinkState =
  | "off"
  | "badUrl"
  | "connecting"
  | { needsQr: { pngBase64: string } }
  | "connected"
  | "unreachable"
  | "unauthorized"
  | { failed: { detail: string } };
```

This matches `#[serde(tag = "state", rename_all = "camelCase")]` on `LinkState` in `mod.rs` — the Rust field `png_base64` serializes as `pngBase64`. Find every place in `windows/src/` that currently matches on the bare string `"needsQr"` (`grep -rn '"needsQr"' windows/src`) and update each to match the new object shape instead (likely in `views/whatsapp.ts` and/or `settings/main.ts` once this task adds the settings section — check both).

- [ ] **Step 2: Add the picker entry**

In `windows/src/settings/main.ts`, in the `INTEGRATIONS` array (the one Mail was added to earlier this session), add:

```ts
  { id: "integration_whatsapp", name: "WhatsApp", color: "#25D366", fields: [] },
```

Place it in the array wherever fits the existing ordering (adjacent entries, no strong convention to match beyond "near Mail" for discoverability).

- [ ] **Step 3: Add the WhatsApp settings section**

Find `mailSection()` in `windows/src/settings/main.ts` (added for the Mail feature) and the sidebar wiring that shows it under a "Correo" nav entry — this task mirrors that exact structure. Add a sidebar entry "WhatsApp" and a `whatsappSection(): HTMLElement` function with:

- A toggle bound to `whatsapp_set_options` (enabled).
- A URL field + credential field + port field, saved via `whatsapp_save_gateway` (gateway hardcoded to the string `"gowa"` — do not expose a gateway picker, OpenWA is out of scope per the spec).
- A "Instalar GOWA" button bound to `whatsapp_install`, showing live progress text driven by the `whatsapp-settings` event (`Bridge.onEvent` or whatever the existing event-subscription helper is called — check `mailSection()`'s own event subscription for the exact pattern and mirror it, e.g. how it listens for `SETTINGS_EVENT`).
- A "Probar conexión" button bound to `whatsapp_test`, showing the `TestResult`.
- A QR `<img>` element, shown only when the live `SettingsView`'s (or the island's `IslandView.link`, whichever this component actually receives — check `whatsapp_settings`'s return type in `mod.rs` before assuming) state is `{ needsQr: { pngBase64 } }`: `src="data:image/png;base64," + pngBase64`.
- Toggles for mute groups / mark read on open.

Write the actual function body following `mailSection()`'s structure field-for-field (same `h()` DOM helper, same button/toggle/field patterns, same Bridge call conventions) — do not invent new UI primitives; this file already has everything needed.

- [ ] **Step 4: Type-check**

Run: `cd windows && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -40`
Expected: clean. Fix any type errors from the `needsQr` shape change or the new section.

If this task added a new file (e.g. split `whatsappSection()` into its own `settings/whatsapp.ts` rather than growing `main.ts` further — reasonable if `main.ts` is already large; check its current line count with `wc -l windows/src/settings/main.ts` and decide), register that new file's test-relevant exports in `windows/tsconfig.test.json`'s `"files"` array, exactly as Mail's Task 10 required for `src/views/mail.ts`/`src/views/mailcode.ts` — this was a real gap the Mail plan initially missed; don't repeat it here.

- [ ] **Step 5: Commit**

```bash
git add windows/src/settings/main.ts windows/src/core/whatsapp.ts windows/tsconfig.test.json
git commit -m "whatsapp: add Settings UI section and Integraciones picker entry"
```

---

## Final Integration Check (not a task — run after Task 7, before the final whole-branch review)

```bash
cd windows/src-tauri && cargo test 2>&1 | tail -20
cd windows && npx tsc --noEmit -p tsconfig.json && npx tsc -p tsconfig.test.json && node --test .test-build/**/*.test.js 2>&1 | tail -40
cd windows/src-tauri && cargo build 2>&1 | tail -30
```

Manual test (gates shipping a version, not merging — same caveat as the Mail feature): install GOWA via the new Settings button, scan the real QR with a real phone, send a message from the phone, confirm it appears in the island within a few seconds (webhook) or 20s (poll fallback), reply from Coucou, confirm it arrives on the phone.
