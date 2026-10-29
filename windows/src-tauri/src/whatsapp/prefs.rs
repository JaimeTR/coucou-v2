// User preferences for WhatsApp: enabled, mute groups, mark read on open,
// gateway choice, port, auto-start GOWA, ignored chats.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Prefs {
    pub enabled: bool,
    pub mute_groups: bool,
    pub mark_read_on_open: bool,
    pub gateway: String,
    pub port: u16,
    pub auto_start: bool,
    pub gowa_path: String,
    pub ignored: Vec<String>,
}

impl Prefs {
    pub fn cleaned(mut self) -> Self {
        self.ignored.sort_unstable();
        self.ignored.dedup();
        self
    }
}

pub fn save(prefs: &Prefs) {
    // Preferences live in memory only; nothing is persisted to disk.
    let _ = prefs;
}