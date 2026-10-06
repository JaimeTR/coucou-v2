//! coucou-hook — the relay Claude Code runs on every hook event.
//!
//! Reads the hook JSON on stdin, adds a little terminal context, and hands it to
//! Coucou over the named pipe `\\.\pipe\coucou-<sid>` (Windows) or the Unix
//! socket `$XDG_RUNTIME_DIR/coucou.sock` (Linux).
//!
//! Hard rule (docs/CLAUDE.md): **never block Claude Code.**
//! * If the pipe does not exist — Coucou is closed — we exit 0 immediately with
//!   nothing on stdout, and the session carries on untouched.
//! * Every step runs under a deadline enforced by the main thread, so a pipe that
//!   accepts the connection and then stops reading cannot wedge the session
//!   either: we abandon the worker and exit.
//! * Only `PermissionRequest` waits for an answer, because approving from the
//!   island is the whole point. No answer means empty stdout, and Claude Code
//!   asks in the terminal exactly as if Coucou were not installed.
//!
//! Usage: `coucou-hook <EventName>` (the name is also read from the JSON).

use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::Duration;

/// Budget for getting a pipe connection. Beyond this Claude Code wins, always.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
/// Whole-run budget for an event nobody waits on: connect and write, no more.
const FIRE_AND_FORGET_BUDGET: Duration = Duration::from_secs(2);
/// How long a permission prompt may stay on screen before the terminal takes over.
const DECISION_BUDGET: Duration = Duration::from_secs(110);

/// Fields that are pointless to forward and can be enormous (a whole file read,
/// a full command output). The island never shows them.
const DROPPED_FIELDS: &[&str] = &["tool_response", "transcript_path"];
/// Longest string forwarded for any single field; the island truncates to far
/// less than this anyway.
const MAX_FIELD_LEN: usize = 2_000;
/// The live diff needs the real text of an edit, so the tools that carry one get
/// a far larger allowance. Past this the island says "Diff too large".
const MAX_EDIT_FIELD_LEN: usize = 100_000;
const EDIT_TOOLS: &[&str] = &["Edit", "MultiEdit", "Write"];
/// How long a question from Claude may stay on screen. The hook timeout written
/// to settings.json is 130 s, and the app gives up at 125 s.
const ASK_BUDGET: Duration = Duration::from_secs(128);
/// The previous statusLine command gets this long to produce its line.
const PREVIOUS_STATUSLINE_BUDGET: Duration = Duration::from_secs(10);

#[cfg(windows)]
mod win;
#[cfg(windows)]
use win::{ancestor_pids, connect};

#[cfg(unix)]
mod unix;
#[cfg(unix)]
use unix::{ancestor_pids, connect};

/// Events that fire dozens of times a minute carry no process chain: the island
/// learns it from the first event of the session, and the walk is not free.
const NO_CHAIN_EVENTS: &[&str] = &["PreToolUse", "PostToolUse", "PostToolUseFailure"];

fn main() {
    if std::env::args().skip(1).any(|a| a == "--statusline") {
        statusline();
        std::process::exit(0);
    }

    // Gemini CLI wants JSON on stdout and nothing else: "{}" says "nothing to add".
    let stdout_json = std::env::args().skip(1).any(|a| a == "--stdout-json");
    let finish = move |printed: bool| -> ! {
        if stdout_json && !printed {
            println!("{{}}");
        }
        std::process::exit(0)
    };

    let Some(Event { payload, name: event, ask_questions }) = read_event() else {
        finish(false)
    };

    let is_ask = ask_questions.is_some();
    let waits_for_answer = event == "PermissionRequest" || is_ask;
    let budget = if is_ask {
        ASK_BUDGET
    } else if waits_for_answer {
        DECISION_BUDGET
    } else {
        FIRE_AND_FORGET_BUDGET
    };

    // The worker owns every blocking call. If it overruns the budget we simply
    // stop listening and exit: the process dying takes the pipe handle with it.
    // (No catch_unwind here — the release profile is panic = "abort", so it would
    // be dead code. `talk` is written to have nothing to panic on instead.)
    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let _ = tx.send(talk(&payload, waits_for_answer));
    });

    let mut printed = false;
    if let Ok(Some(decision)) = rx.recv_timeout(budget) {
        let json = match &ask_questions {
            Some(questions) => answer_json(&decision, questions),
            None => decision_json(&decision),
        };
        if let Some(json) = json {
            let mut out = std::io::stdout();
            let _ = writeln!(out, "{json}");
            let _ = out.flush();
            printed = true;
        }
    }
    // Nothing printed: Claude Code asks in the terminal, as if we were not here.
    finish(printed)
}

