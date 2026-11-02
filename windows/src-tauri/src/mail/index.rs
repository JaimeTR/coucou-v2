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

impl FolderIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// How many bytes of the folder's file are already indexed.
    pub fn scanned_len(&self) -> usize {
        self.last_scanned_len
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
#[cfg(test)] // the watcher reads only the new tail and calls `append`
pub fn rescan(index: &mut FolderIndex, mbox_bytes: &[u8]) -> Vec<MessageHeaders> {
    if mbox_bytes.len() < index.last_scanned_len {
        // Shrank: the old offsets are meaningless. Start over.
        *index = FolderIndex::new();
    }
    append(index, &mbox_bytes[index.last_scanned_len..])
}

/// Indexes `tail`, the folder's bytes from `index.scanned_len()` on, so a
/// caller can read just the new end of a big file. Same return as `rescan`.
/// Expunged messages (deleted or moved, awaiting compaction) are skipped, so
/// nothing downstream (list, search, code alerts) ever sees them.
pub fn append(index: &mut FolderIndex, tail: &[u8]) -> Vec<MessageHeaders> {
    let from_offset = index.last_scanned_len;
    let added: Vec<MessageHeaders> = mbox::split(tail)
        .into_iter()
        .map(|(offset, len)| mbox::parse_headers(&tail[offset..offset + len], from_offset + offset, len))
        .filter(|h| !h.expunged)
        .collect();
    index.last_scanned_len = from_offset + tail.len();
    // Newest first in the stored list: new messages (append-only in the
    // file) go to the front, in one O(n) splice.
    index.messages.splice(0..0, added.iter().rev().cloned());
    added
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
    fn an_expunged_message_is_never_indexed() {
        let mut idx = FolderIndex::new();
        let mut bytes = FIRST.to_vec();
        bytes.extend_from_slice(b"From c Wed Oct 28 10:00:00 2026\r\nX-Mozilla-Status: 0008\r\nSubject: Gone\r\n\r\nbye\r\n");
        let new = rescan(&mut idx, &bytes);
        assert_eq!(new.len(), 1);
        assert_eq!(idx.messages().len(), 1);
        assert_eq!(idx.messages()[0].subject, "One");
        assert_eq!(idx.scanned_len(), bytes.len());
    }

    #[test]
    fn appending_two_messages_at_once_keeps_newest_first() {
        let mut idx = FolderIndex::new();
        let mut grown = FIRST.to_vec();
        grown.extend_from_slice(SECOND);
        grown.extend_from_slice(b"From c Wed Oct 28 10:00:00 2026\r\nSubject: Three\r\n\r\nyo\r\n");
        rescan(&mut idx, FIRST);
        rescan(&mut idx, &grown);
        let subjects: Vec<_> = idx.messages().iter().map(|m| m.subject.as_str()).collect();
        assert_eq!(subjects, vec!["Three", "Two", "One"]);
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
