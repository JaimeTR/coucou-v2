// Chat providers that speak the OpenAI "chat completions" protocol: Gemini
// (Google AI Studio) and Groq. Both authenticate with `Authorization: Bearer`
// and answer in the same shape, so one client serves them; what differs is the
// base URL, the key, and the model.
//
//   Gemini  https://generativelanguage.googleapis.com/v1beta/openai/
//   Groq    https://api.groq.com/openai/v1
//
// (DEVMARK AI has its own client, devmark.rs, because of its stricter limits.)
//
// As everywhere in Coucou, the key stays in the Credential Manager (or in an
// environment variable, if you prefer) and never reaches the page.

use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

use crate::claude::{ChatContext, ChatReply};
use crate::devmark::{build_body, file_text, reply_text, Check};
use crate::secrets;

pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    pub base: &'static str,
    /// Credential Manager entry.
    pub key: &'static str,
    /// Environment variable that also works.
    pub env: &'static str,
}

pub const GEMINI: Provider = Provider {
    id: "gemini",
    name: "Gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    key: "gemini-api-key",
    env: "GEMINI_API_KEY",
};

pub const GROQ: Provider = Provider {
    id: "groq",
    name: "Groq",
    base: "https://api.groq.com/openai/v1",
    key: "groq-api-key",
    env: "GROQ_API_KEY",
};

/// The model names are only defaults: Settings lets you type any model the
/// provider offers, and "Test connection" lists what your key can use.
pub const DEFAULT_GEMINI_MODEL: &str = "gemini-3.8-flash";
pub const DEFAULT_GROQ_MODEL: &str = "llama-3.3-70b-versatile";

pub fn provider(id: &str) -> Option<&'static Provider> {
    match id {
        "gemini" => Some(&GEMINI),
        "groq" => Some(&GROQ),
        _ => None,
    }
}

const TIMEOUT: Duration = Duration::from_secs(90);
const MAX_TOKENS: u32 = 1024;
/// Generous for both, and still well inside their context windows.
const MAX_MESSAGES: usize = 60;
const MAX_CHARS: usize = 100_000;

const SYSTEM_PROMPT: &str = "You are Mochi, a personal AI assistant living at the top of the user's screen. \
You can help with anything: questions, coding, research, recommendations, everyday tasks. \
Respond in the user's language. Be clear and complete without padding. \
No markdown formatting (no **, no ##, no bullet dashes). Use plain text with line breaks.";

/// Plain-text history, shared by Gemini and Groq (the conversation starts over
/// whenever the provider changes, which the app already guarantees).
#[derive(Default)]
pub struct CompatChat {
    history: Mutex<Vec<(String, String)>>,
    /// One answer at a time per conversation.
    busy: tokio::sync::Mutex<()>,
}

impl CompatChat {
    pub fn reset(&self) {
        self.history.lock().unwrap().clear();
    }
}

fn api_key(p: &Provider) -> Option<String> {
    secrets::get(p.key).or_else(|| std::env::var(p.env).ok().filter(|k| !k.trim().is_empty()))
}

// ── Pure pieces (tested below) ────────────────────────────────────────────────

/// The system prompt plus as much of the newest history as fits. The newest
/// message is always kept; if even that is too long, the person is told.
fn fit_messages(who: &str, history: &[(String, String)]) -> Result<Vec<Value>, String> {
    let mut used = SYSTEM_PROMPT.chars().count();
    let mut kept: Vec<&(String, String)> = Vec::new();
    for turn in history.iter().rev() {
        let size = turn.1.chars().count();
        if kept.len() >= MAX_MESSAGES || used + size > MAX_CHARS {
            if kept.is_empty() {
                return Err(format!(
                    "Ese mensaje es demasiado largo para {who} (unos {} caracteres como máximo).",
                    MAX_CHARS - used
                ));
            }
            break;
        }
        used += size;
        kept.push(turn);
    }
    kept.reverse();
    // Start on a question: an answer with nothing before it would confuse the model.
    while kept.first().map(|t| t.0 != "user").unwrap_or(false) {
        kept.remove(0);
    }
    let mut out = vec![json!({ "role": "system", "content": SYSTEM_PROMPT })];
    out.extend(kept.iter().map(|(role, text)| json!({ "role": role, "content": text })));
    Ok(out)
}