/// Other agents speak their own dialect. Gemini CLI's hook events and tool names
/// are renamed to the ones the island already understands, so a Gemini session
/// reads like any other: BeforeAgent → UserPromptSubmit, AfterAgent → Stop,
/// BeforeTool → PreToolUse, AfterTool → PostToolUse; `replace` → Edit,
/// `write_file` → Write, `run_shell_command` → Bash and so on, with the path
/// arguments under the names the live diff expects.
fn normalize_agent(agent: &str, map: &mut serde_json::Map<String, serde_json::Value>) {
    use serde_json::Value;
    if agent != "gemini" {
        return;
    }

    let original = map.get("hook_event_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let renamed = match original.as_str() {
        "BeforeAgent" => "UserPromptSubmit",
        "AfterAgent" => "Stop",
        "BeforeTool" => "PreToolUse",
        "AfterTool" => "PostToolUse",
        _ => "",
    };
    if !renamed.is_empty() {
        map.insert("hook_event_name".into(), Value::String(renamed.into()));
    }
    // What the model answered is the closing line of a Stop.
    if original == "AfterAgent" {
        if let Some(answer) = map.get("prompt_response").and_then(|v| v.as_str()) {
            let line: String = answer.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
            if !line.is_empty() {
                map.insert("message".into(), Value::String(line));
            }
        }
    }

    let tool = match map.get("tool_name").and_then(|v| v.as_str()).unwrap_or("") {
        "replace" => "Edit",
        "write_file" => "Write",
        "run_shell_command" => "Bash",
        "read_file" | "read_many_files" => "Read",
        "glob" => "Glob",
        "search_file_content" | "grep_search" => "Grep",
        "list_directory" => "LS",
        "google_web_search" => "WebSearch",
        "web_fetch" => "WebFetch",
        other => other,
    }
    .to_string();
    if !tool.is_empty() {
        map.insert("tool_name".into(), Value::String(tool));
    }
    if let Some(input) = map.get_mut("tool_input").and_then(|i| i.as_object_mut()) {
        if !input.contains_key("file_path") {
            let path = ["absolute_path", "path", "file"].iter().find_map(|k| input.get(*k).cloned());
            if let Some(path) = path {
                input.insert("file_path".into(), path);
            }
        }
    }
}

/// The documented PermissionRequest output. Anything we do not recognise prints
/// nothing at all rather than guessing — silence is the safe answer.
/// See https://code.claude.com/docs/en/hooks
fn decision_json(decision: &str) -> Option<String> {
    let behavior = match decision.trim() {
        // "always" still answers a plain allow; remembering it is the island's
        // business, not Claude Code's.
        "allow" | "always" => r#"{"behavior":"allow"}"#.to_string(),
        "deny" => r#"{"behavior":"deny","message":"Denied from Coucou"}"#.to_string(),
        _ => return None,
    };
    Some(format!(
        r#"{{"hookSpecificOutput":{{"hookEventName":"PermissionRequest","decision":{behavior}}}}}"#
    ))
}

/// The documented PreToolUse output that answers an AskUserQuestion: Claude Code
/// receives the answers as if the person had typed them in the terminal.
/// Anything but a well-formed answer prints nothing, and Claude Code asks the
/// question in the terminal as usual.
fn answer_json(answer: &str, questions: &serde_json::Value) -> Option<String> {
    let reply: serde_json::Value = serde_json::from_str(answer.trim()).ok()?;
    if reply.get("decision").and_then(|v| v.as_str()) != Some("answer") {
        return None;
    }
    let answers = reply.get("answers").filter(|a| a.is_object())?;
    Some(
        serde_json::json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "updatedInput": { "questions": questions, "answers": answers },
            }
        })
        .to_string(),
    )
}

/// What `read_event` hands back.
struct Event {
    /// The line to forward to the island.
    payload: String,
    name: String,
    /// Set only for `--ask` on an AskUserQuestion: the original, untruncated
    /// questions, which have to travel back to Claude Code with the answers.
    ask_questions: Option<serde_json::Value>,
}

