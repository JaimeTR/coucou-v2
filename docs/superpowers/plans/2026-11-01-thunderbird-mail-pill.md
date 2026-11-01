# Thunderbird Mail Pill (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new, read-only Mail pill in Coucou's Windows/Linux app that shows the user's Thunderbird mail — an inbox list, search, reading a message — and raises a dedicated card with the code when a verification code (OTP) arrives, without ever writing to Thunderbird's own files or making a network call.

**Architecture:** A new Rust module `src-tauri/src/mail/` reads Thunderbird's local profile directly (mbox files for folders, `profiles.ini` for account discovery), builds its own small in-memory per-folder index from mbox headers (no dependency on Thunderbird's gloda search index — see the spec's correction section for why), and polls each watched folder's file size for new mail. A TypeScript side (`src/views/mail.ts`, `src/views/mailcode.ts`) renders the list/reader and the code card, wired into the existing pill/island/Settings patterns the same way `whatsapp`/`github` are today.

**Tech Stack:** Rust (Tauri 2 backend), the `mail-parser` crate (RFC 822/MIME parsing — verified API, version 1.0.0) for per-message header/body decoding, TypeScript (no framework, the project's own `h()`/`views` pattern).

**Spec:** [docs/superpowers/specs/2026-11-01-thunderbird-mail-pill-design.md](../specs/2026-11-01-thunderbird-mail-pill-design.md)

## Global Constraints

- Read-only, always: this module never writes to any file under a Thunderbird profile.
- Zero network calls of its own for this feature.
- Nothing is persisted to disk by Coucou for this feature: the per-folder index and any decoded body live in memory only, rebuilt fresh each app start.
- Off by default: a watched-accounts list defaults to empty; nothing is read until the user picks an account in Settings.
- Logging (`crate::log::line`) never includes a subject, sender, body, or detected code — folder names and counts only, matching `whatsapp`/`github`.
- The new pill id is `integration_mail_thunderbird` — a stable contract per CLAUDE.md, never renamed once it ships.
- New Cargo dependency: `mail-parser = "1.0.0"` (crates.io, MIT/Apache-2.0, verified against its docs.rs page while writing this plan — see Task 2).

---

### Task 1: `otp.rs` — verification-code detection

**Files:**
- Create: `src-tauri/src/mail/otp.rs`
- Test: inline `#[cfg(test)] mod tests` in the same file (matches the project's convention — see `src-tauri/src/github.rs`)

**Interfaces:**
- Consumes: nothing (pure function, no I/O).
- Produces: `pub fn find_code(subject: &str, body_start: &str) -> Option<String>` — used by Task 6 (`watch.rs`).

- [ ] **Step 1: Write the failing tests**

```rust
// src-tauri/src/mail/otp.rs

// Verification-code (OTP) detection: a run of 4-8 digits near a trigger word,
// in the subject or the first part of the body. Pure function, no I/O — the
// caller decides what counts as "the first part of the body" and never hands
// this more than it has to (see watch.rs).

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_code_next_to_a_trigger_word_in_spanish_or_english() {
        assert_eq!(find_code("Tu código es 482913", ""), Some("482913".into()));
        assert_eq!(find_code("Verification code: 7734", ""), Some("7734".into()));
        assert_eq!(find_code("", "Your OTP is 5521 - do not share it"), Some("5521".into()));
        assert_eq!(find_code("Clave de acceso: 90-21-44", ""), Some("902144".into()));
    }

    #[test]
    fn ignores_digit_runs_with_no_trigger_word_nearby() {
        assert_eq!(find_code("Your order #4820391 has shipped", ""), None);
        assert_eq!(find_code("Invoice total: $192.50", "Thanks for your purchase"), None);
        assert_eq!(find_code("Call us at 555-0142-9981", ""), None);
    }

    #[test]
    fn ignores_runs_shorter_than_4_or_longer_than_8_digits() {
        assert_eq!(find_code("Your code is 12", ""), None);
        assert_eq!(find_code("Your code is 123456789012", ""), None);
    }

    #[test]
    fn the_subject_is_checked_before_the_body() {
        // A code in the subject wins even if the body also has a run of digits.
        assert_eq!(find_code("Code: 1111", "unrelated 2222 numbers here"), Some("1111".into()));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `windows/src-tauri`): `cargo test --lib mail::otp:: 2>&1 | tail -20`
Expected: FAIL to compile — `find_code` is not defined.

- [ ] **Step 3: Write the minimal implementation**

Add above the `#[cfg(test)]` block in the same file:

```rust
const TRIGGER_WORDS: &[&str] = &[
    "código", "codigo", "code", "verification", "verifica", "otp",
    "one-time", "one time", "security code", "clave de acceso",
];

/// Groups like "90-21-44" or "123 456" collapse to one run before counting digits.
fn digit_runs(text: &str) -> Vec<(usize, usize, String)> {
    let mut runs = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            let mut digits = String::new();
            let mut j = i;
            while j < chars.len() && (chars[j].is_ascii_digit() || ((chars[j] == '-' || chars[j] == ' ') && j + 1 < chars.len() && chars[j + 1].is_ascii_digit())) {
                if chars[j].is_ascii_digit() {
                    digits.push(chars[j]);
                }
                j += 1;
            }
            if (4..=8).contains(&digits.len()) {
                runs.push((start, j, digits));
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
    runs
}

/// A trigger word within this many characters of a digit run counts as "near it".
const NEAR: usize = 40;

fn code_in(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    for (start, end, digits) in digit_runs(text) {
        let window_start = start.saturating_sub(NEAR);
        let window_end = (end + NEAR).min(lower.chars().count());
        let window: String = lower.chars().skip(window_start).take(window_end - window_start).collect();
        if TRIGGER_WORDS.iter().any(|w| window.contains(w)) {
            return Some(digits);
        }
    }
    None
}

/// The subject is checked first (codes are almost always there), then the body.
pub fn find_code(subject: &str, body_start: &str) -> Option<String> {
    code_in(subject).or_else(|| code_in(body_start))
}
```

Register the module: add `pub mod otp;` to `src-tauri/src/mail/mod.rs` (create it now with just that line; Task 5 fills it in).

```rust
// src-tauri/src/mail/mod.rs
pub mod otp;
```

And register `mail` itself in `src-tauri/src/lib.rs`: add `mod mail;` next to the other `mod` lines (alphabetical order, near `log`/`modes`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib mail::otp:: 2>&1 | tail -20`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add windows/src-tauri/src/mail/mod.rs windows/src-tauri/src/mail/otp.rs windows/src-tauri/src/lib.rs
git commit -m "mail: add OTP/verification-code detection (otp.rs)"
```

---

### Task 2: `mbox.rs` — split an mbox file and decode one message

**Files:**
- Create: `src-tauri/src/mail/mbox.rs`
- Modify: `src-tauri/Cargo.toml` (add the `mail-parser` dependency)
- Test: inline `#[cfg(test)] mod tests`, plus one fixture file

**Interfaces:**
- Consumes: raw bytes of an mbox file (read by the caller — this module takes `&[u8]`, never opens a file itself, so it stays trivially testable).
- Produces:
  - `pub struct MessageHeaders { pub offset: usize, pub len: usize, pub subject: String, pub from: String, pub date_rfc3339: String, pub message_id: String }` — used by `index.rs` (Task 3).
  - `pub fn split(mbox: &[u8]) -> Vec<(usize, usize)>` — byte `(offset, len)` ranges of each raw message, in file order.
  - `pub fn parse_headers(raw: &[u8]) -> MessageHeaders` — headers only, cheap (`mail-parser` decodes headers eagerly but only decodes the body when asked, so this is fast even though it's the same parse call as `parse_body`).
  - `pub fn parse_body(raw: &[u8]) -> Option<String>` — the decoded plain-text body, `None` if the message has none.

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, in the `[dependencies]` section (near `base64`):

```toml
mail-parser = "1.0.0"
```

- [ ] **Step 2: Write the failing tests**

```rust
// src-tauri/src/mail/mbox.rs

// Reads one mbox file's worth of bytes: splits it into individual raw RFC 822
// messages on the standard "From " envelope line, then decodes one message's
// headers or body on request via the `mail-parser` crate (RFC 2047 encoded
// words, quoted-printable, base64 and charset are its job, not ours).

use mail_parser::MessageParser;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageHeaders {
    pub offset: usize,
    pub len: usize,
    pub subject: String,
    pub from: String,
    pub date_rfc3339: String,
    pub message_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    const TWO_MESSAGES: &[u8] = b"From MAILER-DAEMON Mon Oct 26 09:00:00 2026\r\n\
From: Ann <ann@example.com>\r\n\
Subject: Hi there\r\n\
Date: Mon, 26 Oct 2026 09:00:00 +0000\r\n\
Message-ID: <first@example.com>\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
\r\n\
Hello!\r\n\
\r\n\
From MAILER-DAEMON Tue Oct 27 10:00:00 2026\r\n\
From: Bo <bo@example.com>\r\n\
Subject: Your code is 4821\r\n\
Date: Tue, 27 Oct 2026 10:00:00 +0000\r\n\
Message-ID: <second@example.com>\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
Content-Transfer-Encoding: quoted-printable\r\n\
\r\n\
Code=3A 4821\r\n";

    #[test]
    fn splits_an_mbox_file_into_two_message_ranges() {
        let ranges = split(TWO_MESSAGES);
        assert_eq!(ranges.len(), 2);
        let (o0, l0) = ranges[0];
        let (o1, l1) = ranges[1];
        assert_eq!(o0, 0);
        assert!(l0 > 0 && l1 > 0);
        assert_eq!(o1, o0 + l0);
    }

    #[test]
    fn parses_subject_from_and_date_of_the_second_message() {
        let ranges = split(TWO_MESSAGES);
        let (offset, len) = ranges[1];
        let raw = &TWO_MESSAGES[offset..offset + len];
        let headers = parse_headers(raw, offset, len);
        assert_eq!(headers.subject, "Your code is 4821");
        assert!(headers.from.contains("Bo"));
        assert!(headers.from.contains("bo@example.com"));
        assert!(headers.date_rfc3339.starts_with("2026-10-27"));
        assert_eq!(headers.message_id, "second@example.com");
    }

    #[test]
    fn decodes_a_quoted_printable_body() {
        let ranges = split(TWO_MESSAGES);
        let (offset, len) = ranges[1];
        let raw = &TWO_MESSAGES[offset..offset + len];
        let body = parse_body(raw).unwrap();
        assert!(body.contains("Code: 4821"), "got: {body:?}");
    }

    #[test]
    fn an_empty_or_unparsable_message_never_panics() {
        assert_eq!(split(b""), Vec::<(usize, usize)>::new());
        let headers = parse_headers(b"not a valid email at all", 0, 0);
        assert_eq!(headers.subject, "");
        assert_eq!(parse_body(b"not a valid email at all"), None);
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --lib mail::mbox:: 2>&1 | tail -30`
Expected: FAIL to compile — `split`, `parse_headers`, `parse_body` not defined.

- [ ] **Step 4: Write the minimal implementation**

Above the test module:

```rust
/// Byte ranges of each raw RFC 822 message in an mbox file, in file order. A
/// message starts at byte 0 or right after a line that is exactly "From "
/// followed by anything, at the start of a line (the mbox envelope
/// separator) — that line itself is not part of the message and is skipped.
pub fn split(mbox: &[u8]) -> Vec<(usize, usize)> {
    if mbox.is_empty() {
        return Vec::new();
    }
    let mut starts = Vec::new();
    let mut i = 0;
    while i < mbox.len() {
        let at_line_start = i == 0 || mbox[i - 1] == b'\n';
        if at_line_start && mbox[i..].starts_with(b"From ") {
            let line_end = mbox[i..].iter().position(|&b| b == b'\n').map(|p| i + p + 1).unwrap_or(mbox.len());
            starts.push(line_end);
            i = line_end;
        } else {
            i += 1;
        }
    }
    if starts.is_empty() {
        return Vec::new();
    }
    let mut ranges = Vec::with_capacity(starts.len());
    for (idx, &start) in starts.iter().enumerate() {
        let end = starts.get(idx + 1).copied().unwrap_or(mbox.len());
        ranges.push((start, end - start));
    }
    ranges
}

fn display_mailbox(m: Option<mail_parser::Mailbox>) -> String {
    let Some(m) = m else { return String::new() };
    match (m.name(), m.address()) {
        (Some(name), Some(addr)) => format!("{name} <{addr}>"),
        (Some(name), None) => name.to_string(),
        (None, Some(addr)) => addr.to_string(),
        (None, None) => String::new(),
    }
}

/// Headers only — cheap even though it goes through the same parser as the
/// body, since `mail-parser` decodes the body lazily on `.body_text()`.
pub fn parse_headers(raw: &[u8], offset: usize, len: usize) -> MessageHeaders {
    let Some(message) = MessageParser::new().parse(raw) else {
        return MessageHeaders { offset, len, subject: String::new(), from: String::new(), date_rfc3339: String::new(), message_id: String::new() };
    };
    MessageHeaders {
        offset,
        len,
        subject: message.subject().unwrap_or_default().to_string(),
        from: display_mailbox(message.from().and_then(|l| l.first())),
        date_rfc3339: message.date().map(|d| d.to_rfc3339()).unwrap_or_default(),
        message_id: message.message_id().unwrap_or_default().to_string(),
    }
}

/// The plain-text body, decoded (quoted-printable/base64, charset, RFC 2047).
/// `None` for a message with no text part at all, or one that fails to parse.
pub fn parse_body(raw: &[u8]) -> Option<String> {
    let message = MessageParser::new().parse(raw)?;
    message.body_text(0).map(|cow| cow.into_owned())
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --lib mail::mbox:: 2>&1 | tail -20`
Expected: PASS, 4 tests. If `decodes_a_quoted_printable_body` fails on the exact decoded text, print `body` (the test already does via `{body:?}` on failure) and adjust the assertion to match what `mail-parser` actually returns — the crate's exact whitespace/line-ending handling on decode is the one thing in this task not already verified against a real run.

- [ ] **Step 6: Commit**

```bash
git add windows/src-tauri/Cargo.toml windows/src-tauri/Cargo.lock windows/src-tauri/src/mail/mbox.rs
git commit -m "mail: split and decode mbox messages (mbox.rs, mail-parser crate)"
```

---

### Task 3: `index.rs` — the in-memory per-folder index

**Files:**
- Create: `src-tauri/src/mail/index.rs`
- Test: inline `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: `mbox::split`, `mbox::parse_headers`, `mbox::MessageHeaders` (Task 2).
- Produces:
  - `pub struct FolderIndex { .. }` with `pub fn new() -> Self`, `pub fn messages(&self) -> &[MessageHeaders]` (newest first), `pub fn search(&self, query: &str) -> Vec<&MessageHeaders>`.
  - `pub fn rescan(index: &mut FolderIndex, mbox_bytes: &[u8]) -> Vec<MessageHeaders>` — re-syncs the index against the current file bytes and returns just the messages that are new since the last call (empty on the first call after a reset, since "new" has no meaning yet — see `watch.rs`, Task 6, for how the very first scan is handled so nothing floods in as "new").

- [ ] **Step 1: Write the failing tests**

```rust
// src-tauri/src/mail/index.rs

// Coucou's own lightweight stand-in for Thunderbird's search index: headers
// only, built by reading mbox files directly (see mbox.rs for why — gloda's
// full-text tables need a tokenizer only Thunderbird itself registers).
// Lives in memory only; rebuilt from scratch every time the app starts.

use super::mbox::{self, MessageHeaders};

#[derive(Default)]
pub struct FolderIndex {
    last_scanned_len: usize,
    messages: Vec<MessageHeaders>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIRST: &[u8] = b"From a Mon Oct 26 09:00:00 2026\r\nFrom: Ann <ann@example.com>\r\nSubject: One\r\nDate: Mon, 26 Oct 2026 09:00:00 +0000\r\nMessage-ID: <1@example.com>\r\n\r\nHi\r\n";
    const SECOND: &[u8] = b"From b Tue Oct 27 10:00:00 2026\r\nFrom: Bo <bo@example.com>\r\nSubject: Two\r\nDate: Tue, 27 Oct 2026 10:00:00 +0000\r\nMessage-ID: <2@example.com>\r\n\r\nHey\r\n";

    #[test]
    fn the_first_rescan_indexes_everything_and_reports_it_all_as_new() {
        let mut idx = FolderIndex::new();
        let new = rescan(&mut idx, FIRST);
        assert_eq!(new.len(), 1);
        assert_eq!(idx.messages().len(), 1);
    }

    #[test]
    fn a_second_rescan_with_no_growth_reports_nothing_new() {
        let mut idx = FolderIndex::new();
        rescan(&mut idx, FIRST);
        let new = rescan(&mut idx, FIRST);
        assert!(new.is_empty());
        assert_eq!(idx.messages().len(), 1);
    }

    #[test]
    fn a_rescan_after_growth_reports_only_the_appended_message() {
        let mut idx = FolderIndex::new();
        rescan(&mut idx, FIRST);
        let mut grown = FIRST.to_vec();
        grown.extend_from_slice(SECOND);
        let new = rescan(&mut idx, &grown);
        assert_eq!(new.len(), 1);
        assert_eq!(new[0].subject, "Two");
        assert_eq!(idx.messages().len(), 2);
    }

    #[test]
    fn a_file_that_shrank_rebuilds_from_scratch_instead_of_erroring() {
        let mut idx = FolderIndex::new();
        let mut grown = FIRST.to_vec();
        grown.extend_from_slice(SECOND);
        rescan(&mut idx, &grown);
        assert_eq!(idx.messages().len(), 2);
        // Thunderbird compacted the folder: the file is now shorter (and
        // different content). The index must not panic or keep stale data.
        let new = rescan(&mut idx, FIRST);
        assert_eq!(new.len(), 1);
        assert_eq!(idx.messages().len(), 1);
    }

    #[test]
    fn newest_first_and_search_matches_subject_or_sender_case_insensitively() {
        let mut idx = FolderIndex::new();
        let mut grown = FIRST.to_vec();
        grown.extend_from_slice(SECOND);
        rescan(&mut idx, &grown);
        assert_eq!(idx.messages()[0].subject, "Two"); // newest first
        assert_eq!(idx.search("ann").len(), 1);
        assert_eq!(idx.search("TWO").len(), 1);
        assert_eq!(idx.search("nobody").len(), 0);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --lib mail::index:: 2>&1 | tail -30`
Expected: FAIL to compile — `FolderIndex::new`, `rescan`, `messages`, `search` not defined.

- [ ] **Step 3: Write the minimal implementation**

```rust
impl FolderIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Newest message first.
    pub fn messages(&self) -> &[MessageHeaders] {
        &self.messages
    }

    pub fn search(&self, query: &str) -> Vec<&MessageHeaders> {
        let needle = query.to_lowercase();
        if needle.is_empty() {
            return self.messages.iter().collect();
        }
        self.messages
            .iter()
            .filter(|m| m.subject.to_lowercase().contains(&needle) || m.from.to_lowercase().contains(&needle))
            .collect()
    }
}

/// Re-syncs `index` against the current bytes of a folder's mbox file.
/// Returns only the messages that are new since the last call: empty when
/// nothing grew, everything when the file shrank (Thunderbird compacted it)
/// or this is the very first scan after a `FolderIndex::new()`.
pub fn rescan(index: &mut FolderIndex, mbox_bytes: &[u8]) -> Vec<MessageHeaders> {
    if mbox_bytes.len() < index.last_scanned_len {
        // Shrank: the old offsets are meaningless. Start over.
        index.messages.clear();
        index.last_scanned_len = 0;
    }
    let from_offset = index.last_scanned_len;
    let new_bytes = &mbox_bytes[from_offset..];
    let ranges = mbox::split(new_bytes);
    let mut added = Vec::with_capacity(ranges.len());
    for (offset, len) in ranges {
        let raw = &new_bytes[offset..offset + len];
        let headers = mbox::parse_headers(raw, from_offset + offset, len);
        added.push(headers);
    }
    index.last_scanned_len = mbox_bytes.len();
    // Newest first in the stored list: new messages (append-only in the
    // file) go to the front.
    for h in added.iter().rev() {
        index.messages.insert(0, h.clone());
    }
    added
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib mail::index:: 2>&1 | tail -20`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add windows/src-tauri/src/mail/index.rs
git commit -m "mail: in-memory per-folder index, incremental by file size (index.rs)"
```

---

### Task 4: `profile.rs` — find the Thunderbird profile and its accounts

**Files:**
- Create: `src-tauri/src/mail/profile.rs`
- Test: inline `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: nothing beyond the filesystem (takes a root directory as a parameter in every function so tests never touch the real `%APPDATA%`).
- Produces:
  - `pub struct Account { pub id: String, pub label: String, pub folders: Vec<Folder> }`, `pub struct Folder { pub name: String, pub mbox_path: PathBuf }`.
  - `pub fn default_profile_dir(thunderbird_root: &Path) -> Option<PathBuf>` — reads `profiles.ini` under `thunderbird_root`, returns the default profile's full path.
  - `pub fn accounts(profile_dir: &Path) -> Vec<Account>` — lists `ImapMail/<server>` and `Mail/Local Folders` as accounts, each account's direct children that are **not** `.msf`/`.dat`/`.sqlite` files as its folders (an mbox folder file has no extension; its index sits beside it as `<name>.msf`).
  - `pub fn thunderbird_root() -> PathBuf` — the real `%APPDATA%\Thunderbird` (Windows) / `~/.thunderbird` (Linux) location, used only by `mod.rs` (Task 5), never by these tests.

- [ ] **Step 1: Write the failing tests**

```rust
// src-tauri/src/mail/profile.rs

// Finds the user's Thunderbird profile and lists what it has configured —
// never touches prefs.js beyond locating the default profile's folder, never
// reads mail content. Every function here takes a root path so tests run
// against a throwaway directory, never the developer's real profile.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Folder {
    pub name: String,
    pub mbox_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub label: String,
    pub folders: Vec<Folder>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("coucou-mail-profile-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_the_default_profile_from_profiles_ini() {
        let root = fixture_root();
        fs::write(
            root.join("profiles.ini"),
            "[Profile0]\nName=default\nIsRelative=1\nPath=abc123.default-release\nDefault=1\n\n[Profile1]\nName=old\nIsRelative=1\nPath=zzz.old\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("abc123.default-release")).unwrap();
        let found = default_profile_dir(&root).unwrap();
        assert_eq!(found, root.join("abc123.default-release"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn no_profiles_ini_means_no_profile_found() {
        let root = fixture_root();
        assert_eq!(default_profile_dir(&root), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lists_imap_and_local_accounts_with_their_mbox_folders() {
        let root = fixture_root();
        let imap = root.join("ImapMail").join("imap.example.com");
        fs::create_dir_all(&imap).unwrap();
        fs::write(imap.join("INBOX"), b"").unwrap();
        fs::write(imap.join("INBOX.msf"), b"").unwrap();
        fs::write(imap.join("Sent"), b"").unwrap();
        let local = root.join("Mail").join("Local Folders");
        fs::create_dir_all(&local).unwrap();
        fs::write(local.join("Trash"), b"").unwrap();

        let accounts = accounts(&root);
        let imap_account = accounts.iter().find(|a| a.id.contains("imap.example.com")).unwrap();
        let mut names: Vec<&str> = imap_account.folders.iter().map(|f| f.name.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["INBOX", "Sent"]);

        let local_account = accounts.iter().find(|a| a.label == "Carpetas locales").unwrap();
        assert_eq!(local_account.folders.len(), 1);
        assert_eq!(local_account.folders[0].name, "Trash");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_profile_with_no_mail_at_all_lists_no_accounts() {
        let root = fixture_root();
        assert_eq!(accounts(&root), Vec::<Account>::new());
        let _ = fs::remove_dir_all(&root);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --lib mail::profile:: 2>&1 | tail -30`
Expected: FAIL to compile — `default_profile_dir`, `accounts` not defined.

- [ ] **Step 3: Write the minimal implementation**

```rust
/// A dead-simple `profiles.ini` reader: enough to find the section with
/// `Default=1` (or the only section, if there is just one) and its `Path`.
/// `IsRelative=1` (the normal case) means the path is relative to `root`.
pub fn default_profile_dir(root: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(root.join("profiles.ini")).ok()?;
    let mut sections: Vec<Vec<(String, String)>> = Vec::new();
    let mut current: Option<Vec<(String, String)>> = None;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            if let Some(done) = current.take() {
                sections.push(done);
            }
            if line.starts_with("[Profile") {
                current = Some(Vec::new());
            }
        } else if let Some(section) = current.as_mut() {
            if let Some((k, v)) = line.split_once('=') {
                section.push((k.trim().to_string(), v.trim().to_string()));
            }
        }
    }
    if let Some(done) = current.take() {
        sections.push(done);
    }
    let get = |s: &[(String, String)], key: &str| s.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
    let chosen = sections
        .iter()
        .find(|s| get(s, "Default").as_deref() == Some("1"))
        .or_else(|| sections.first())?;
    let path = get(chosen, "Path")?;
    let is_relative = get(chosen, "IsRelative").as_deref() != Some("0");
    let dir = if is_relative { root.join(&path) } else { PathBuf::from(&path) };
    dir.is_dir().then_some(dir)
}

fn folders_in(dir: &Path) -> Vec<Folder> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // An mbox folder file has no extension; its sibling index does
        // (.msf) and so do a handful of Thunderbird bookkeeping files.
        if path.extension().is_some() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        out.push(Folder { name: name.to_string(), mbox_path: path.clone() });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Every IMAP account under `ImapMail/`, plus "Carpetas locales" if the
/// profile has any `Mail/Local Folders`. Accounts with no folders at all are
/// left out.
pub fn accounts(profile_dir: &Path) -> Vec<Account> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(profile_dir.join("ImapMail")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(server) = path.file_name().and_then(|n| n.to_str()) else { continue };
            let folders = folders_in(&path);
            if !folders.is_empty() {
                out.push(Account { id: format!("imap:{server}"), label: server.to_string(), folders });
            }
        }
    }
    let local = profile_dir.join("Mail").join("Local Folders");
    let local_folders = folders_in(&local);
    if !local_folders.is_empty() {
        out.push(Account { id: "local".into(), label: "Carpetas locales".into(), folders: local_folders });
    }
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

/// Where Thunderbird keeps its profiles on this platform.
pub fn thunderbird_root() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("Thunderbird")).unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(windows))]
    {
        crate::platform::home_dir().join(".thunderbird")
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib mail::profile:: 2>&1 | tail -20`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add windows/src-tauri/src/mail/profile.rs
git commit -m "mail: find the Thunderbird profile and its accounts (profile.rs)"
```

---

### Task 5: `mod.rs` — settings field, Tauri commands, registration

**Files:**
- Modify: `src-tauri/src/mail/mod.rs` (currently just `pub mod otp;` from Task 1)
- Modify: `src-tauri/src/settings.rs` (add `mail_watched_accounts`)
- Modify: `src-tauri/src/lib.rs` (register commands)
- Test: inline `#[cfg(test)] mod tests` in `mod.rs`, plus one in `settings.rs`

**Interfaces:**
- Consumes: `profile::{accounts, default_profile_dir, thunderbird_root, Account}` (Task 4), `index::{FolderIndex, rescan}` (Task 3), `mbox::parse_body` (Task 2).
- Produces: Tauri commands `mail_accounts() -> Result<Vec<AccountInfo>, String>`, `mail_list(account: String, folder: String) -> Result<Vec<MessageInfo>, String>`, `mail_search(query: String) -> Result<Vec<MessageInfo>, String>`, `mail_read(account: String, folder: String, offset: usize, len: usize) -> Result<String, String>`, `mail_set_watched(accounts: Vec<String>) -> Result<(), String>`. These are what `src/core/mail.ts` (Task 7) calls.

- [ ] **Step 1: Add the settings field with a failing test**

In `src-tauri/src/settings.rs`, add the field (near the other `Vec<String>` settings, e.g. next to `active_integrations`):

```rust
    /// Thunderbird accounts (`profile::Account.id`) the Mail pill watches. Empty
    /// until the person picks one in Settings — nothing is read before that.
    #[serde(default)]
    pub mail_watched_accounts: Vec<String>,
```

And in `impl Default for Settings`, add `mail_watched_accounts: Vec::new(),` next to the other empty-vec defaults.

Add a test in `settings.rs`'s existing `#[cfg(test)] mod tests` block, following the shape of `a_saved_rachel_voice_is_replaced_by_the_new_default` (Settings 1.5.2 work earlier today):

```rust
    #[test]
    fn mail_watched_accounts_defaults_to_empty_and_round_trips() {
        let s = Settings::default();
        assert!(s.mail_watched_accounts.is_empty());
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert!(back.mail_watched_accounts.is_empty());
    }
```

- [ ] **Step 2: Run the test to verify it fails, then passes**

Run: `cargo test --lib settings::tests::mail_watched_accounts 2>&1 | tail -20`
Expected: first FAIL to compile (`mail_watched_accounts` unknown field), then after adding the field, PASS.

- [ ] **Step 3: Write `mod.rs`'s commands, with their own failing tests first**

```rust
// src-tauri/src/mail/mod.rs

// Mail (Thunderbird): a read-only pill over the user's local Thunderbird
// profile. Nothing is read until an account is in Settings' watched list
// (mail_watched_accounts); no network call is made for this feature at all.

pub mod index;
pub mod mbox;
pub mod otp;
pub mod profile;

use serde::Serialize;
use std::sync::Mutex;

use profile::Account;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct AccountInfo {
    pub id: String,
    pub label: String,
    pub folders: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct MessageInfo {
    pub account: String,
    pub folder: String,
    pub offset: usize,
    pub len: usize,
    pub subject: String,
    pub from: String,
    pub date_rfc3339: String,
}

fn to_account_info(a: &Account) -> AccountInfo {
    AccountInfo { id: a.id.clone(), label: a.label.clone(), folders: a.folders.iter().map(|f| f.name.clone()).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_account_info_keeps_only_folder_names() {
        let a = Account {
            id: "imap:x".into(),
            label: "x".into(),
            folders: vec![
                profile::Folder { name: "INBOX".into(), mbox_path: "/a/INBOX".into() },
                profile::Folder { name: "Sent".into(), mbox_path: "/a/Sent".into() },
            ],
        };
        let info = to_account_info(&a);
        assert_eq!(info.id, "imap:x");
        assert_eq!(info.folders, vec!["INBOX", "Sent"]);
    }
}
```

Run: `cargo test --lib mail::tests:: 2>&1 | tail -20` — expect PASS once the above compiles (this test needs no fixture, it is already correct as written; run it to confirm before moving on).

- [ ] **Step 4: Wire the Tauri commands (no new unit tests — these are thin I/O wrappers; the logic they call is already tested in Tasks 2-4)**

Still in `mod.rs`, below the test module:

```rust
/// One `FolderIndex` per (account id, folder name), kept for the life of the
/// app. Rebuilt from nothing at launch — see the privacy section of the spec.
#[derive(Default)]
pub struct MailState {
    indexes: Mutex<std::collections::HashMap<(String, String), index::FolderIndex>>,
}

fn profile_dir() -> Result<std::path::PathBuf, String> {
    let root = profile::thunderbird_root();
    profile::default_profile_dir(&root).ok_or_else(|| "No se encontró un perfil de Thunderbird.".to_string())
}

fn find_folder(account_id: &str, folder: &str) -> Result<profile::Folder, String> {
    let dir = profile_dir()?;
    let account = profile::accounts(&dir)
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| "Esa cuenta ya no está en Thunderbird.".to_string())?;
    account.folders.into_iter().find(|f| f.name == folder).ok_or_else(|| "Esa carpeta ya no existe.".to_string())
}

#[tauri::command]
pub fn mail_accounts() -> Result<Vec<AccountInfo>, String> {
    let dir = profile_dir()?;
    Ok(profile::accounts(&dir).iter().map(to_account_info).collect())
}

#[tauri::command]
pub fn mail_list(state: tauri::State<MailState>, account: String, folder: String) -> Result<Vec<MessageInfo>, String> {
    let f = find_folder(&account, &folder)?;
    let bytes = std::fs::read(&f.mbox_path).map_err(|e| e.to_string())?;
    let mut indexes = state.indexes.lock().unwrap();
    let idx = indexes.entry((account.clone(), folder.clone())).or_insert_with(index::FolderIndex::new);
    index::rescan(idx, &bytes);
    Ok(idx
        .messages()
        .iter()
        .map(|h| MessageInfo {
            account: account.clone(),
            folder: folder.clone(),
            offset: h.offset,
            len: h.len,
            subject: h.subject.clone(),
            from: h.from.clone(),
            date_rfc3339: h.date_rfc3339.clone(),
        })
        .collect())
}

#[tauri::command]
pub fn mail_search(state: tauri::State<MailState>, settings: tauri::State<crate::Shared>, query: String) -> Result<Vec<MessageInfo>, String> {
    let watched = settings.settings.lock().unwrap().mail_watched_accounts.clone();
    let dir = profile_dir()?;
    let mut out = Vec::new();
    let mut indexes = state.indexes.lock().unwrap();
    for account in profile::accounts(&dir).into_iter().filter(|a| watched.contains(&a.id)) {
        for folder in &account.folders {
            let Ok(bytes) = std::fs::read(&folder.mbox_path) else { continue };
            let idx = indexes.entry((account.id.clone(), folder.name.clone())).or_insert_with(index::FolderIndex::new);
            index::rescan(idx, &bytes);
            for h in idx.search(&query) {
                out.push(MessageInfo {
                    account: account.id.clone(),
                    folder: folder.name.clone(),
                    offset: h.offset,
                    len: h.len,
                    subject: h.subject.clone(),
                    from: h.from.clone(),
                    date_rfc3339: h.date_rfc3339.clone(),
                });
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn mail_read(account: String, folder: String, offset: usize, len: usize) -> Result<String, String> {
    let f = find_folder(&account, &folder)?;
    let bytes = std::fs::read(&f.mbox_path).map_err(|e| e.to_string())?;
    let raw = bytes.get(offset..offset + len).ok_or("Ese mensaje ya no está donde se esperaba.")?;
    mbox::parse_body(raw).ok_or_else(|| "No se pudo leer este mensaje.".to_string())
}

#[tauri::command]
pub fn mail_set_watched(shared: tauri::State<crate::Shared>, accounts: Vec<String>) -> Result<(), String> {
    let mut s = shared.settings.lock().unwrap();
    s.mail_watched_accounts = accounts;
    crate::settings::save(&s).map_err(|e| e.to_string())
}
```

- [ ] **Step 5: Register everything in `lib.rs`**

Near the other `mod` declarations: add `mod mail;` (alphabetical, near `log`).

Near the other `use …::{…}` import blocks for sibling feature modules (e.g. the `whatsapp` import): add

```rust
use mail::{mail_accounts, mail_list, mail_read, mail_search, mail_set_watched, MailState};
```

Find where Tauri's app builder registers managed state (search for `.manage(` in `lib.rs` — `whatsapp`/other modules' state, or `Chat::default()`, are registered the same way) and add:

```rust
        .manage(mail::MailState::default())
```

In the `tauri::generate_handler![` list (same list `whatsapp_*` commands are in), add:

```rust
            mail_accounts,
            mail_list,
            mail_search,
            mail_read,
            mail_set_watched,
```

- [ ] **Step 6: Build and run every mail test**

Run: `cargo check -p coucou 2>&1 | tail -30` — fix any compile error before moving on (likely culprits: the exact `tauri::State` import path, or the exact field name Coucou's `Shared` struct uses for settings — check `src-tauri/src/lib.rs`'s existing `Shared` struct and copy its field name exactly rather than guessing `settings`).

Run: `cargo test --lib mail:: 2>&1 | tail -10`
Expected: PASS, every test from Tasks 1-5.

- [ ] **Step 7: Commit**

```bash
git add windows/src-tauri/src/mail/mod.rs windows/src-tauri/src/settings.rs windows/src-tauri/src/lib.rs
git commit -m "mail: Tauri commands (mail_accounts/list/search/read/set_watched) and Settings field"
```

---

### Task 6: `watch.rs` — poll for new mail and raise code alerts

**Files:**
- Create: `src-tauri/src/mail/watch.rs`
- Modify: `src-tauri/src/mail/mod.rs` (start the watcher, add the `MailState` fields it needs)
- Modify: `src-tauri/src/lib.rs` (call `mail::start` at setup, matching where `whatsapp::start(&handle, …)` is called)
- Test: inline `#[cfg(test)] mod tests` — the polling tick's pure decision logic only; no real thread/timer in tests.

**Interfaces:**
- Consumes: `index::{FolderIndex, rescan}` (Task 3), `otp::find_code` (Task 1), `mbox::parse_body` (Task 2), `profile::accounts` (Task 4), the `mail_watched_accounts` setting (Task 5).
- Produces: `pub fn start(app: &tauri::AppHandle)` — spawns the poll loop (called once at app setup); emits a `"mail"` event (new/changed message list, for the TS list view to refresh) and a `"mail-code"` event (`{ code: String, subject: String, from: String }`, for the code card) via `app.emit(...)`, the same mechanism `whatsapp::changed`/`pill_event` already use.

- [ ] **Step 1: Write the failing test for the pure tick logic**

```rust
// src-tauri/src/mail/watch.rs

// Polls every watched folder's mbox file size every few seconds (same shape
// as sync.rs/codex_plan.rs). On growth, re-indexes just the new bytes and
// checks each new message for a verification code.

use super::{index, mbox, otp};

/// One poll tick's pure decision: given the newly-indexed messages for one
/// folder (from `index::rescan`), find at most one code to alert on (the
/// first match; `find_code` only looks at the subject and body start, kept
/// short on purpose — see otp.rs). Pure and I/O-free so it is cheap to test.
pub struct CodeAlert {
    pub code: String,
    pub subject: String,
    pub from: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::mbox::MessageHeaders;

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --lib mail::watch:: 2>&1 | tail -20`
Expected: FAIL to compile — `code_alerts` not defined.

- [ ] **Step 3: Write the minimal implementation**

```rust
use mbox::MessageHeaders;

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
        for account in super::profile::accounts(&dir).into_iter().filter(|a| watched.contains(&a.id)) {
            for folder in &account.folders {
                let Ok(bytes) = std::fs::read(&folder.mbox_path) else { continue };
                let idx = indexes.entry((account.id.clone(), folder.name.clone())).or_insert_with(index::FolderIndex::new);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib mail::watch:: 2>&1 | tail -20`
Expected: PASS, 3 tests.

- [ ] **Step 5: Start the watcher at app setup**

In `src-tauri/src/lib.rs`, find the setup block where `whatsapp::start(&handle, &loaded.active_integrations);` is called, and add right after it:

```rust
            mail::watch::start(&handle);
```

Add `pub mod watch;` to `src-tauri/src/mail/mod.rs`'s module list.

- [ ] **Step 6: Build and run every mail test once more**

Run: `cargo check -p coucou 2>&1 | tail -30`, then `cargo test --lib mail:: 2>&1 | tail -10`.
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add windows/src-tauri/src/mail/watch.rs windows/src-tauri/src/mail/mod.rs windows/src-tauri/src/lib.rs
git commit -m "mail: poll watched folders and emit mail/mail-code events (watch.rs)"
```

---

### Task 7: `core/mail.ts` — types, Bridge calls, the pill

**Files:**
- Create: `src/core/mail.ts`
- Modify: `src/core/bridge.ts` (add the five calls + two event types)
- Modify: `src/core/state.ts` (the new pill, the `Settings.mailWatchedAccounts` field)
- Test: `windows/tests/mail.test.mjs` (pure logic only — the pill catalog entry and any helper this file exports)

**Interfaces:**
- Consumes: nothing new (mirrors `core/whatsapp.ts`'s shape).
- Produces: `MailAccountInfo`, `MailMessageInfo` types; `Bridge.mailAccounts()`, `Bridge.mailList(account, folder)`, `Bridge.mailSearch(query)`, `Bridge.mailRead(account, folder, offset, len)`, `Bridge.mailSetWatched(accounts)`; the `"mail"` and `"mail-code"` event names `onEvent` can subscribe to (used by Tasks 8-9).

- [ ] **Step 1: Add the pill and setting, with a failing test**

Create `windows/tests/mail.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { INTEGRATION_AGENTS, DEFAULT_SETTINGS } from "../src/core/state.ts";

test("the Mail pill is in the catalog with a stable id", () => {
  const mail = INTEGRATION_AGENTS.find((t) => t.id === "integration_mail_thunderbird");
  assert.ok(mail, "integration_mail_thunderbird is missing from INTEGRATION_AGENTS");
  assert.equal(mail.name, "Mail");
});

test("mailWatchedAccounts defaults to an empty list", () => {
  assert.deepEqual(DEFAULT_SETTINGS.mailWatchedAccounts, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `windows/`): `npx tsc -p tsconfig.test.json && node --test tests/mail.test.mjs`
Expected: FAIL — the pill/setting don't exist yet.

- [ ] **Step 3: Add the pill and setting**

In `src/core/state.ts`, in `INTEGRATION_AGENTS` (near `task("integration_whatsapp", …)`):

```ts
  task("integration_mail_thunderbird", "Mail", "#1B6FC9", "n8n"),
```

(`AgentSource` is `"claudeCode" | "n8n" | "agent"` — confirmed in `src/core/state.ts`. `"n8n"` is what `integration_whatsapp` already uses for this same shape of local-service pill; matched here for consistency rather than widening the union for one pill.)

In the `Settings` interface, near `whatsapp`-related fields:

```ts
  /** Thunderbird account ids (profile::Account.id) the Mail pill watches. */
  mailWatchedAccounts: string[];
```

In `DEFAULT_SETTINGS`:

```ts
  mailWatchedAccounts: [],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/mail.test.mjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the Bridge calls and types**

In `src/core/bridge.ts`, near the `whatsapp*` calls:

```ts
  mailAccounts: () => call<MailAccountInfo[]>("mail_accounts"),
  mailList: (account: string, folder: string) => call<MailMessageInfo[]>("mail_list", { account, folder }),
  mailSearch: (query: string) => call<MailMessageInfo[]>("mail_search", { query }),
  mailRead: (account: string, folder: string, offset: number, len: number) => call<string>("mail_read", { account, folder, offset, len }),
  mailSetWatched: (accounts: string[]) => call<void>("mail_set_watched", { accounts }),
```

Add to the event-name union (the `type EventPayload = | { name: "whatsapp"; … } | …` block):

```ts
  | { name: "mail"; payload: null }
  | { name: "mail-code"; payload: { code: string; subject: string; from: string } }
```

Create `src/core/mail.ts`:

```ts
// Mail (Thunderbird) — types shared between the inbox view and the code
// card. All reading happens in Rust (src-tauri/src/mail/); this file only
// shapes what comes back over the bridge.

export interface MailAccountInfo {
  id: string;
  label: string;
  folders: string[];
}

export interface MailMessageInfo {
  account: string;
  folder: string;
  offset: number;
  len: number;
  subject: string;
  from: string;
  dateRfc3339: string;
}
```

(Tauri's `camelCase` serde rename, already the project's convention per `#[serde(rename_all = "camelCase")]` on sibling structs, turns `date_rfc3339` into `dateRfc3339` on the wire — match `MessageInfo` in `mod.rs`, Task 5, by adding that same `#[serde(rename_all = "camelCase")]` attribute to it if it is not already inherited from a crate-wide default; check how `whatsapp`'s equivalent struct does it and copy that exactly.)

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `npx tsc --noEmit`, then `npm test`
Expected: both clean; test count up by 2 from before this task.

- [ ] **Step 7: Commit**

```bash
git add windows/src/core/mail.ts windows/src/core/bridge.ts windows/src/core/state.ts windows/tests/mail.test.mjs
git commit -m "mail: pill catalog entry, Settings field, Bridge calls and types (core/mail.ts)"
```

---

### Task 8: `views/mail.ts` — the inbox list, search, and reader

**Files:**
- Create: `src/views/mail.ts`
- Modify: `src/views/integrations.ts` (route `integration_mail_thunderbird` to it, mirroring the `whatsappCard`/`whatsapp.ts` split already there)
- Test: `windows/tests/mail.test.mjs` (append — pure rendering-adjacent logic: the snippet/date formatting helpers this file exports)

**Interfaces:**
- Consumes: `Bridge.mailAccounts/mailList/mailSearch/mailRead` (Task 7), `onEvent("mail", …)` (Task 6/7), `h`/`svg`/`clear` from `./dom` (the project's existing tiny DOM helper, used by every other view).
- Produces: `export function buildMailCard(host): { el: HTMLElement; sync(): void }`, plus the pure helpers `shortDate`, `oneLine`, `highlightCode` (the last implements the user's "resaltado en la lista" decision from brainstorming — the same digit-run/trigger-word rule as `otp.rs`, re-applied client-side to mark up the reader's rendered text; it does not decide whether the code card opens, `otp.rs` alone does that). `buildMailCard`'s shape matches `buildWhatsAppCard` in `src/views/whatsapp.ts`, so `island/island.ts` wires it in exactly the same way (no changes needed there beyond what Task 9 adds for the code card).

- [ ] **Step 1: Write the failing test for the pure date/snippet helpers**

Append to `windows/tests/mail.test.mjs`:

```js
import { shortDate, oneLine, highlightCode } from "../src/views/mail.ts";

test("shortDate reads a date, hiding the year when it's this year", () => {
  const thisYear = new Date().getFullYear();
  assert.match(shortDate(`${thisYear}-03-14T10:00:00Z`), /14 mar/i);
  assert.match(shortDate("2019-03-14T10:00:00Z"), /2019/);
});

test("shortDate on an empty or bad date returns an empty string, never throws", () => {
  assert.equal(shortDate(""), "");
  assert.equal(shortDate("not a date"), "");
});

test("oneLine collapses whitespace and cuts long text with an ellipsis", () => {
  assert.equal(oneLine("  hello   world  "), "hello world");
  assert.equal(oneLine("x".repeat(100), 10), "xxxxxxxxx…");
});

test("highlightCode wraps a code near a trigger word in <mark>, leaves the rest as plain text", () => {
  const html = highlightCode("Tu código es 482913. No lo compartas.");
  assert.equal(html, 'Tu código es <mark>482913</mark>. No lo compartas.');
});

test("highlightCode with no code present returns the text unchanged, HTML-escaped", () => {
  assert.equal(highlightCode("Hola <mundo> & adiós"), "Hola &lt;mundo&gt; &amp; adiós");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsc -p tsconfig.test.json && node --test tests/mail.test.mjs`
Expected: FAIL — `src/views/mail.ts` doesn't exist.

- [ ] **Step 3: Write `views/mail.ts`**

First, read `src/views/whatsapp.ts` in full (it already exists in this codebase and is the closest sibling: a list view, a "back" button into a detail view, an `onEvent` subscription, a `host` interface) and match its structure and the project's `h()` helper exactly rather than inventing new conventions. Then write:

```ts
// The Mail (Thunderbird) card: an inbox list, a search box, and a reader —
// read-only, local only. All the parsing happens in Rust (src-tauri/src/mail/);
// this file only renders what mail_list/mail_search/mail_read return.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, onEvent } from "../core/bridge";
import { t } from "../i18n/i18n";
import type { MailMessageInfo } from "../core/mail";

export interface MailCardHost {
  openSettings(): void;
}

export interface MailCard {
  el: HTMLElement;
  sync(): void;
}

/** "14 mar" for a date this year, "14 mar 2019" otherwise. Never throws. */
export function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const thisYear = new Date().getFullYear();
  const base = `${d.getDate()} ${months[d.getMonth()]}`;
  return d.getFullYear() === thisYear ? base : `${base} ${d.getFullYear()}`;
}

/** Collapses whitespace to single spaces and cuts to `max` characters with an ellipsis. */
export function oneLine(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CODE_TRIGGER_WORDS = ["código", "codigo", "code", "verification", "verifica", "otp", "one-time", "one time", "security code", "clave de acceso"];

/**
 * HTML-escapes `text`, then wraps the first 4-8 digit run that sits within 40
 * characters of a trigger word in `<mark>`. Purely cosmetic — the authoritative
 * detection that decides whether to raise the code card lives in Rust
 * (`src-tauri/src/mail/otp.rs`); this is the same rule re-applied client-side
 * so the reader can highlight the match inline, nothing more.
 */
export function highlightCode(text: string): string {
  const escaped = escapeHtml(text);
  const lower = escaped.toLowerCase();
  const digitRun = /\d[\d\s-]{2,9}\d|\d{3,7}/g;
  let match: RegExpExecArray | null;
  while ((match = digitRun.exec(escaped))) {
    const digits = match[0].replace(/[\s-]/g, "");
    if (digits.length < 4 || digits.length > 8) continue;
    const windowStart = Math.max(0, match.index - 40);
    const windowEnd = Math.min(lower.length, match.index + match[0].length + 40);
    const window = lower.slice(windowStart, windowEnd);
    if (CODE_TRIGGER_WORDS.some((w) => window.includes(w))) {
      return escaped.slice(0, match.index) + `<mark>${digits}</mark>` + escaped.slice(match.index + match[0].length);
    }
  }
  return escaped;
}

export function buildMailCard(host: MailCardHost): MailCard {
  let openMessage: MailMessageInfo | null = null;
  let query = "";

  const searchField = h("input", { class: "mail-search", type: "search", placeholder: t("Buscar correo…"), spellcheck: "false" }) as HTMLInputElement;
  const listBody = h("div", { class: "int-rows mail-rows" });
  const listView = h("div", { class: "mail-list" }, searchField, listBody);

  const back = h("button", { class: "int-back mail-back", title: t("Back") }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 }));
  const readerSubject = h("b", { class: "mail-subject" });
  const readerFrom = h("span", { class: "mail-from" });
  const readerHead = h("div", { class: "mail-head" }, back, h("div", {}, readerSubject, readerFrom));
  const readerBody = h("div", { class: "mail-body" });
  const readerView = h("div", { class: "mail-reader" }, readerHead, readerBody);

  const el = h("div", { class: "int-card mail-card" }, listView, readerView);

  function close() {
    openMessage = null;
    render();
  }
  back.addEventListener("click", close);

  async function openAt(m: MailMessageInfo) {
    openMessage = m;
    readerSubject.textContent = m.subject || t("(sin asunto)");
    readerFrom.textContent = m.from;
    clear(readerBody);
    readerBody.append(h("div", { class: "mail-loading", text: t("Cargando…") }));
    render();
    try {
      const body = await Bridge.mailRead(m.account, m.folder, m.offset, m.len);
      clear(readerBody);
      const textEl = h("div", { class: "mail-text" });
      // highlightCode HTML-escapes the body itself before wrapping any match in
      // <mark> — innerHTML here is safe because nothing but that function's own
      // escaping ever reaches it (never set from unescaped user/mail content).
      textEl.innerHTML = highlightCode(body ?? "");
      readerBody.append(textEl);
    } catch (err) {
      clear(readerBody);
      readerBody.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  }

  function row(m: MailMessageInfo): HTMLElement {
    const r = h(
      "div",
      { class: "int-row mail-row", onclick: () => void openAt(m) },
      h("div", { class: "mail-row-top" }, h("b", { text: m.from || t("(desconocido)") }), h("span", { class: "mail-date", text: shortDate(m.dateRfc3339) })),
      h("div", { class: "int-sub mail-row-subject", text: oneLine(m.subject || t("(sin asunto)"), 70) }),
    );
    return r;
  }

  async function reload() {
    clear(listBody);
    try {
      const messages = query.trim() ? await Bridge.mailSearch(query.trim()) : await (async () => {
        const accounts = (await Bridge.mailAccounts()) ?? [];
        const all: MailMessageInfo[] = [];
        for (const a of accounts) {
          for (const f of a.folders) all.push(...((await Bridge.mailList(a.id, f)) ?? []));
        }
        return all.sort((x, y) => y.dateRfc3339.localeCompare(x.dateRfc3339));
      })();
      if (messages.length === 0) {
        listBody.append(h("div", { class: "mail-empty", text: t("No hay correo") }));
      } else {
        for (const m of messages) listBody.append(row(m));
      }
    } catch (err) {
      listBody.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  }

  let searchDebounce: number | null = null;
  searchField.addEventListener("input", () => {
    query = searchField.value;
    if (searchDebounce != null) window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => void reload(), 250);
  });

  function render() {
    listView.style.display = openMessage ? "none" : "";
    readerView.style.display = openMessage ? "" : "none";
  }
  render();

  onEvent("mail", () => void reload());
  void reload();

  return { el, sync: render };
}
```

Then wire it into `src/views/integrations.ts`, next to the existing `if (task.id === "integration_whatsapp") return whatsappCard(…)` line:

```ts
  if (task.id === "integration_mail_thunderbird") return buildMailCard({ openSettings: hooks.openSettings }).el;
```

Add the import at the top of `integrations.ts`: `import { buildMailCard } from "./mail";`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit` (fix any type error before continuing — this is the step most likely to surface a mismatch against `MailCardHost`'s real shape once `hooks.openSettings` is checked against what `integrations.ts` actually passes to its sibling cards), then `node --test tests/mail.test.mjs`.
Expected: both clean; `mail.test.mjs` now has 7 passing tests.

- [ ] **Step 5: Commit**

```bash
git add windows/src/views/mail.ts windows/src/views/integrations.ts windows/tests/mail.test.mjs
git commit -m "mail: inbox list, search and reader view (views/mail.ts)"
```

---

### Task 9: `views/mailcode.ts` — the code card

**Files:**
- Create: `src/views/mailcode.ts`
- Modify: `src/island/hooks.ts` (subscribe to `"mail-code"`, open the card the same way an approval/question card opens)
- Modify: `src/style.css` (the card's styling, following the existing `.int-card`/`.wa-card` conventions)
- Test: `windows/tests/mail.test.mjs` (append — the copy-to-clipboard helper's pure text-shaping logic only; the actual `navigator.clipboard` call is not unit tested, matching how the rest of this codebase treats browser-API calls)

**Interfaces:**
- Consumes: `onEvent("mail-code", …)` (Task 6/7), `State`/`island.alert` (existing island machinery — read `src/island/hooks.ts`'s `handleQuestion`/toast pattern before writing this, to match how a card takes the island over briefly).
- Produces: `export function buildMailCodeCard(onClose: () => void): HTMLElement`; a new `IslandViewName` value `"mailcode"` registered the same way `"question"`/`"approval"` are (check `src/core/layout.ts`'s `IslandViewName` union and `VIEW_LAYOUTS` map — both need the new entry, sized like `"finished"` since this is a small, short-lived card, not a full chat-height view).

- [ ] **Step 1: Write the failing test for the pure helper**

Append to `windows/tests/mail.test.mjs`:

```js
import { codeForDisplay } from "../src/views/mailcode.ts";

test("codeForDisplay groups digits in pairs for easier reading", () => {
  assert.equal(codeForDisplay("4821"), "48 21");
  assert.equal(codeForDisplay("90214"), "90 21 4");
  assert.equal(codeForDisplay(""), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsc -p tsconfig.test.json && node --test tests/mail.test.mjs`
Expected: FAIL — `src/views/mailcode.ts` doesn't exist.

- [ ] **Step 3: Add the `"mailcode"` view and write `views/mailcode.ts`**

In `src/core/layout.ts`: add `"mailcode"` to the `IslandViewName` union (near `"finished"`), and in `VIEW_LAYOUTS`, add an entry shaped like `finished`'s (same `height`/`botDiameter`/`agentMode: "none"` — copy that line's exact values, this card does not need a new size).

Write `src/views/mailcode.ts`:

```ts
// The code card: a short-lived island view with one verification code, big
// and easy to read, and a copy button. Opened by island/hooks.ts on the
// "mail-code" event; closes itself after a timeout or on click, same shape
// as the approval/question cards' own timeout (see hooks.ts).

import { h } from "./dom";
import { t } from "../i18n/i18n";

/** "4821" -> "48 21", "90214" -> "90 21 4". Purely cosmetic grouping. */
export function codeForDisplay(code: string): string {
  if (!code) return "";
  const pairs: string[] = [];
  for (let i = 0; i < code.length; i += 2) pairs.push(code.slice(i, i + 2));
  return pairs.join(" ");
}

export function buildMailCodeCard(code: string, subject: string, onClose: () => void): HTMLElement {
  const codeEl = h("div", { class: "mailcode-digits", text: codeForDisplay(code) });
  const subjectEl = h("div", { class: "mailcode-subject", text: subject });
  const copyBtn = h("button", { class: "primary mailcode-copy", text: t("Copiar") });
  const status = h("span", { class: "mailcode-status" });
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(code).then(
      () => {
        status.textContent = t("Copiado");
        window.setTimeout(onClose, 900);
      },
      () => {
        status.textContent = t("No se pudo copiar");
      },
    );
  });
  return h("div", { class: "int-card mailcode-card" }, codeEl, subjectEl, h("div", { class: "mailcode-actions" }, copyBtn, status));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/mail.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Wire the island to open the card on `"mail-code"`**

Read `src/island/hooks.ts`'s existing `handleQuestion` function (added earlier today for the permission-queue work) for the exact shape — `State.updateTask`/`Sound.play`/`island.alert`/a timeout that drops the card. Add, in the same file, near `registerHookHandlers`:

```ts
export function registerMailCodeHandler(island: Island): void {
  void onEvent<{ code: string; subject: string; from: string }>("mail-code", (payload) => {
    State.pendingMailCode = payload;
    Sound.play("question");
    island.alert("mailcode");
    window.setTimeout(() => {
      if (State.pendingMailCode?.code === payload.code) {
        State.pendingMailCode = null;
        if (State.view === "mailcode") island.setView(State.defaultView());
        State.notify();
      }
    }, 15_000);
    State.notify();
  });
}
```

Add `pendingMailCode: { code: string; subject: string; from: string } | null = null;` to `State` in `src/core/state.ts`, near `pendingQuestion`.

In `src/island/island.ts`, find where `registerHookHandlers(this)` (or the equivalent call registering question/approval handlers) is called during setup, and add `registerMailCodeHandler(this);` right after it. Import it from `./hooks` alongside the existing imports from that file.

Wire the view itself: find `buildViews`/`views.ts`'s view-building switch (the same place `"question"`/`"approval"` map to their card builders) and add a `"mailcode"` case that calls `buildMailCodeCard(State.pendingMailCode.code, State.pendingMailCode.subject, () => { State.pendingMailCode = null; islandActions.setView(State.defaultView()); State.notify(); })` — guard for `State.pendingMailCode` being `null` the same way the existing question/approval cases already must (read how they guard before writing this).

- [ ] **Step 6: Minimal styling**

In `src/style.css`, add a small block near `.wa-card`'s styles:

```css
.mailcode-card { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 18px; }
.mailcode-digits { font: 700 34px var(--font); letter-spacing: 4px; font-variant-numeric: tabular-nums; }
.mailcode-subject { font-size: 12px; color: var(--dim-2); text-align: center; }
.mailcode-actions { display: flex; align-items: center; gap: 8px; }
.mailcode-status { font-size: 11px; color: var(--dim-2); }
```

- [ ] **Step 7: Typecheck, test, build**

Run: `npx tsc --noEmit`, `npm test`, `npx vite build`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add windows/src/views/mailcode.ts windows/src/island/hooks.ts windows/src/island/island.ts windows/src/core/state.ts windows/src/core/layout.ts windows/src/views/views.ts windows/src/style.css windows/tests/mail.test.mjs
git commit -m "mail: the verification-code card, opened on the mail-code event"
```

---

### Task 10: Settings — the "Correo" section

**Files:**
- Modify: `src/settings/main.ts` (a new section, following `voiceSection`/`planSection`'s exact shape)
- Test: none new (this is UI wiring over already-tested `Bridge.mailAccounts`/`mailSetWatched`; the manual check in Task 12 covers it)

**Interfaces:**
- Consumes: `Bridge.mailAccounts()`, `Bridge.mailSetWatched(accounts)` (Task 7), `settings.mailWatchedAccounts` (Task 7), the existing `group()`/`field()`/`toggle()` helpers already used throughout `main.ts`.

- [ ] **Step 1: Write the section**

Read `voiceSection` (added earlier today) once more for the exact shape of a Settings section that loads async data on open and redraws on change, then add, near it in `src/settings/main.ts`:

```ts
function mailSection(): HTMLElement {
  const list = h("div", { class: "mail-accounts-list" });
  const note = h("div", { class: "hint" });

  async function reload() {
    clear(list);
    clear(note);
    try {
      const accounts = (await Bridge.mailAccounts()) ?? [];
      if (accounts.length === 0) {
        note.textContent = t("No se encontró un perfil de Thunderbird en este PC.");
        return;
      }
      for (const a of accounts) {
        const checked = settings.mailWatchedAccounts.includes(a.id);
        const box = toggle(checked, async (on) => {
          const next = on
            ? [...settings.mailWatchedAccounts, a.id]
            : settings.mailWatchedAccounts.filter((id) => id !== a.id);
          settings.mailWatchedAccounts = next;
          await Bridge.mailSetWatched(next);
          await save();
        });
        list.append(field(a.label, `${a.folders.length} ${t("carpetas")}`, box));
      }
    } catch (err) {
      note.textContent = String(err).replace(/^Error:\s*/, "");
    }
  }
  void reload();

  return h(
    "section",
    { class: "plain" },
    h("p", { class: "lead", text: t("Lee tu correo de Thunderbird en este PC, sin conexión. Gmail u Outlook solo en el navegador no aparecen aquí a menos que los agregues a Thunderbird.") }),
    group(t("Cuentas"), list, note),
  );
}
```

- [ ] **Step 2: Register the section**

In the `groups` array (where `{ id: "voice", … }`, `{ id: "claude", … }` etc. are listed), add:

```ts
    { id: "mail", label: "Correo", icon: ICONS.doc, sections: [mailSection()] },
```

(Check `ICONS` for a better-fitting icon than `doc` if one already exists for mail/envelope; use `doc` only if nothing closer is already in the `ICONS` object — do not add a new icon in this task.)

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit`, `npx vite build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add windows/src/settings/main.ts
git commit -m "mail: Settings section to pick which Thunderbird accounts Coucou watches"
```

---

### Task 11: Full verification and changelog

**Files:**
- Modify: `windows/CHANGELOG.md`, `windows/CHANGELOG.es.md` (new "Unreleased" entries, following today's existing 1.5.2 entry's exact format)
- No code changes — this task is the final gate before calling Phase 1 done.

- [ ] **Step 1: Run everything, one more time, from a clean state**

```bash
cd windows
npx tsc --noEmit
npm test
cargo test --workspace
cargo audit
npx vite build
```

Expected: all clean, zero vulnerabilities, build succeeds. Fix anything that fails before continuing — do not add a changelog entry for a feature that doesn't pass its own tests.

- [ ] **Step 2: Manual check against the real Thunderbird profile**

This is the one thing no automated test can cover: run `npm run tauri dev` (or the packaged app once built), open Settings → Correo, pick one real account, open the Mail pill, confirm the inbox list shows real subjects/senders and a message opens and reads correctly. Send yourself a test email containing a 6-digit code in the subject and confirm the card appears. This step is not optional — the plan's tests use synthetic fixtures throughout precisely so they never touch real mail, which means this manual pass is the first time the real mbox format (this Thunderbird version's exact headers, any unusual charset) gets exercised at all.

- [ ] **Step 3: Add the changelog entries**

In `windows/CHANGELOG.md`, add a new top section (or append to the current `## Unreleased` if one already exists above `## 1.5.2`):

```markdown
## Unreleased
- **Mail (Thunderbird)**: a new pill reads your Thunderbird mail on this PC — inbox, search, reading a message — with no network call and no credentials; pick which accounts in Settings → Correo. When a verification code arrives, a card shows it big with a copy button.
```

And the matching Spanish entry in `windows/CHANGELOG.es.md`:

```markdown
## Sin publicar
- **Correo (Thunderbird)**: un pill nuevo lee tu correo de Thunderbird en este PC — bandeja, buscar, leer un mensaje — sin conexión ni contraseñas; eliges qué cuentas en Ajustes → Correo. Cuando llega un código de verificación, una tarjeta lo muestra en grande con un botón de copiar.
```

- [ ] **Step 4: Commit**

```bash
git add windows/CHANGELOG.md windows/CHANGELOG.es.md
git commit -m "mail: changelog entry for the Thunderbird mail pill (Phase 1)"
```

This closes Phase 1. Automatic sorting, the chat drafting/sending mail, and any account not already in Thunderbird are explicitly out of scope (see the spec) — each gets its own brainstorming pass before being planned, same as this one was.
