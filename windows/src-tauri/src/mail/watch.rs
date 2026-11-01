// src-tauri/src/mail/watch.rs

// Polls every watched folder's mbox file size every few seconds (same shape
// as sync.rs/codex_plan.rs). On growth, re-indexes just the new bytes and
// checks each new message for a verification code.

use super::{index, mbox, otp};
use mbox::MessageHeaders;

/// One poll tick's pure decision: given the newly-indexed messages for one
/// folder (from `index::rescan`), find at most one code to alert on (the
/// first match; `find_code` only looks at the subject and body start, kept
/// short on purpose — see otp.rs). Pure and I/O-free so it is cheap to test.
pub struct CodeAlert {
    pub code: String,
    pub subject: String,
    pub from: String,
}

/// `body_for` is injected so this stays a pure function in tests (no real
/// file reads); the real caller passes a closure that reads the message's
/// body from disk via `mbox::parse_body`.
fn code_alerts(new_messages: &[MessageHeaders], body_for: impl Fn(&MessageHeaders) -> String) -> Vec<CodeAlert> {
    let mut out = Vec::new();
    for h in new_messages {
        let body = body_for(h);
        if let Some(code) = otp::find_code(&h.subject, body.get(..body.len().min(500)).unwrap_or("")) {
            out.push(CodeAlert { code, subject: h.subject.clone(), from: h.from.clone() });
        }
    }
    out
}

const POLL_EVERY: std::time::Duration = std::time::Duration::from_secs(8);

/// Spawns the poll loop. Does nothing (no thread, no timer) while
/// `mail_watched_accounts` is empty — matches every other integration's
/// "off until you turn it on".
pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_EVERY);
        tick(&app);
    });
}

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// File sizes seen on the previous tick, per (account, folder) — debounces
/// indexing: a folder's growth is only committed to the index once its size
/// has stayed the same across two consecutive polls, so a message still being
/// written by Thunderbird's own sync is never indexed mid-write and cached
/// truncated forever (mbox.rs's split() has no way to tell "still being
/// appended" from "finished" — this is where that gets handled instead).
static PENDING_SIZE: LazyLock<Mutex<HashMap<(String, String), usize>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn tick(app: &tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let watched = shared.settings.lock().unwrap().mail_watched_accounts.clone();
    if watched.is_empty() {
        return;
    }
    let Some(state) = app.try_state::<super::MailState>() else { return };
    let root = super::profile::thunderbird_root();
    let Some(dir) = super::profile::default_profile_dir(&root) else { return };
    let mut any_new = false;
    let mut alerts = Vec::new();
    {
        let mut indexes = state.indexes.lock().unwrap();
        let mut pending = PENDING_SIZE.lock().unwrap();
        for account in super::profile::accounts(&dir).into_iter().filter(|a| watched.contains(&a.id)) {
            for folder in &account.folders {
                let Ok(bytes) = std::fs::read(&folder.mbox_path) else { continue };
                let key = (account.id.clone(), folder.name.clone());
                let seen_last_tick = pending.insert(key.clone(), bytes.len());
                if seen_last_tick != Some(bytes.len()) {
                    // Size changed since last tick (or this is the first time we've
                    // seen this folder): not stable yet, wait for the next tick.
                    continue;
                }
                let idx = indexes.entry(key).or_insert_with(index::FolderIndex::new);
                let new_messages = index::rescan(idx, &bytes);
                if new_messages.is_empty() {
                    continue;
                }
                any_new = true;
                let bytes_ref = &bytes;
                let found = code_alerts(&new_messages, |h| {
                    bytes_ref.get(h.offset..h.offset + h.len).and_then(mbox::parse_body).unwrap_or_default()
                });
                alerts.extend(found);
            }
        }
    }
    if any_new {
        let _ = app.emit("mail", ());
    }
    for alert in alerts {
        let _ = app.emit("mail-code", serde_json::json!({ "code": alert.code, "subject": alert.subject, "from": alert.from }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(subject: &str) -> MessageHeaders {
        MessageHeaders { offset: 0, len: 0, subject: subject.into(), from: "Ann <ann@example.com>".into(), date_rfc3339: String::new(), message_id: String::new() }
    }

    #[test]
    fn a_code_in_a_new_messages_subject_raises_one_alert() {
        let new = vec![header("Hola"), header("Tu código es 4821")];
        let body_for = |_h: &MessageHeaders| String::new();
        let alerts = code_alerts(&new, body_for);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].code, "4821");
        assert_eq!(alerts[0].subject, "Tu código es 4821");
    }

    #[test]
    fn no_trigger_word_means_no_alert() {
        let new = vec![header("Order #482193 shipped")];
        let body_for = |_h: &MessageHeaders| String::new();
        assert!(code_alerts(&new, body_for).is_empty());
    }

    #[test]
    fn a_code_only_in_the_body_is_found_too() {
        let new = vec![header("No subject code here")];
        let body_for = |_h: &MessageHeaders| "Your verification code is 9012".to_string();
        let alerts = code_alerts(&new, body_for);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].code, "9012");
    }
}