/// Reads stdin and returns the payload to forward plus the event name.
fn read_event() -> Option<Event> {
    let mut raw = Vec::new();
    if std::io::stdin().read_to_end(&mut raw).is_err() || raw.is_empty() {
        return None;
    }
    // Some shells hand us a UTF-8 BOM; serde_json would choke on it.
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }

    let mut payload = serde_json::from_slice::<serde_json::Value>(&raw).ok()?;
    let map = payload.as_object_mut()?;

    // Parse argv: "coucou-hook.exe [--agent <name>] [<EventName>]"
    // --agent tags the payload with coucou_agent so the app routes to the right pill.
    // Absent or invalid names are validated and discarded by the app, not here.
    let mut agent = String::new();
    let mut arg_event = String::new();
    let mut ask_flag = false;
    {
        let mut it = std::env::args().skip(1);
        while let Some(arg) = it.next() {
            if arg == "--agent" {
                agent = it.next().unwrap_or_default();
            } else if arg == "--ask" {
                ask_flag = true;
            } else if arg_event.is_empty() {
                arg_event = arg;
            }
        }
    }
    // Which agent this hook was installed for. Absent means Claude Code,
    // so existing hook commands keep working unchanged.
    if !agent.is_empty() {
        map.insert("coucou_agent".into(), serde_json::Value::String(agent.clone()));
    }
    let event = map
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or(arg_event);
    map.insert("hook_event_name".into(), serde_json::Value::String(event));
    normalize_agent(&agent, map);
    // After the renaming: the island and the rules below see the normal names.
    let event = map
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    for field in DROPPED_FIELDS {
        map.remove(*field);
    }

    // `--ask` only means something on the question tool. The questions are kept
    // whole (they are short) because Claude Code needs them back with the answers.
    let tool = map.get("tool_name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let ask_questions = if ask_flag && event == "PreToolUse" && tool == "AskUserQuestion" {
        let questions = map
            .get("tool_input")
            .and_then(|i| i.get("questions"))
            .filter(|q| q.is_array())
            .cloned();
        if questions.is_some() {
            map.insert("coucou_ask".into(), serde_json::Value::Bool(true));
        }
        questions
    } else {
        None
    };

    let cwd_missing = map
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::is_empty)
        .unwrap_or(true);
    if cwd_missing {
        if let Ok(cwd) = std::env::current_dir() {
            map.insert(
                "cwd".into(),
                serde_json::Value::String(cwd.to_string_lossy().to_string()),
            );
        }
    }

    // Which terminal the session runs in. Unlike macOS, Coucou here accepts
    // events from every terminal, so this is context only — never a filter.
    for (key, var) in [
        ("term_program", "TERM_PROGRAM"),
        ("wt_session", "WT_SESSION"),
        ("term_session_id", "TERM_SESSION_ID"),
        ("vscode_pid", "VSCODE_PID"),
        ("session_pid", "CLAUDE_CODE_SSE_PORT"),
    ] {
        if !map.contains_key(key) {
            let value = std::env::var(var).unwrap_or_default();
            map.insert(key.into(), serde_json::Value::String(value));
        }
    }

    // Where this session lives, so "Open terminal" can bring the right window
    // forward. A question's PreToolUse is the exception to the rule above: it
    // waits for a person, and the card needs to know the terminal it came from.
    if !NO_CHAIN_EVENTS.contains(&event.as_str()) || ask_questions.is_some() {
        let chain = ancestor_pids();
        if !chain.is_empty() {
            map.insert("ancestor_pids".into(), chain.into());
        }
    }

    let limit = if EDIT_TOOLS.contains(&tool.as_str()) { MAX_EDIT_FIELD_LEN } else { MAX_FIELD_LEN };
    truncate_strings(&mut payload, limit);

    let mut line = payload.to_string();
    line.push('\n');
    Some(Event { payload: line, name: event, ask_questions })
}

/// Caps every string in the payload. A single Write can carry a whole file.
fn truncate_strings(value: &mut serde_json::Value, limit: usize) {
    match value {
        serde_json::Value::String(s) => {
            if s.len() > limit {
                // Cut on a char boundary; a lone byte index can split UTF-8.
                let mut end = limit;
                while end > 0 && !s.is_char_boundary(end) {
                    end -= 1;
                }
                s.truncate(end);
                s.push('…');
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(|v| truncate_strings(v, limit)),
        serde_json::Value::Object(map) => map.values_mut().for_each(|v| truncate_strings(v, limit)),
        _ => {}
    }
}

// ── statusLine relay ──────────────────────────────────────────────────────────

/// Claude Code calls the statusLine command after every response, with a JSON on
/// stdin. We forward the plan usage to the island and then behave exactly like
/// the statusLine that was there before us, so the person's own status line
/// keeps working. Never blocks: the island gets a few hundred milliseconds.
fn statusline() {
    let mut raw = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut raw);
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }

    // Fire and forget, in the background, while the previous command runs.
    let (sent_tx, sent_rx) = mpsc::channel::<()>();
    if let Some(line) = statusline_message(&raw) {
        std::thread::spawn(move || {
            if let Some(mut pipe) = connect() {
                let _ = pipe.write_all(line.as_bytes());
                let _ = pipe.flush();
            }
            let _ = sent_tx.send(());
        });
    } else {
        drop(sent_tx);
    }

    if let Some(output) = run_previous_statusline(&raw) {
        let mut out = std::io::stdout();
        let _ = out.write_all(&output);
        let _ = out.flush();
    }
    // The send is already done by now in practice; this only bounds the worst case.
    let _ = sent_rx.recv_timeout(FIRE_AND_FORGET_BUDGET);
}

