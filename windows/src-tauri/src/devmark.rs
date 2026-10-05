// DEVMARK AI — the company's private model, as a chat provider.
//
// An OpenAI-compatible API (https://ai.devmarkpe.com/llms.txt):
//   POST {BASE_URL}/chat/completions   Authorization: Bearer dmk_…
// Limits worth respecting, all from that guide: no streaming, one generation at
// a time (a CPU-bound model), at most 100 messages / 48 000 characters per
// request, a client timeout of at least 120 s, and short replies are faster.
//
// Like the Claude client, everything happens here: the key stays in the
// Credential Manager (or DEVMARK_API_KEY in the environment, for people who
// prefer that) and never reaches the page.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::claude::{ChatContext, ChatReply};
use crate::secrets;

pub const BASE_URL: &str = "https://ai.devmarkpe.com/v1";
/// /health and /status are not under /v1 (checked against the live service).
const HEALTH_URL: &str = "https://ai.devmarkpe.com/health";
pub const DEFAULT_MODEL: &str = "llama3.2:1b";
pub const DEFAULT_MAX_TOKENS: u32 = 400;
const KEY_NAME: &str = "devmark-api-key";
const ENV_KEY: &str = "DEVMARK_API_KEY";

/// The guide says "at least 120 s"; a little more for a busy CPU.
const TIMEOUT: Duration = Duration::from_secs(150);
/// The API takes 100 messages and 48 000 characters. Stay clear of both so an
/// off-by-one on their side never turns a long chat into a 400.
const MAX_MESSAGES: usize = 40;
const MAX_CHARS: usize = 44_000;
/// A dropped text file is inlined up to this; the whole request has to fit.
const MAX_INLINE_FILE_CHARS: usize = 20_000;

const SYSTEM_PROMPT: &str = "You are Mochi, a small friendly assistant on the user's screen. \
Answer in the user's language, briefly and clearly. Plain text only, no markdown.";

/// Plain-text history: the model behind this API takes role + text, nothing else.
#[derive(Default)]
pub struct DevmarkChat {
    history: Mutex<Vec<(String, String)>>,
    /// One generation at a time: a second request while one runs is refused
    /// instead of queued behind a model that is already busy.
    busy: tokio::sync::Mutex<()>,
}

impl DevmarkChat {
    pub fn reset(&self) {
        self.history.lock().unwrap().clear();
    }
}

fn api_key() -> Option<String> {
    secrets::get(KEY_NAME).or_else(|| std::env::var(ENV_KEY).ok().filter(|k| !k.trim().is_empty()))
}

// ── Pure pieces (tested below) ────────────────────────────────────────────────

/// `system` + as much of the newest history as fits the API's limits. The
/// newest message is always kept; if even that is too long there is nothing to
/// trim, and the person is told.
fn fit_messages(history: &[(String, String)]) -> Result<Vec<Value>, String> {
    let mut used = SYSTEM_PROMPT.chars().count();
    let mut kept: Vec<&(String, String)> = Vec::new();
    for turn in history.iter().rev() {
        let size = turn.1.chars().count();
        if kept.len() >= MAX_MESSAGES || used + size > MAX_CHARS {
            if kept.is_empty() {
                return Err(format!(
                    "That message is too long for DEVMARK AI (about {} characters at most).",
                    MAX_CHARS - used
                ));
            }
            break;
        }
        used += size;
        kept.push(turn);
    }
    kept.reverse();
    // A reply with no question before it would confuse the model: start on a user turn.
    while kept.first().map(|t| t.0 != "user").unwrap_or(false) {
        kept.remove(0);
    }
    let mut out = vec![json!({ "role": "system", "content": SYSTEM_PROMPT })];
    out.extend(kept.iter().map(|(role, text)| json!({ "role": role, "content": text })));
    Ok(out)
}

fn build_body(model: &str, max_tokens: u32, messages: Vec<Value>) -> Value {
    json!({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3,
        "stream": false,
    })
}

