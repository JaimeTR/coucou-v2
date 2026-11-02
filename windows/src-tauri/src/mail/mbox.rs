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
    /// Seconds since the epoch from the Date header (0 when missing), for sorting.
    pub timestamp: i64,
    /// Thunderbird deleted or moved this message (`X-Mozilla-Status` bit
    /// 0x0008): its bytes stay in the file until the folder is compacted.
    pub expunged: bool,
}

/// Byte ranges of each raw RFC 822 message in an mbox file, in file order. A
/// message starts at each line that begins with "From " (the mbox envelope
/// separator). Each range runs from its envelope line up to the next one, so
/// the ranges are contiguous and the first one starts at byte 0.
pub fn split(mbox: &[u8]) -> Vec<(usize, usize)> {
    if mbox.is_empty() {
        return Vec::new();
    }
    let mut starts = Vec::new();
    let mut i = 0;
    while i < mbox.len() {
        let at_line_start = i == 0 || mbox[i - 1] == b'\n';
        if at_line_start && mbox[i..].starts_with(b"From ") {
            starts.push(i);
            i += 5;
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

/// Headers only: `parse_headers` stops at the header block, so the MIME tree
/// (attachments included) is never parsed for the list view.
pub fn parse_headers(raw: &[u8], offset: usize, len: usize) -> MessageHeaders {
    let Some(message) = MessageParser::new().parse_headers(raw) else {
        return MessageHeaders { offset, len, subject: String::new(), from: String::new(), date_rfc3339: String::new(), message_id: String::new(), timestamp: 0, expunged: false };
    };
    let status = message
        .headers()
        .get("X-Mozilla-Status")
        .and_then(|h| std::str::from_utf8(h.raw_value()).ok().and_then(|v| u32::from_str_radix(v.trim(), 16).ok()))
        .unwrap_or(0);
    MessageHeaders {
        offset,
        len,
        subject: message.subject().unwrap_or_default().to_string(),
        from: display_mailbox(message.from().and_then(|l| l.first())),
        date_rfc3339: message.date().map(|d| d.to_rfc3339()).unwrap_or_default(),
        message_id: message.message_id().unwrap_or_default().to_string(),
        timestamp: message.date().map(|d| d.to_timestamp()).unwrap_or(0),
        expunged: status & 0x0008 != 0,
    }
}

/// The plain-text body, decoded (quoted-printable/base64, charset, RFC 2047).
/// `None` for a message with no text part at all, or one that fails to parse.
pub fn parse_body(raw: &[u8]) -> Option<String> {
    let message = MessageParser::new().parse(raw)?;
    message.body_text(0).map(|cow| cow.into_owned())
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
    fn x_mozilla_status_bit_0008_marks_a_message_expunged() {
        let live = parse_headers(b"X-Mozilla-Status: 0001\r\nSubject: a\r\n\r\nbody\r\n", 0, 0);
        assert!(!live.expunged);
        let gone = parse_headers(b"X-Mozilla-Status: 0009\r\nSubject: a\r\n\r\nbody\r\n", 0, 0);
        assert!(gone.expunged);
        assert_eq!(gone.subject, "a");
        assert!(!parse_headers(b"Subject: no status\r\n\r\nbody\r\n", 0, 0).expunged);
    }

    #[test]
    fn an_empty_or_unparsable_message_never_panics() {
        assert_eq!(split(b""), Vec::<(usize, usize)>::new());
        let headers = parse_headers(b"not a valid email at all", 0, 0);
        assert_eq!(headers.subject, "");
        assert_eq!(parse_body(b"not a valid email at all"), None);
    }
}