/// The one line Coucou needs out of a statusLine payload: the plan windows.
fn statusline_message(raw: &[u8]) -> Option<String> {
    let input: serde_json::Value = serde_json::from_slice(raw).ok()?;
    let mut msg = serde_json::Map::new();
    msg.insert("coucou_kind".into(), "statusline".into());
    if let Some(id) = input.get("session_id") {
        msg.insert("session_id".into(), id.clone());
    }
    // Absent on plans without limits, and on the first response of a session.
    if let Some(limits) = input.get("rate_limits").filter(|l| l.is_object()) {
        msg.insert("rate_limits".into(), limits.clone());
    }
    let mut line = serde_json::Value::Object(msg).to_string();
    line.push('\n');
    Some(line)
}

/// Runs the statusLine command that was installed before ours, if any, with the
/// same stdin, and returns what it printed. Colours and all.
fn run_previous_statusline(stdin: &[u8]) -> Option<Vec<u8>> {
    let file = std::env::current_exe().ok()?.parent()?.join("statusline-previous.json");
    let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    let command = saved
        .get("statusLine")
        .and_then(|s| s.get("command"))
        .and_then(|c| c.as_str())
        .filter(|c| !c.trim().is_empty())?
        .to_string();

    let mut cmd = shell_command(&command);
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let mut child = cmd.spawn().ok()?;
    if let Some(mut input) = child.stdin.take() {
        let data = stdin.to_vec();
        std::thread::spawn(move || {
            let _ = input.write_all(&data);
        });
    }
    let mut stdout = child.stdout.take()?;

    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    match rx.recv_timeout(PREVIOUS_STATUSLINE_BUDGET) {
        Ok(buf) => {
            let _ = child.wait();
            Some(buf)
        }
        Err(_) => {
            let _ = child.kill();
            None
        }
    }
}

