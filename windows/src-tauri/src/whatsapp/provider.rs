// HTTP provider: calls to the local GOWA gateway (go-whatsapp-web-multidevice, `whatsapp rest`,
// default port 3000). Auth: HTTP basic `user:pass` when the gateway was started with
// `--basic-auth`. Coucou works on one device, named "coucou", created if none exists.
// Ported from WhatsAppProvider.swift's GOWAProvider actor; JSON field names verified against
// WhatsAppGateway.swift's WAGOWA enum (device/qrPath/errorCode/results), the Mac's own
// ground-truth parsing of this same GOWA API.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
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
        Some(format!("Basic {}", B64.encode(key.as_bytes())))
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

    fn error_code(body: &Value) -> Option<String> {
        body.get("code").and_then(|v| v.as_str()).map(|s| s.to_string())
    }

    fn check(status: u16, body: &Value) -> Result<(), WaError> {
        if status == 401 {
            if Self::error_code(body).as_deref() == Some("AUTHENTICATION_ERROR") {
                return Err(WaError::NotLinked);
            }
            return Err(WaError::Unauthorized);
        }
        if !(200..300).contains(&status) {
            return Err(WaError::Refused { detail: Self::error_code(body).unwrap_or_else(|| format!("HTTP {status}")) });
        }
        Ok(())
    }

    /// Finds the "coucou" device, or creates it. Returns its id and link state.
    ///
    /// `GET /devices` -> `results: [{id, phone_number, display_name, state, jid, created_at}]`
    /// (ground truth: WAGOWA.device(_:) in WhatsAppGateway.swift — NOT `device_id`/`connected`,
    /// which was the brief's unverified guess). A device is linked when `state == "logged_in"`;
    /// `jid` is then the account identity GOWA reports back as "who".
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
        if results.is_empty() {
            return None;
        }
        // Prefer an already logged-in device, like the Mac does, else the first one.
        let pick = results
            .iter()
            .find(|d| d.get("state").and_then(|v| v.as_str()) == Some("logged_in"))
            .unwrap_or(&results[0]);
        let id = pick.get("id")?.as_str()?.to_string();
        let logged_in = pick.get("state").and_then(|v| v.as_str()) == Some("logged_in");
        let jid = pick.get("jid").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
        let link = match (logged_in, jid) {
            (true, Some(jid)) => WaLink::Connected { who: jid.to_string() },
            _ => WaLink::NeedsQr,
        };
        Some((id, link))
    }

    pub async fn status(&self) -> Result<WaLink, WaError> {
        Ok(self.device().await?.1)
    }

    /// `GET /devices/{id}/login` -> `results: {device_id, qr_link, qr_duration}` (matches
    /// WAGOWA.qrPath(_:)). `qr_link`'s path is fetched from the configured gateway itself, never
    /// from whatever host the link names.
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
        // qr_duration is half the code's life (the PNG is deleted then, the code stays valid).
        Ok(Some((png, (seconds * 2).saturating_sub(5).max(20))))
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

    /// `POST /send/message?device_id={id}` -> `results: {message_id}` (matches
    /// GOWAProvider.send's use of `scoped`, which appends the device id as a query parameter —
    /// the brief's starting point omitted this, which would send on whichever device GOWA
    /// defaults to rather than Coucou's).
    pub async fn send(&self, chat: &str, text: &str) -> Result<Option<String>, WaError> {
        let (id, _) = self.device().await?;
        let (status, body) = self.call(
            reqwest::Method::POST,
            &format!("/send/message?device_id={id}"),
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

    /// A tiny fixture HTTP server: answers each accepted connection with the next
    /// (status, json body) in `responses`, in order. Returns the base URL to point a
    /// `Provider` at.
    async fn fixture_seq(responses: Vec<(u16, &'static str)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            for (status, body) in responses {
                if let Ok((mut stream, _)) = listener.accept().await {
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf).await;
                    let resp = format!(
                        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                        body.len(), body
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                }
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    async fn fixture(status: u16, body: &'static str) -> String {
        fixture_seq(vec![(status, body)]).await
    }

    #[tokio::test]
    async fn status_reports_needs_qr_for_a_disconnected_device() {
        let base = fixture(200, r#"{"results":[{"id":"coucou","state":"connecting"}]}"#).await;
        let p = Provider::new(base, None);
        assert_eq!(p.status().await.unwrap(), WaLink::NeedsQr);
    }

    #[tokio::test]
    async fn status_reports_connected_with_the_jid() {
        let base = fixture(200, r#"{"results":[{"id":"coucou","state":"logged_in","jid":"33612345678@s.whatsapp.net"}]}"#).await;
        let p = Provider::new(base, None);
        assert_eq!(p.status().await.unwrap(), WaLink::Connected { who: "33612345678@s.whatsapp.net".to_string() });
    }

    #[tokio::test]
    async fn unreachable_base_url_errors_as_unreachable() {
        let p = Provider::new("http://127.0.0.1:1".to_string(), None);
        assert_eq!(p.status().await.unwrap_err(), WaError::Unreachable);
    }

    #[tokio::test]
    async fn a_401_with_a_non_auth_code_means_unauthorized() {
        let base = fixture(401, r#"{"code":"SOMETHING_ELSE"}"#).await;
        let p = Provider::new(base, None);
        assert_eq!(p.status().await.unwrap_err(), WaError::Unauthorized);
    }

    #[tokio::test]
    async fn a_401_with_the_auth_code_means_not_linked() {
        let base = fixture(401, r#"{"code":"AUTHENTICATION_ERROR"}"#).await;
        let p = Provider::new(base, None);
        assert_eq!(p.status().await.unwrap_err(), WaError::NotLinked);
    }

    #[tokio::test]
    async fn send_returns_the_message_id() {
        let base = fixture_seq(vec![
            (200, r#"{"results":[{"id":"coucou","state":"logged_in","jid":"33612345678@s.whatsapp.net"}]}"#),
            (200, r#"{"results":{"message_id":"abc123"}}"#),
        ]).await;
        let p = Provider::new(base, None);
        assert_eq!(p.send("33612345678@s.whatsapp.net", "hi").await.unwrap(), Some("abc123".to_string()));
    }
}