/// The provider's own words for what went wrong. Gemini wraps errors in an
/// array, Groq and OpenAI in an object; both are read.
fn error_detail(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let first = v.as_array().and_then(|a| a.first()).unwrap_or(&v);
    first
        .pointer("/error/message")
        .or_else(|| first.get("message"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| body.chars().take(200).collect())
}

fn explain_error(p: &Provider, status: u16, body: &str) -> String {
    let detail = error_detail(body);
    let name = p.name;
    // Gemini answers a wrong key with a 400 that says so.
    let bad_key = status == 400 && detail.to_lowercase().contains("api key");
    match status {
        401 | 403 => format!("{name} rechazó la clave de API ({status}). Revísala en Ajustes."),
        _ if bad_key => format!("{name} rechazó la clave de API (400). Revísala en Ajustes."),
        404 => format!("{name}: no se encontró el modelo ({status}). Revisa su nombre en Ajustes. {detail}"),
        429 => format!("Se alcanzó el límite de peticiones de {name} (429). Espera un momento e inténtalo de nuevo."),
        400 | 422 => format!("{name} rechazó la petición ({status}): {detail}"),
        500..=599 => format!("{name} no está disponible ({status}). Inténtalo en un momento."),
        _ => format!("{name} {status}: {detail}"),
    }
}

/// How long to wait before trying again, or None to give up: 429 once, after
/// the pause the provider asked for (capped); 5xx twice, with a growing pause.
fn retry_delay(status: u16, retry_after: Option<u64>, attempt: u32) -> Option<Duration> {
    match status {
        429 if attempt == 0 => Some(Duration::from_secs(retry_after.unwrap_or(5).clamp(1, 20))),
        500 | 502 | 503 | 504 if attempt < 2 => Some(Duration::from_secs(if attempt == 0 { 3 } else { 8 })),
        _ => None,
    }
}

/// `data[].id` of a models listing; Gemini prefixes each id with "models/".
fn model_ids(response: &Value) -> Vec<String> {
    response
        .get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str))
                .map(|id| id.strip_prefix("models/").unwrap_or(id).to_string())
                .collect()
        })
        .unwrap_or_default()
}

// ── The network ───────────────────────────────────────────────────────────────

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| e.to_string())
}

/// One chat turn.
pub async fn send(
    chat: &CompatChat,
    p: &Provider,
    model: &str,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let key = api_key(p).ok_or_else(|| format!("Falta la clave de {}. Añádela en Ajustes.", p.name))?;
    let Ok(_turn) = chat.busy.try_lock() else {
        return Err(format!("{} sigue respondiendo el mensaje anterior: espera a que termine.", p.name));
    };

    let first = chat.history.lock().unwrap().is_empty();
    let mut text = String::new();
    // File / window context rides along with the first message only.
    if first {
        match &context {
            Some(ChatContext::File { name, path }) => {
                text.push_str(&file_text(p.name, name, path)?);
                text.push_str("\n\n");
            }
            Some(ChatContext::Window { app_name, title, url }) => {
                text.push_str(&format!("Context — App: {app_name}, Window: {title}"));
                if let Some(url) = url {
                    text.push_str(&format!(", URL: {url}"));
                }
                text.push_str("\n\n");
            }
            None => {}
        }
    }
    text.push_str(&query);

    let messages = {
        let mut history = chat.history.lock().unwrap();
        history.push(("user".into(), text));
        match fit_messages(p.name, &history) {
            Ok(m) => m,
            Err(err) => {
                history.pop();
                return Err(err);
            }
        }
    };

    let body = build_body(model, MAX_TOKENS, messages);
    let response = match post(p, &key, &body).await {
        Ok(v) => v,
        Err(err) => {
            chat.history.lock().unwrap().pop(); // keep the history what the model saw
            return Err(err);
        }
    };
    let Some(reply) = reply_text(&response) else {
        chat.history.lock().unwrap().pop();
        return Err(format!("{} envió una respuesta vacía. Inténtalo de nuevo.", p.name));
    };
    chat.history.lock().unwrap().push(("assistant".into(), reply.clone()));
    Ok(ChatReply { text: reply })
}

async fn post(p: &Provider, key: &str, body: &Value) -> Result<Value, String> {
    let client = client()?;
    let url = format!("{}/chat/completions", p.base);
    let mut attempt = 0u32;
    loop {
        let response = client.post(&url).bearer_auth(key).json(body).send().await.map_err(|e| {
            if e.is_timeout() {
                format!("{} tardó demasiado en responder. Prueba con una pregunta más corta.", p.name)
            } else {
                format!("Error de red al hablar con {}: {e}", p.name)
            }
        })?;
        let status = response.status();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());
        let text = response.text().await.map_err(|e| e.to_string())?;
        if status.is_success() {
            return serde_json::from_str(&text).map_err(|e| format!("Respuesta no válida de {}: {e}", p.name));
        }
        if let Some(wait) = retry_delay(status.as_u16(), retry_after, attempt) {
            crate::log::line(format!("{} {status} — retrying in {}s", p.id, wait.as_secs()));
            tokio::time::sleep(wait).await;
            attempt += 1;
            continue;
        }
        return Err(explain_error(p, status.as_u16(), &text));
    }
}