#[cfg(windows)]
fn shell_command(command: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    // Claude Code runs these through Git Bash on Windows, so a command written
    // for it should run the same way here; cmd is the fallback.
    let git_sh = [r"C:\Program Files\Git\usr\bin\sh.exe", r"C:\Program Files\Git\bin\sh.exe"]
        .iter()
        .map(std::path::PathBuf::from)
        .find(|p| p.is_file());
    let mut cmd = match git_sh {
        Some(sh) => {
            let mut c = std::process::Command::new(sh);
            c.args(["-c", command]);
            c
        }
        None => {
            let mut c = std::process::Command::new("cmd");
            c.args(["/C", command]);
            c
        }
    };
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

#[cfg(unix)]
fn shell_command(command: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new("sh");
    cmd.args(["-c", command]);
    cmd
}

/// Connect, send, and — for a permission request — wait for the island's word.
fn talk(payload: &str, waits_for_answer: bool) -> Option<String> {
    let mut pipe = connect()?;

    if pipe.write_all(payload.as_bytes()).is_err() {
        return None;
    }
    let _ = pipe.flush();

    if !waits_for_answer {
        return None;
    }

    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.contains(&b'\n') {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let answer = String::from_utf8_lossy(&buf).trim().to_string();
    (!answer.is_empty()).then_some(answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decision_json_matches_the_documented_shape() {
        assert_eq!(
            decision_json("allow").unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#
        );
        assert_eq!(
            decision_json("deny").unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied from Coucou"}}}"#
        );
        // "always" is an island concept; Claude Code just gets an allow.
        assert!(decision_json("always").unwrap().contains(r#""behavior":"allow""#));
    }

    #[test]
    fn anything_unrecognised_prints_nothing() {
        assert!(decision_json("").is_none());
        assert!(decision_json("maybe").is_none());
        // The shape the app used to send must not be mistaken for a decision.
        assert!(decision_json(r#"{"permissionDecision":"allow"}"#).is_none());
    }

    #[test]
    fn long_strings_are_cut_on_a_char_boundary() {
        let mut v = serde_json::json!({ "tool_input": { "content": "é".repeat(4000) } });
        truncate_strings(&mut v, MAX_FIELD_LEN);
        let s = v["tool_input"]["content"].as_str().unwrap();
        assert!(s.len() <= MAX_FIELD_LEN + 4);
        assert!(s.ends_with('…'));
    }

    fn gemini(json: serde_json::Value) -> serde_json::Value {
        let mut v = json;
        normalize_agent("gemini", v.as_object_mut().unwrap());
        v
    }

    #[test]
    fn gemini_events_and_tools_get_the_names_the_island_knows() {
        let v = gemini(serde_json::json!({ "hook_event_name": "BeforeTool", "tool_name": "replace",
            "tool_input": { "absolute_path": "C:/p/a.ts", "old_string": "a", "new_string": "b" } }));
        assert_eq!(v["hook_event_name"], "PreToolUse");
        assert_eq!(v["tool_name"], "Edit");
        assert_eq!(v["tool_input"]["file_path"], "C:/p/a.ts", "the live diff reads file_path");

        let v = gemini(serde_json::json!({ "hook_event_name": "AfterTool", "tool_name": "run_shell_command",
            "tool_input": { "command": "npm test" } }));
        assert_eq!(v["hook_event_name"], "PostToolUse");
        assert_eq!(v["tool_name"], "Bash");

        let v = gemini(serde_json::json!({ "hook_event_name": "BeforeAgent", "prompt": "hi" }));
        assert_eq!(v["hook_event_name"], "UserPromptSubmit");
    }

    #[test]
    fn a_finished_gemini_turn_closes_with_its_answer() {
        let v = gemini(serde_json::json!({ "hook_event_name": "AfterAgent",
            "prompt_response": "  Done.\n\nThe tests   pass now. " }));
        assert_eq!(v["hook_event_name"], "Stop");
        assert_eq!(v["message"], "Done. The tests pass now.");
    }

    #[test]
    fn other_agents_and_unknown_gemini_events_pass_through_untouched() {
        let original = serde_json::json!({ "hook_event_name": "BeforeTool", "tool_name": "replace" });
        let mut other = original.clone();
        normalize_agent("opencode", other.as_object_mut().unwrap());
        assert_eq!(other, original);
        let v = gemini(serde_json::json!({ "hook_event_name": "SessionStart", "tool_name": "mcp_x_do" }));
        assert_eq!(v["hook_event_name"], "SessionStart");
        assert_eq!(v["tool_name"], "mcp_x_do");
    }

    #[test]
    fn an_answer_goes_back_with_the_original_questions() {
        let questions = serde_json::json!([{ "question": "Which?", "options": [{ "label": "A" }] }]);
        let reply = r#"{"decision":"answer","answers":{"Which?":"A"}}"#;
        let out: serde_json::Value =
            serde_json::from_str(&answer_json(reply, &questions).unwrap()).unwrap();
        let h = &out["hookSpecificOutput"];
        assert_eq!(h["hookEventName"], "PreToolUse");
        assert_eq!(h["permissionDecision"], "allow");
        assert_eq!(h["updatedInput"]["questions"], questions);
        assert_eq!(h["updatedInput"]["answers"]["Which?"], "A");
    }

    #[test]
    fn replying_in_the_terminal_or_garbage_prints_nothing() {
        let q = serde_json::json!([]);
        assert!(answer_json("ask", &q).is_none());
        assert!(answer_json("", &q).is_none());
        assert!(answer_json(r#"{"decision":"answer"}"#, &q).is_none());
        assert!(answer_json(r#"{"decision":"answer","answers":"x"}"#, &q).is_none());
        assert!(answer_json("allow", &q).is_none());
    }

    #[test]
    fn the_statusline_message_keeps_only_the_plan_usage() {
        let raw = br#"{"session_id":"s1","cwd":"C:/x","model":{"id":"m"},
            "rate_limits":{"five_hour":{"used_percentage":23.5,"resets_at":1738425600}}}"#;
        let line = statusline_message(raw).unwrap();
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["coucou_kind"], "statusline");
        assert_eq!(v["session_id"], "s1");
        assert_eq!(v["rate_limits"]["five_hour"]["used_percentage"], 23.5);
        assert!(v.get("cwd").is_none() && v.get("model").is_none());
        assert!(statusline_message(b"not json").is_none());
    }
}
