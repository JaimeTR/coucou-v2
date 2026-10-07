// Chat providers that speak the OpenAI "chat completions" protocol: Gemini
// (Google AI Studio), Groq, and a model running on your own computer (Ollama,
// LM Studio or anything that copies that protocol). All answer in the same
// shape, so one client serves them; what differs is the base URL, the key, and
// the model.
//
//   Gemini  https://generativelanguage.googleapis.com/v1beta/openai/
//   Groq    https://api.groq.com/openai/v1
//   Local   http://127.0.0.1:11434/v1 (Ollama) or :1234/v1 (LM Studio): your
//           address, no key needed, nothing leaves your network.
//
// (DEVMARK AI has its own client, devmark.rs, because of its stricter limits.)
//
// As everywhere in Coucou, the key stays in the Credential Manager (or in an
// environment variable, if you prefer) and never reaches the page.

use std::collections::HashMap;
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
    /// Works without a key (a model on your own computer).
    pub keyless: bool,
}

pub const GEMINI: Provider = Provider {
    id: "gemini",
    name: "Gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    key: "gemini-api-key",
    env: "GEMINI_API_KEY",
    keyless: false,
};

pub const GROQ: Provider = Provider {
    id: "groq",
    name: "Groq",
    base: "https://api.groq.com/openai/v1",
    key: "groq-api-key",
    env: "GROQ_API_KEY",
    keyless: false,
};

/// A model on your own computer. `base` is only the default: the address comes
/// from Settings (`local_url`). An API key is optional, for servers that ask one.
pub const LOCAL: Provider = Provider {
    id: "local",
    name: "Modelo local",
    base: "http://127.0.0.1:11434/v1",
    key: "local-api-key",
    env: "LOCAL_API_KEY",
    keyless: true,
};

/// The model names are only defaults: Settings lets you type any model the
/// provider offers, and "Test connection" lists what your key can use.
pub const DEFAULT_GEMINI_MODEL: &str = "gemini-3.8-flash";
pub const DEFAULT_GROQ_MODEL: &str = "llama-3.3-70b-versatile";
pub const DEFAULT_LOCAL_URL: &str = "http://127.0.0.1:11434/v1";
pub const DEFAULT_LOCAL_MODEL: &str = "llama3.2";

pub fn provider(id: &str) -> Option<&'static Provider> {
    match id {
        "gemini" => Some(&GEMINI),
        "groq" => Some(&GROQ),
        "local" => Some(&LOCAL),
        _ => None,
    }
}

const TIMEOUT: Duration = Duration::from_secs(90);
/// A local model may have to load into memory before its first word.
const LOCAL_TIMEOUT: Duration = Duration::from_secs(240);
const MAX_TOKENS: u32 = 1024;
/// Generous for both, and still well inside their context windows.
const MAX_MESSAGES: usize = 60;
const MAX_CHARS: usize = 100_000;

const SYSTEM_PROMPT: &str = "You are Mochi, a personal AI assistant living at the top of the user's screen. \
You can help with anything: questions, coding, research, recommendations, everyday tasks. \
Respond in the user's language. Be clear and complete without padding. \
No markdown formatting (no **, no ##, no bullet dashes). Use plain text with line breaks.";

/// Plain-text history, shared by Gemini, Groq and the local model (the conversation starts over
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

/// The address of a model server on your network, cleaned up. Plain http is
/// only for this computer or your own network (loopback, 10.x, 172.16-31.x,
/// 192.168.x, *.local); anywhere else it must be https, so a chat is never sent
/// in the clear across the internet.
pub fn local_base(raw: &str) -> Result<String, String> {
    let url = raw.trim().trim_end_matches('/');
    let (https, rest) = if let Some(r) = url.strip_prefix("https://") {
        (true, r)
    } else if let Some(r) = url.strip_prefix("http://") {
        (false, r)
    } else {
        return Err("La dirección debe empezar por http:// o https:// (por ejemplo http://127.0.0.1:11434/v1).".into());
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return Err("La dirección no es válida.".into());
    }
    let host = if let Some(v6) = authority.strip_prefix('[') {
        v6.split(']').next().unwrap_or("").to_string()
    } else {
        authority.split(':').next().unwrap_or("").to_lowercase()
    };
    let private = host == "localhost"
        || host == "::1"
        || host.ends_with(".local")
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host
            .strip_prefix("172.")
            .and_then(|r| r.split('.').next())
            .and_then(|n| n.parse::<u8>().ok())
            .map(|n| (16..=31).contains(&n))
            .unwrap_or(false);
    if !https && !private {
        return Err("Fuera de tu red la dirección debe ser https://. Con http:// solo se permite este equipo o tu red local.".into());
    }
    Ok(url.to_string())
}

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

fn client(p: &Provider) -> Result<reqwest::Client, String> {
    let timeout = if p.keyless { LOCAL_TIMEOUT } else { TIMEOUT };
    reqwest::Client::builder().timeout(timeout).build().map_err(|e| e.to_string())
}

