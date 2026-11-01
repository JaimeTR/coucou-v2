// The chat on the user's own Claude plan: with no Anthropic API key saved, the
// chat is answered by their own Claude Code (`claude -p`), signed in with their
// own account. Coucou reads no credential and makes no network call of its own.
//
// Each run is kept apart from the user's sessions: no settings file is loaded
// (so no hooks: Coucou's own would show the run as a session), no MCP server, no
// slash command, nothing saved to resume, and it runs in an empty folder of
// Coucou's, so no CLAUDE.md is picked up. It may only use the tools it is given:
// web search, or, when a file was dropped, reading that one folder and no web.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::Value;
use tokio::io::AsyncWriteExt;

use crate::claude::{ChatContext, ChatReply, SYSTEM_PROMPT};
use crate::{platform, settings};

/// How long a chat turn may take: it may search the web.
const TIMEOUT: Duration = Duration::from_secs(180);

/// The plain turns so far (role, text), sent back as one prompt each time.
static HISTORY: Mutex<Vec<(&'static str, String)>> = Mutex::new(Vec::new());

pub fn reset() {
    HISTORY.lock().unwrap().clear();
}

/// The Claude Code CLI, when it is installed.
pub fn exe() -> Option<PathBuf> {
    platform::cli_candidates("claude").into_iter().next()
}

pub fn available() -> bool {
    exe().is_some()
}

/// One chat turn answered by `claude -p`.
pub async fn send(model: &str, query: String, context: Option<ChatContext>) -> Result<ChatReply, String> {
    let first = HISTORY.lock().unwrap().is_empty();
    // The dropped file is read by Claude Code itself, from its own folder only.
    let (read_dir, tools): (Option<PathBuf>, &[&str]) = match context.as_ref().filter(|_| first) {
        Some(ChatContext::File { path, .. }) => (Path::new(path).parent().map(Path::to_path_buf), &["Read"]),
        _ => (None, &["WebSearch"]),
    };
    let prompt = chat_prompt(&HISTORY.lock().unwrap(), first, context.as_ref(), &query);
    let text = ask(model, SYSTEM_PROMPT, &prompt, tools, read_dir.as_deref()).await?;
    let mut history = HISTORY.lock().unwrap();
    history.push(("user", query));
    history.push(("assistant", text.clone()));
    Ok(ChatReply { text })
}

async fn ask(model: &str, system: &str, prompt: &str, tools: &[&str], read_dir: Option<&Path>) -> Result<String, String> {
    let exe = exe().ok_or("Claude Code no está instalado.")?;
    let workdir = settings::local_dir().join("relay");
    std::fs::create_dir_all(&workdir).map_err(|e| e.to_string())?;

    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(args(model, system, tools, read_dir))
        .current_dir(&workdir)
        .env_remove("CLAUDECODE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // An npm install is a `#!/usr/bin/env node` script: its own folder first on PATH so it finds its Node.
    if let Some(dir) = exe.parent() {
        let mut dirs = vec![dir.to_path_buf()];
        if let Some(path) = std::env::var_os("PATH") {
            dirs.extend(std::env::split_paths(&path));
        }
        if let Ok(joined) = std::env::join_paths(dirs) {
            cmd.env("PATH", joined);
        }
    }
    platform::no_console(cmd.as_std_mut());

    let mut child = cmd.spawn().map_err(|e| format!("No pude iniciar Claude Code: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).await.map_err(|e| e.to_string())?;
    }
    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "Claude Code tardó demasiado en responder.".to_string())?
        .map_err(|e| e.to_string())?;
    parse(&output.stdout).map_err(|err| {
        let stderr = String::from_utf8_lossy(&output.stderr);
        match stderr.trim() {
            "" => err,
            detail => format!("{err} ({})", detail.lines().last().unwrap_or(detail)),
        }
    })
}

fn args(model: &str, system: &str, tools: &[&str], read_dir: Option<&Path>) -> Vec<OsString> {
    let mut out: Vec<OsString> = ["-p", "--output-format", "json", "--model", model, "--system-prompt", system, "--tools"]
        .iter()
        .map(OsString::from)
        .collect();
    out.push(tools.join(",").into());
    if !tools.is_empty() {
        out.push("--allowedTools".into());
        out.push(tools.join(",").into());
    }
    if let Some(dir) = read_dir {
        out.push("--add-dir".into());
        out.push(dir.as_os_str().to_owned());
    }
    for flag in ["--setting-sources", "", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"] {
        out.push(flag.into());
    }
    out
}

/// The answer's text from `claude -p --output-format json`.
fn parse(stdout: &[u8]) -> Result<String, String> {
    let json: Value = serde_json::from_slice(stdout).map_err(|_| "Claude Code no dio respuesta.".to_string())?;
    let result = json.get("result").and_then(Value::as_str).unwrap_or("").trim();
    if json.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
        return Err(if result.is_empty() { "Claude Code no pudo responder.".to_string() } else { result.to_string() });
    }
    if result.is_empty() {
        return Err("La respuesta no trae texto.".into());
    }
    Ok(result.to_string())
}

/// One chat turn as a single prompt: the earlier turns, the context the first
/// question carries, then the question.
fn chat_prompt(history: &[(&str, String)], first: bool, context: Option<&ChatContext>, query: &str) -> String {
    let mut out = String::new();
    if !history.is_empty() {
        out.push_str("The conversation so far:\n<conversation>\n");
        for (role, text) in history {
            out.push_str(&format!("<{role}>\n{text}\n</{role}>\n"));
        }
        out.push_str("</conversation>\n\nThe user's new message:\n");
    }
    match context.filter(|_| first) {
        Some(ChatContext::File { name, path }) => out.push_str(&format!("File: {name} (read it at {path})\n\n")),
        Some(ChatContext::Window { app_name, title, url }) => {
            out.push_str(&format!("Context — App: {app_name}, Window: {title}"));
            if let Some(url) = url {
                out.push_str(&format!(", URL: {url}"));
            }
            out.push_str("\n\n");
        }
        None => {}
    }
    out.push_str(query);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[OsString]) -> Vec<String> {
        args.iter().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn a_run_loads_no_settings_and_only_the_tools_it_is_given() {
        let a = strings(&args("claude-x", "sys", &[], None));
        assert_eq!(&a[..8], ["-p", "--output-format", "json", "--model", "claude-x", "--system-prompt", "sys", "--tools"]);
        assert_eq!(a[8], "");
        assert!(!a.contains(&"--allowedTools".to_string()));
        let sources = a.iter().position(|x| x == "--setting-sources").unwrap();
        assert_eq!(a[sources + 1], "");
        for flag in ["--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"] {
            assert!(a.contains(&flag.to_string()), "{flag}");
        }
        let a = strings(&args("m", "s", &["Read"], Some(Path::new("/tmp/inbox"))));
        let allowed = a.iter().position(|x| x == "--allowedTools").unwrap();
        assert_eq!(a[allowed + 1], "Read");
        let dir = a.iter().position(|x| x == "--add-dir").unwrap();
        assert_eq!(a[dir + 1], "/tmp/inbox");
    }

    #[test]
    fn the_answer_or_the_error_comes_from_the_result_field() {
        assert_eq!(parse(br#"{"is_error":false,"result":" Hi "}"#).unwrap(), "Hi");
        assert_eq!(parse(br#"{"is_error":true,"result":"Not logged in"}"#).unwrap_err(), "Not logged in");
        assert_eq!(parse(br#"{"is_error":false,"result":"  "}"#).unwrap_err(), "La respuesta no trae texto.");
        assert!(parse(b"nope").is_err());
    }

    #[test]
    fn the_prompt_carries_the_history_then_the_context_then_the_question() {
        assert_eq!(chat_prompt(&[], true, None, "q"), "q");
        let history = vec![("user", "a".to_string()), ("assistant", "b".to_string())];
        assert_eq!(
            chat_prompt(&history, false, None, "c"),
            "The conversation so far:\n<conversation>\n<user>\na\n</user>\n<assistant>\nb\n</assistant>\n</conversation>\n\nThe user's new message:\nc"
        );
        let file = ChatContext::File { name: "a.pdf".into(), path: "/inbox/a.pdf".into() };
        assert_eq!(chat_prompt(&[], true, Some(&file), "why?"), "File: a.pdf (read it at /inbox/a.pdf)\n\nwhy?");
    }
}