/// `choices[0].message.content`, trimmed; None when there is nothing to show.
fn reply_text(response: &Value) -> Option<String> {
    let text = response
        .get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_str()?
        .trim()
        .to_string();
    (!text.is_empty()).then_some(text)
}

/// The API's own words for what went wrong, wherever it put them.
fn error_detail(body: &str) -> (String, String) {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let pick = |path: &[&str]| -> Option<String> {
        let mut cur = &v;
        for key in path {
            cur = cur.get(*key)?;
        }
        cur.as_str().map(str::to_string)
    };
    let code = pick(&["error", "code"])
        .or_else(|| pick(&["code"]))
        .or_else(|| pick(&["detail", "code"]))
        .or_else(|| pick(&["error", "type"]))
        .unwrap_or_default();
    let message = pick(&["error", "message"])
        .or_else(|| pick(&["message"]))
        .or_else(|| pick(&["detail", "message"]))
        .or_else(|| pick(&["detail"]))
        .unwrap_or_else(|| body.chars().take(200).collect());
    // Dormant mode may only be named in the text.
    let code = if code.is_empty() && body.contains("ai_paused") { "ai_paused".into() } else { code };
    (code, message)
}

/// What the person reads for a failed request: the three cases the guide names
/// (401, 429, 503), then the rest.
fn explain_error(status: u16, body: &str) -> String {
    let (code, detail) = error_detail(body);
    match status {
        401 => "DEVMARK AI rejected the API key (401). Check it in Settings.".into(),
        429 => "DEVMARK AI rate limit reached (429). Wait 10–60 seconds and try again.".into(),
        503 | 504 if code == "ai_paused" => {
            "DEVMARK AI is paused (dormant mode). Try again later.".into()
        }
        503 | 504 => format!("DEVMARK AI is unavailable or slow ({status}). Try again in a moment."),
        400 | 422 => format!("DEVMARK AI refused the request ({status}): {detail}"),
        _ => format!("DEVMARK AI {status}: {detail}"),
    }
}

/// How long to wait before trying again, or None to give up. Follows the guide:
/// 429 retries once after a pause; 503/504 retry once or twice; dormant mode
/// ("ai_paused") and everything else are not worth repeating.
fn retry_delay(status: u16, body: &str, attempt: u32) -> Option<Duration> {
    match status {
        429 if attempt == 0 => Some(Duration::from_secs(15)),
        503 | 504 if error_detail(body).0 != "ai_paused" && attempt < 2 => {
            Some(Duration::from_secs(if attempt == 0 { 4 } else { 10 }))
        }
        _ => None,
    }
}

/// Text files only: the model cannot read PDFs or images.
fn file_text(name: &str, path: &str) -> Result<String, String> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let cannot = || {
        format!(
            "DEVMARK AI's model reads text only — it can't open “{name}”. Text and code files work."
        )
    };
    if matches!(ext.as_str(), "pdf" | "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "zip" | "exe") {
        return Err(cannot());
    }
    let text = std::fs::read_to_string(path).map_err(|_| cannot())?;
    let total = text.chars().count();
    if total > MAX_INLINE_FILE_CHARS {
        let head: String = text.chars().take(MAX_INLINE_FILE_CHARS).collect();
        return Ok(format!("File: {name} (first {MAX_INLINE_FILE_CHARS} of {total} characters)\n{head}"));
    }
    Ok(format!("File: {name}\n{text}"))
}

