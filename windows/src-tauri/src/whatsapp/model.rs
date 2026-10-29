// WhatsApp data model: conversations, messages, inbox, and chat address parsing.
//
// Addresses look like "33612345678@s.whatsapp.net" (individual) or "120363@g.us" (group).
// The user types a phone number or a raw JID; we normalize to the JID.

use std::collections::HashMap;

/// One conversation in the inbox.
#[derive(Clone, Debug, Serialize)]
pub struct Conversation {
    pub id: String,        // JID, e.g. "33612345678@s.whatsapp.net"
    pub name: String,      // display name or the phone number
    pub unread: u32,
    pub last_activity: u64, // epoch ms
}

/// One message (kept in memory only).
#[derive(Clone, Debug, Serialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub from_me: bool,
    pub sender_name: Option<String>,
    pub text: Option<String>,
    pub media_label: Option<String>,
    pub timestamp: u64,
}

/// The rolling inbox: one entry per conversation, last 10 messages each.
#[derive(Clone, Debug, Default)]
pub struct Inbox {
    pub conversations: Vec<Conversation>,
}

impl Inbox {
    pub fn new() -> Self {
        Self { conversations: Vec::new() }
    }
}

/// Filters applied to incoming messages.
#[derive(Clone, Debug, Default)]
pub struct Filters {
    pub mute_groups: bool,
    pub mark_read_on_open: bool,
}

/// Outcome of processing an incoming webhook event.
#[derive(Clone, Debug)]
pub enum Outcome {
    NewConversation,
    NewMessage,
    Ignored,
}

/// Rate limit info from the gateway.
#[derive(Clone, Debug, Default)]
pub struct RateLimit {
    pub remaining: Option<u32>,
    pub reset_at: Option<u64>,
}

/// A refusal reason from the gateway.
#[derive(Clone, Debug)]
pub enum Refusal {
    NotLinked,
    TooLong,
    TooFast,
    Other { detail: String },
}

/// Parse a user-entered chat address into a canonical JID.
/// Accepts "+33 6 12 34 56 78", "33612345678", "120363@g.us", etc.
pub fn chat_from_entry(entry: &str) -> Option<String> {
    let trimmed = entry.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Already a JID?
    if trimmed.contains('@') {
        let parts: Vec<&str> = trimmed.split('@').collect();
        if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }
    // Phone number: strip spaces, dashes, dots, plus.
    let digits: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 7 {
        return Some(format!("{}@s.whatsapp.net", digits));
    }
    None
}

/// Ignore a conversation: it never shows in the island again.
pub fn ignore(chat_id: &str) {
    // Handled in Control via prefs.ignored; this is a no-op here for the model layer.
    let _ = chat_id;
}

use serde::Serialize;