/// "Test connection": asks for the model list with the saved key. Generates no
/// text, so it costs nothing, and it shows which models the key can use.
pub async fn check(p: &Provider) -> Check {
    let Some(key) = api_key(p) else {
        return Check { ok: false, message: format!("Aún no hay clave de {} guardada.", p.name) };
    };
    let client = match client() {
        Ok(c) => c,
        Err(e) => return Check { ok: false, message: e },
    };
    match client.get(format!("{}/models", p.base)).bearer_auth(key).send().await {
        Ok(r) if r.status().is_success() => {
            let ids = model_ids(&r.json::<Value>().await.unwrap_or(Value::Null));
            let shown: Vec<&str> = ids.iter().take(6).map(String::as_str).collect();
            let more = if ids.len() > shown.len() { format!(" y {} más", ids.len() - shown.len()) } else { String::new() };
            let list = if shown.is_empty() { "sin modelos en la lista".to_string() } else { format!("{}{more}", shown.join(", ")) };
            Check { ok: true, message: format!("Conectado a {}: clave aceptada. Modelos: {list}.", p.name) }
        }
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            Check { ok: false, message: explain_error(p, status, &text) }
        }
        Err(e) => Check { ok: false, message: format!("No se puede llegar a {}: {e}", p.name) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(role: &str, text: &str) -> (String, String) {
        (role.into(), text.into())
    }

    #[test]
    fn each_provider_has_its_own_endpoint_key_and_variable() {
        assert_eq!(provider("gemini").unwrap().base, "https://generativelanguage.googleapis.com/v1beta/openai");
        assert_eq!(provider("groq").unwrap().base, "https://api.groq.com/openai/v1");
        assert_ne!(GEMINI.key, GROQ.key);
        assert_ne!(GEMINI.env, GROQ.env);
        assert!(provider("anthropic").is_none() && provider("devmark").is_none());
        // Keys are only ever read from names the secret store knows.
        assert!(crate::secrets::KNOWN_KEYS.contains(&GEMINI.key) && crate::secrets::KNOWN_KEYS.contains(&GROQ.key));
    }

    #[test]
    fn a_long_chat_is_trimmed_from_the_front() {
        let history: Vec<_> = (0..200)
            .flat_map(|i| [turn("user", &format!("pregunta {i}")), turn("assistant", &format!("respuesta {i}"))])
            .collect();
        let m = fit_messages("Groq", &history).unwrap();
        assert!(m.len() <= MAX_MESSAGES + 1);
        assert_eq!(m[0]["role"], "system");
        assert_eq!(m[1]["role"], "user");
        assert_eq!(m.last().unwrap()["content"], "respuesta 199");
    }

    #[test]
    fn a_message_that_cannot_fit_is_refused_with_the_provider_name() {
        let err = fit_messages("Gemini", &[turn("user", &"x".repeat(MAX_CHARS + 10))]).unwrap_err();
        assert!(err.contains("Gemini") && err.contains("demasiado largo"), "{err}");
    }

    #[test]
    fn errors_are_explained_in_the_providers_own_name() {
        assert!(explain_error(&GROQ, 401, "{}").contains("Groq rechazó la clave"));
        assert!(explain_error(&GROQ, 429, "{}").contains("límite"));
        assert!(explain_error(&GEMINI, 503, "{}").contains("no está disponible"));
        assert!(explain_error(&GEMINI, 404, r#"{"error":{"message":"model not found"}}"#).contains("model not found"));
        // Gemini's wrong-key answer is a 400, wrapped in an array.
        let gemini_bad_key = r#"[{"error":{"code":400,"message":"API key not valid. Please pass a valid API key."}}]"#;
        assert!(explain_error(&GEMINI, 400, gemini_bad_key).contains("rechazó la clave"));
        // A different 400 keeps the provider's explanation.
        assert!(explain_error(&GROQ, 400, r#"{"error":{"message":"bad field"}}"#).contains("bad field"));
    }

    #[test]
    fn retries_follow_the_provider_and_never_hammer_it() {
        assert_eq!(retry_delay(429, Some(7), 0), Some(Duration::from_secs(7)));
        assert_eq!(retry_delay(429, Some(500), 0), Some(Duration::from_secs(20)), "the wait is capped");
        assert_eq!(retry_delay(429, None, 0), Some(Duration::from_secs(5)));
        assert_eq!(retry_delay(429, Some(7), 1), None);
        assert!(retry_delay(503, None, 1).is_some() && retry_delay(503, None, 2).is_none());
        for status in [400, 401, 403, 404, 422] {
            assert_eq!(retry_delay(status, None, 0), None, "{status}");
        }
    }

    #[test]
    fn model_ids_come_without_googles_models_prefix() {
        let gemini = json!({ "data": [{ "id": "models/gemini-3.8-flash" }, { "id": "models/gemini-3.8-pro" }] });
        assert_eq!(model_ids(&gemini), vec!["gemini-3.8-flash", "gemini-3.8-pro"]);
        let groq = json!({ "object": "list", "data": [{ "id": "llama-3.3-70b-versatile" }] });
        assert_eq!(model_ids(&groq), vec!["llama-3.3-70b-versatile"]);
        assert!(model_ids(&json!({})).is_empty());
    }
}
