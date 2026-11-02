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
        // First 500 characters, not bytes: a byte cut can land inside a
        // multi-byte character (accents, emoji) and lose the whole body.
        let start: String = body.chars().take(500).collect();
        if let Some(code) = otp::find_code(&h.subject, &start) {
            out.push(CodeAlert { code, subject: h.subject.clone(), from: h.from.clone() });
        }
    }
    out
}

/// One stable poll of one folder, I/O-free so it is testable. `tail` is the
/// file's bytes from `idx.scanned_len()` on (from 0 when `shrank`: Thunderbird
/// compacted the folder and the index starts over). Returns whether the
/// folder's list changed, and the new messages allowed to raise a code alert.
///
/// `watermark` is the folder's alert baseline: `None` until the folder has
/// been indexed once. The first scan (app start, a newly watched account) and
/// a compaction only index, silently — they set the watermark to the file's
/// length — so the codes already sitting in a mailbox never come back as new
/// cards. Only messages past the watermark alert, and only in INBOX: a code
/// moved to Trash or sent from Sent is not someone asking you for it.
fn step(idx: &mut index::FolderIndex, watermark: &mut Option<usize>, is_inbox: bool, shrank: bool, tail: &[u8]) -> (bool, Vec<MessageHeaders>) {
    if shrank {
        *idx = index::FolderIndex::new();
    }
    let new = index::append(idx, tail);
    let changed = shrank || !new.is_empty();
    if !is_inbox {
        return (changed, Vec::new());
    }
    let alertable = match *watermark {
        Some(wm) if !shrank => new.into_iter().filter(|h| h.offset >= wm).collect(),
        _ => Vec::new(),
    };
    *watermark = Some(idx.scanned_len());
    (changed, alertable)
}

const POLL_EVERY: std::time::Duration = std::time::Duration::from_secs(8);

/// Spawns the poll loop. The thread always runs; while
/// `mail_watched_accounts` is empty each tick returns before touching any
/// file — matches every other integration's "off until you turn it on".
pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_EVERY);
        tick(&app);
    });
}

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

type FolderKey = (String, String);