// ── The network ───────────────────────────────────────────────────────────────

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// One chat turn.
pub async fn send(
    chat: &DevmarkChat,
    model: &str,
    max_tokens: u32,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let key = api_key().ok_or_else(|| "DEVMARK AI key missing. Add it in Settings.".to_string())?;
    let Ok(_turn) = chat.busy.try_lock() else {
        return Err("DEVMARK AI is still answering the last message — wait for it.".into());
    };

    let first = chat.history.lock().unwrap().is_empty();
    let mut text = String::new();
    // File / window context rides along with the first message only, like Claude's.
    if first {
        match &context {
            Some(ChatContext::File { name, path }) => {
                text.push_str(&file_text(name, path)?);
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
        match fit_messages(&history) {
            Ok(m) => m,
            Err(err) => {
                history.pop();
                return Err(err);
            }
        }
    };

    let max_tokens = max_tokens.clamp(50, 2000);
    let body = build_body(model, max_tokens, messages);
    let response = match post(&key, &body).await {
        Ok(v) => v,
        Err(err) => {
            chat.history.lock().unwrap().pop(); // keep the history what the model saw
            return Err(err);
        }
    };

    let Some(reply) = reply_text(&response) else {
        chat.history.lock().unwrap().pop();
        return Err("DEVMARK AI sent an empty answer. Try again.".into());
    };
    chat.history.lock().unwrap().push(("assistant".into(), reply.clone()));
    Ok(ChatReply { text: reply })
}

async fn post(key: &str, body: &Value) -> Result<Value, String> {
    let client = client()?;
    let url = format!("{BASE_URL}/chat/completions");
    let mut attempt = 0u32;
    loop {
        let response = client
            .post(&url)
            .bearer_auth(key)
            .json(body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "DEVMARK AI took too long to answer. Try a shorter question.".to_string()
                } else {
                    format!("Network error talking to DEVMARK AI: {e}")
                }
            })?;
        let status = response.status();
        let text = response.text().await.map_err(|e| e.to_string())?;
        if status.is_success() {
            return serde_json::from_str(&text).map_err(|e| format!("Bad DEVMARK AI response: {e}"));
        }
        if let Some(wait) = retry_delay(status.as_u16(), &text, attempt) {
            crate::log::line(format!("devmark {status} — retrying in {}s", wait.as_secs()));
            tokio::time::sleep(wait).await;
            attempt += 1;
            continue;
        }
        return Err(explain_error(status.as_u16(), &text));
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub ok: bool,
    pub message: String,
}

/// "Test connection": reaches the service, and when a key is saved asks for the
/// model list with it. No text is generated, so it costs the model nothing.
pub async fn check() -> Check {
    let client = match client() {
        Ok(c) => c,
        Err(e) => return Check { ok: false, message: e },
    };
    let health = client.get(HEALTH_URL).send().await;
    let reachable = match &health {
        Ok(r) if r.status().is_success() => "reachable",
        Ok(r) if r.status().as_u16() == 503 => {
            return Check { ok: false, message: "The service answers but the model is unavailable (503).".into() }
        }
        Ok(r) => {
            return Check { ok: false, message: format!("The service answered {}.", r.status()) }
        }
        Err(e) => return Check { ok: false, message: format!("Can't reach DEVMARK AI: {e}") },
    };

    let Some(key) = api_key() else {
        return Check { ok: false, message: format!("DEVMARK AI is {reachable}, but no key is saved yet.") };
    };
    match client.get(format!("{BASE_URL}/models")).bearer_auth(key).send().await {
        Ok(r) if r.status().is_success() => {
            let v: Value = r.json().await.unwrap_or(Value::Null);
            let models: Vec<String> = v
                .get("data")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let shown = if models.is_empty() { "no models listed".to_string() } else { models.join(", ") };
            Check { ok: true, message: format!("Connected — key accepted. Models: {shown}.") }
        }
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            Check { ok: false, message: explain_error(status, &text) }
        }
        Err(e) => Check { ok: false, message: format!("Network error: {e}") },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(role: &str, text: &str) -> (String, String) {
        (role.into(), text.into())
    }

    #[test]
    fn the_request_is_openai_shaped_and_never_streams() {
        let body = build_body("llama3.2:1b", 400, vec![json!({"role":"user","content":"hi"})]);
        assert_eq!(body["model"], "llama3.2:1b");
        assert_eq!(body["max_tokens"], 400);
        assert_eq!(body["stream"], false);
        assert_eq!(body["messages"][0]["role"], "user");
    }

    #[test]
    fn a_long_chat_is_trimmed_from_the_front_and_keeps_the_system_prompt() {
        let history: Vec<_> = (0..200)
            .flat_map(|i| [turn("user", &format!("question {i}")), turn("assistant", &format!("answer {i}"))])
            .collect();
        let messages = fit_messages(&history).unwrap();
        assert!(messages.len() <= MAX_MESSAGES + 1, "{} messages", messages.len());
        assert_eq!(messages[0]["role"], "system");
        // The newest turn survived, the oldest did not, and it starts on a user turn.
        assert_eq!(messages.last().unwrap()["content"], "answer 199");
        assert_eq!(messages[1]["role"], "user");
    }

    #[test]
    fn the_character_budget_is_respected() {
        let big = "x".repeat(20_000);
        let history = vec![
            turn("user", &big),
            turn("assistant", &big),
            turn("user", &big),
            turn("assistant", &big),
            turn("user", "latest"),
        ];
        let messages = fit_messages(&history).unwrap();
        let total: usize = messages.iter().map(|m| m["content"].as_str().unwrap().chars().count()).sum();
        assert!(total <= MAX_CHARS, "{total} characters");
        assert_eq!(messages.last().unwrap()["content"], "latest");
    }

    #[test]
    fn a_single_message_that_cannot_fit_is_refused_with_a_reason() {
        let err = fit_messages(&[turn("user", &"y".repeat(60_000))]).unwrap_err();
        assert!(err.contains("too long"), "{err}");
    }

    #[test]
    fn the_answer_is_read_from_the_first_choice() {
        let ok = json!({"choices":[{"message":{"role":"assistant","content":"  Hello there \n"}}]});
        assert_eq!(reply_text(&ok).unwrap(), "Hello there");
        assert!(reply_text(&json!({"choices":[]})).is_none());
        assert!(reply_text(&json!({"choices":[{"message":{"content":"  "}}]})).is_none());
        assert!(reply_text(&json!({})).is_none());
    }

    #[test]
    fn the_three_errors_the_guide_names_each_get_their_own_words() {
        assert!(explain_error(401, "{}").contains("rejected the API key"));
        assert!(explain_error(429, "{}").contains("rate limit"));
        assert!(explain_error(503, "{}").contains("unavailable"));
        // Dormant mode is its own message, found wherever the API puts the code.
        for body in [
            r#"{"error":{"code":"ai_paused","message":"asleep"}}"#,
            r#"{"code":"ai_paused"}"#,
            "service says ai_paused",
        ] {
            assert!(explain_error(503, body).contains("paused"), "{body}");
        }
        assert!(explain_error(422, r#"{"error":{"message":"too many messages"}}"#).contains("too many messages"));
    }

    #[test]
    fn retries_follow_the_guide_and_never_repeat_dormant_mode() {
        assert_eq!(retry_delay(429, "{}", 0), Some(Duration::from_secs(15)));
        assert_eq!(retry_delay(429, "{}", 1), None);
        assert!(retry_delay(503, "{}", 0).is_some());
        assert!(retry_delay(503, "{}", 1).is_some());
        assert_eq!(retry_delay(503, "{}", 2), None);
        assert_eq!(retry_delay(503, r#"{"error":{"code":"ai_paused"}}"#, 0), None);
        // A bad key or bad input will not get better by asking again.
        for status in [400, 401, 422, 500] {
            assert_eq!(retry_delay(status, "{}", 0), None, "{status}");
        }
    }

    #[test]
    fn only_text_files_are_sent() {
        let tmp = std::env::temp_dir().join(format!("coucou-devmark-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let txt = tmp.join("a.txt");
        std::fs::write(&txt, "hello").unwrap();
        let sent = file_text("a.txt", txt.to_str().unwrap()).unwrap();
        assert!(sent.contains("hello") && sent.starts_with("File: a.txt"));
        assert!(file_text("a.pdf", "C:/x/a.pdf").unwrap_err().contains("text only"));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