/// A request with the key when there is one: a local server usually has none.
fn with_key(req: reqwest::RequestBuilder, key: Option<&str>) -> reqwest::RequestBuilder {
    match key {
        Some(k) => req.bearer_auth(k),
        None => req,
    }
}

/// One chat turn.
pub async fn send(
    chat: &CompatChat,
    p: &Provider,
    base: &str,
    model: &str,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let key = api_key(p);
    if key.is_none() && !p.keyless {
        return Err(format!("Falta la clave de {}. Añádela en Ajustes.", p.name));
    }
    let key = key.as_deref();
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

    // A model the provider has retired answers 404. Models come and go, so
    // instead of leaving the chat dead, use one the key can actually reach.
    let remembered = FALLBACK.lock().unwrap().get(&(p.id, model.to_string())).cloned();
    let used = remembered.unwrap_or_else(|| model.to_string());
    let body = build_body(&used, MAX_TOKENS, messages.clone());
    let result = match post(p, base, key, &body).await {
        Err((Some(404), _)) => match working_model(p, base, key, &used).await {
            Some(other) => {
                crate::log::line(format!("{}: model {used} not found, using {other}", p.id));
                FALLBACK.lock().unwrap().insert((p.id, model.to_string()), other.clone());
                post(p, base, key, &build_body(&other, MAX_TOKENS, messages)).await
            }
            None => Err((Some(404), explain_error(p, 404, ""))),
        },
        other => other,
    };
    let response = match result {
        Ok(v) => v,
        Err((_, err)) => {
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

/// Models that stopped working, mapped to the one used in their place.
static FALLBACK: std::sync::LazyLock<Mutex<HashMap<(&'static str, String), String>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// The best chat model among `ids`: the provider's usual picks first, then any
/// that is not for speech, audio, safety or embeddings.
fn pick_model(ids: &[String], not: &str) -> Option<String> {
    const PREFER: &[&str] = &["gpt-oss-120b", "llama-3.3-70b", "gpt-oss-20b", "llama-3.1-8b", "gemini-2.5-flash", "flash"];
    const SKIP: &[&str] = &["whisper", "guard", "tts", "playai", "orpheus", "embed", "image", "live", "audio", "vision-preview"];
    let usable: Vec<&String> = ids
        .iter()
        .filter(|id| id.as_str() != not && !SKIP.iter().any(|w| id.to_lowercase().contains(w)))
        .collect();
    for want in PREFER {
        if let Some(id) = usable.iter().find(|id| id.to_lowercase().contains(want)) {
            return Some((*id).clone());
        }
    }
    usable.first().map(|id| (*id).clone())
}

async fn working_model(p: &Provider, base: &str, key: Option<&str>, not: &str) -> Option<String> {
    let response = with_key(client(p).ok()?.get(format!("{base}/models")), key).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    pick_model(&model_ids(&response.json::<Value>().await.ok()?), not)
}

/// The error carries the HTTP status when there was one.
async fn post(p: &Provider, base: &str, key: Option<&str>, body: &Value) -> Result<Value, (Option<u16>, String)> {
    let client = client(p).map_err(|e| (None, e))?;
    let url = format!("{base}/chat/completions");
    let mut attempt = 0u32;
    loop {
        let response = with_key(client.post(&url), key).json(body).send().await.map_err(|e| {
            (None, if e.is_timeout() {
                format!("{} tardó demasiado en responder. Prueba con una pregunta más corta.", p.name)
            } else if p.keyless && e.is_connect() {
                format!("No se puede llegar a {base}. ¿Está abierto Ollama o LM Studio, con su servidor encendido?")
            } else {
                format!("Error de red al hablar con {}: {e}", p.name)
            })
        })?;
        let status = response.status();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());
        let text = response.text().await.map_err(|e| (None, e.to_string()))?;
        if status.is_success() {
            return serde_json::from_str(&text).map_err(|e| (None, format!("Respuesta no válida de {}: {e}", p.name)));
        }
        if let Some(wait) = retry_delay(status.as_u16(), retry_after, attempt) {
            crate::log::line(format!("{} {status} — retrying in {}s", p.id, wait.as_secs()));
            tokio::time::sleep(wait).await;
            attempt += 1;
            continue;
        }
        return Err((Some(status.as_u16()), explain_error(p, status.as_u16(), &text)));
    }
}

/// "Test connection": asks for the model list with the saved key. Generates no
/// text, so it costs nothing, and it shows which models the key can use.
pub async fn check(p: &Provider, base: &str) -> Check {
    let key = api_key(p);
    if key.is_none() && !p.keyless {
        return Check { ok: false, message: format!("Aún no hay clave de {} guardada.", p.name) };
    }
    let client = match client(p) {
        Ok(c) => c,
        Err(e) => return Check { ok: false, message: e },
    };
    match with_key(client.get(format!("{base}/models")), key.as_deref()).send().await {
        Ok(r) if r.status().is_success() => {
            let ids = model_ids(&r.json::<Value>().await.unwrap_or(Value::Null));
            let shown: Vec<&str> = ids.iter().take(6).map(String::as_str).collect();
            let more = if ids.len() > shown.len() { format!(" y {} más", ids.len() - shown.len()) } else { String::new() };
            let list = if shown.is_empty() { "sin modelos en la lista".to_string() } else { format!("{}{more}", shown.join(", ")) };
            let accepted = if p.keyless { "servidor encontrado" } else { "clave aceptada" };
            Check { ok: true, message: format!("Conectado a {}: {accepted}. Modelos: {list}.", p.name) }
        }
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            Check { ok: false, message: explain_error(p, status, &text) }
        }
        Err(e) if p.keyless => Check {
            ok: false,
            message: format!("No se puede llegar a {base}. ¿Está abierto Ollama o LM Studio, con su servidor encendido? ({e})"),
        },
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
        assert!(provider("local").unwrap().keyless && !GROQ.keyless && !GEMINI.keyless);
        assert!(crate::secrets::KNOWN_KEYS.contains(&LOCAL.key));
        // Keys are only ever read from names the secret store knows.
        assert!(crate::secrets::KNOWN_KEYS.contains(&GEMINI.key) && crate::secrets::KNOWN_KEYS.contains(&GROQ.key));
    }

    #[test]
    fn a_local_address_is_cleaned_and_plain_http_stays_on_your_network() {
        assert_eq!(local_base(" http://127.0.0.1:11434/v1/ ").unwrap(), "http://127.0.0.1:11434/v1");
        assert!(local_base("http://localhost:1234/v1").is_ok());
        assert!(local_base("http://[::1]:11434/v1").is_ok());
        assert!(local_base("http://192.168.1.20:11434/v1").is_ok());
        assert!(local_base("http://172.20.0.5:1234/v1").is_ok());
        assert!(local_base("http://mi-pc.local:11434/v1").is_ok());
        assert!(local_base("https://ia.mi-empresa.com/v1").is_ok());
        // Not your network: never in the clear. 172.32 is public, not private.
        assert!(local_base("http://ia.mi-empresa.com/v1").is_err());
        assert!(local_base("http://8.8.8.8/v1").is_err());
        assert!(local_base("http://172.32.0.1/v1").is_err());
        // Not an address, or one that hides its real host behind credentials.
        assert!(local_base("ollama").is_err());
        assert!(local_base("ftp://127.0.0.1/v1").is_err());
        assert!(local_base("http://127.0.0.1@evil.example/v1").is_err());
        assert!(local_base("http://").is_err());
    }

    /// A stand-in for Ollama: answers the model list and one chat turn, and
    /// reports whether the request carried an Authorization header.
    fn fake_ollama() -> (String, std::sync::mpsc::Receiver<bool>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}/v1", listener.local_addr().unwrap().port());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(2) {
                let mut stream = stream.unwrap();
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_lowercase();
                let _ = tx.send(request.contains("authorization:"));
                let body = if request.starts_with("get /v1/models") {
                    r#"{"data":[{"id":"llama3.2"},{"id":"qwen2.5-coder"}]}"#
                } else {
                    r#"{"choices":[{"message":{"role":"assistant","content":"Hola desde tu equipo"}}]}"#
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK
content-type: application/json
content-length: {}
connection: close

{body}",
                    body.len()
                );
            }
        });
        (base, rx)
    }

    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    #[test]
    fn a_local_model_answers_without_a_key_and_is_listed() {
        run(async {
        let (base, saw_auth) = fake_ollama();
        let check = check(&LOCAL, &base).await;
        assert!(check.ok, "{}", check.message);
        assert!(check.message.contains("llama3.2") && check.message.contains("servidor encontrado"), "{}", check.message);
        assert!(!saw_auth.recv().unwrap(), "a keyless server is not sent a key");

        let chat = CompatChat::default();
        let reply = send(&chat, &LOCAL, &base, "llama3.2", "hola".into(), None).await.unwrap();
        assert_eq!(reply.text, "Hola desde tu equipo");
        assert!(!saw_auth.recv().unwrap());
        });
    }

    #[test]
    fn a_local_server_that_is_off_says_what_to_open() {
        run(async {
        // Nothing listens on this port.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}/v1", listener.local_addr().unwrap().port());
        drop(listener);
        let Err(err) = send(&CompatChat::default(), &LOCAL, &base, "m", "hola".into(), None).await else {
            panic!("a server that is off cannot answer");
        };
        assert!(err.contains("Ollama") && err.contains("LM Studio"), "{err}");
        let check = check(&LOCAL, &base).await;
        assert!(!check.ok && check.message.contains("Ollama"), "{}", check.message);
        });
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
    fn a_retired_model_is_replaced_by_a_usable_chat_model() {
        let ids: Vec<String> = ["whisper-large-v3", "llama-guard-4", "llama-3.3-70b-versatile", "openai/gpt-oss-120b", "playai-tts"]
            .iter().map(|s| s.to_string()).collect();
        assert_eq!(pick_model(&ids, "llama-3.3-70b-versatile").as_deref(), Some("openai/gpt-oss-120b"));
        assert_eq!(pick_model(&ids[..2], "x"), None, "speech and safety models are never picked");
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