/// File sizes seen on the previous tick, per (account, folder) — debounces
/// indexing: a folder's growth is only committed to the index once its size
/// has stayed the same across two consecutive polls, so a message still being
/// written by Thunderbird's own sync is never indexed mid-write and cached
/// truncated forever (mbox.rs's split() has no way to tell "still being
/// appended" from "finished" — this is where that gets handled instead).
static PENDING_SIZE: LazyLock<Mutex<HashMap<FolderKey, usize>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Per INBOX, the file length up to which messages have already been seen —
/// the alert baseline `step` reads and moves. Separate from PENDING_SIZE on
/// purpose: that one is "is the file still being written", this one is
/// "has this folder ever been indexed".
static ALERT_WATERMARK: LazyLock<Mutex<HashMap<FolderKey, usize>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn tick(app: &tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let watched = shared.settings.lock().unwrap().mail_watched_accounts.clone();
    let Some(state) = app.try_state::<super::MailState>() else { return };
    let mut pending = PENDING_SIZE.lock().unwrap();
    let mut watermarks = ALERT_WATERMARK.lock().unwrap();
    // An account taken off the list forgets everything, so ticking it again
    // later is a fresh, silent baseline rather than a replay of what arrived
    // in between.
    let keep = |(account, _): &FolderKey| watched.contains(account);
    pending.retain(|k, _| keep(k));
    watermarks.retain(|k, _| keep(k));
    state.indexes.lock().unwrap().retain(|k, _| keep(k));
    if watched.is_empty() {
        return;
    }
    let root = super::profile::thunderbird_root();
    let Some(dir) = super::profile::default_profile_dir(&root) else { return };
    let mut any_new = false;
    let mut alerts = Vec::new();
    for account in super::profile::accounts(&dir).into_iter().filter(|a| watched.contains(&a.id)) {
        for folder in &account.folders {
            // Size from metadata: no file read until it changed and settled.
            let Ok(meta) = std::fs::metadata(&folder.mbox_path) else { continue };
            let size = meta.len() as usize;
            let key = (account.id.clone(), folder.name.clone());
            if pending.insert(key.clone(), size) != Some(size) {
                // Size changed since last tick (or this is the first time we've
                // seen this folder): not stable yet, wait for the next tick.
                continue;
            }
            let is_inbox = folder.name.eq_ignore_ascii_case("INBOX");
            let scanned = state.indexes.lock().unwrap().get(&key).map(index::FolderIndex::scanned_len);
            let shrank = scanned.is_some_and(|n| size < n);
            let base = if shrank { 0 } else { scanned.unwrap_or(0) };
            if scanned.is_some() && size == base && (!is_inbox || watermarks.contains_key(&key)) {
                continue; // nothing new since the last commit
            }
            // Only the new end of the file, read outside the index lock (this
            // thread is the only writer, so `base` can't move meanwhile).
            let tail = if size > base {
                match super::read_range(&folder.mbox_path, base, size - base) {
                    Ok(t) => t,
                    Err(_) => continue,
                }
            } else {
                Vec::new()
            };
            let mut wm = watermarks.get(&key).copied();
            let (changed, to_check) = {
                let mut indexes = state.indexes.lock().unwrap();
                step(indexes.entry(key.clone()).or_default(), &mut wm, is_inbox, shrank, &tail)
            };
            if let Some(w) = wm {
                watermarks.insert(key, w);
            }
            any_new |= changed;
            alerts.extend(code_alerts(&to_check, |h| {
                let at = h.offset - base; // every message in to_check came from `tail`
                tail.get(at..at + h.len).and_then(mbox::parse_body).unwrap_or_default()
            }));
        }
    }
    drop((pending, watermarks));
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
        MessageHeaders { offset: 0, len: 0, subject: subject.into(), from: "Ann <ann@example.com>".into(), date_rfc3339: String::new(), message_id: String::new(), timestamp: 0, expunged: false }
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

    #[test]
    fn a_multibyte_character_at_byte_500_does_not_lose_the_body() {
        let new = vec![header("Hola")];
        // The code sits early; "é" straddles bytes 499-500, where a byte slice
        // at 500 returned None and the whole body was skipped.
        let body = format!("tu código es 5512 {}é{}", "a".repeat(499 - "tu código es 5512 ".len()), "b".repeat(100));
        assert!(!body.is_char_boundary(500));
        let alerts = code_alerts(&new, |_h| body.clone());
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].code, "5512");
    }

    // ── C-1 / I-2: the alert baseline ────────────────────────────────────

    const OLD_CODE: &[u8] = b"From a Mon Oct 26 09:00:00 2026\r\nFrom: Bank <b@example.com>\r\nSubject: Tu codigo es 1111\r\n\r\nHi\r\n";
    const PLAIN: &[u8] = b"From b Tue Oct 27 10:00:00 2026\r\nFrom: Bo <bo@example.com>\r\nSubject: Lunch\r\n\r\nHey\r\n";
    const NEW_CODE: &[u8] = b"From c Wed Oct 28 10:00:00 2026\r\nFrom: Bank <b@example.com>\r\nSubject: Tu codigo es 2222\r\n\r\nHi\r\n";

    fn alerts_for(found: &[MessageHeaders]) -> Vec<CodeAlert> {
        code_alerts(found, |_h| String::new())
    }

    #[test]
    fn the_first_scan_indexes_old_codes_silently() {
        let mut idx = index::FolderIndex::new();
        let mut wm = None;
        let file = [OLD_CODE, PLAIN].concat();
        let (changed, to_check) = step(&mut idx, &mut wm, true, false, &file);
        assert!(changed);
        assert_eq!(idx.messages().len(), 2);
        assert!(alerts_for(&to_check).is_empty());
        assert_eq!(wm, Some(file.len()));
    }

    #[test]
    fn a_code_that_arrives_after_the_baseline_alerts_exactly_once() {
        let mut idx = index::FolderIndex::new();
        let mut wm = None;
        let file = [OLD_CODE, PLAIN].concat();
        step(&mut idx, &mut wm, true, false, &file);
        let (changed, to_check) = step(&mut idx, &mut wm, true, false, NEW_CODE);
        assert!(changed);
        let alerts = alerts_for(&to_check);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].code, "2222");
        assert_eq!(wm, Some(file.len() + NEW_CODE.len()));
        // Nothing more arrived: nothing more alerts.
        let (changed, to_check) = step(&mut idx, &mut wm, true, false, b"");
        assert!(!changed && to_check.is_empty());
    }

    #[test]
    fn a_compaction_rebuilds_the_index_without_replaying_codes() {
        let mut idx = index::FolderIndex::new();
        let mut wm = None;
        step(&mut idx, &mut wm, true, false, &[OLD_CODE, PLAIN].concat());
        step(&mut idx, &mut wm, true, false, NEW_CODE);
        // Thunderbird compacted: PLAIN was deleted, the file is shorter.
        let compacted = [OLD_CODE, NEW_CODE].concat();
        let (changed, to_check) = step(&mut idx, &mut wm, true, true, &compacted);
        assert!(changed);
        assert!(alerts_for(&to_check).is_empty());
        assert_eq!(idx.messages().len(), 2);
        assert_eq!(wm, Some(compacted.len()));
        // And the next real arrival after the compaction still alerts.
        let (_, to_check) = step(&mut idx, &mut wm, true, false, NEW_CODE);
        assert_eq!(alerts_for(&to_check).len(), 1);
    }

    #[test]
    fn an_empty_inbox_alerts_on_its_very_first_message() {
        let mut idx = index::FolderIndex::new();
        let mut wm = None;
        step(&mut idx, &mut wm, true, false, b"");
        assert_eq!(wm, Some(0));
        let (_, to_check) = step(&mut idx, &mut wm, true, false, NEW_CODE);
        assert_eq!(alerts_for(&to_check).len(), 1);
    }

    #[test]
    fn folders_other_than_inbox_are_indexed_but_never_alert() {
        let mut idx = index::FolderIndex::new();
        let mut wm = None;
        step(&mut idx, &mut wm, false, false, OLD_CODE);
        let (changed, to_check) = step(&mut idx, &mut wm, false, false, NEW_CODE);
        assert!(changed);
        assert!(to_check.is_empty());
        assert_eq!(idx.messages().len(), 2);
        assert_eq!(wm, None);
    }
}
