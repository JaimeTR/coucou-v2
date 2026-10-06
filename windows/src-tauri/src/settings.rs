// Preferences, stored as plain JSON in settings.json under platform::config_dir().
// No secret ever lands here — API keys live in the OS keychain (see secrets.rs).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    pub hooks_installed: bool,
    /// Claude model used by the chat. Changeable in the settings window.
    /// Defaulted explicitly so a settings.json written by an older build still loads.
    #[serde(default = "default_model")]
    pub model: String,
    /// The name Mochi greets you by. Empty means "use the detected one".
    #[serde(default)]
    pub user_name: String,
    /// Say hello (with your name) when Coucou starts.
    #[serde(default = "default_true")]
    pub greeting_enabled: bool,
    /// Which pill opens first (its id, e.g. "integration_claude").
    #[serde(default = "default_start_pill")]
    pub start_pill: String,
    /// Offer "where do we start?" chips on the welcome screen.
    #[serde(default = "default_true")]
    pub greeting_picker: bool,
    /// What the greeting says; `{name}` is replaced by your name.
    #[serde(default = "default_greeting_template")]
    pub greeting_template: String,
    /// Superseded by `language`; kept so saved settings still load.
    #[serde(default = "default_greeting_language")]
    pub greeting_language: String,
    /// Mochi says the welcome aloud.
    #[serde(default)]
    pub voice_greeting: bool,
    /// Chat replies are read aloud as they arrive (each one also has a speaker button).
    #[serde(default)]
    pub voice_replies: bool,
    /// Who speaks: "system" (the voices Windows has) or "elevenlabs".
    #[serde(default = "default_voice_engine")]
    pub voice_engine: String,
    /// The ElevenLabs voice (its id) and model.
    #[serde(default = "default_eleven_voice")]
    pub eleven_voice: String,
    #[serde(default = "default_eleven_model")]
    pub eleven_model: String,
    /// Listen for "Oye Mochi" (sends short bits of speech to Groq to understand them).
    #[serde(default)]
    pub wake_word: bool,
    /// Turns the listening on or off from anywhere.
    #[serde(default = "default_listen_shortcut")]
    pub listen_shortcut: String,
    /// Interface language: "auto" follows the system; otherwise "es" or "en".
    #[serde(default = "default_greeting_language")]
    pub language: String,
    /// Who answers the chat: "anthropic" (Claude) or "devmark" (DEVMARK AI).
    #[serde(default = "default_provider")]
    pub chat_provider: String,
    /// Model asked of DEVMARK AI, and how long its replies may be.
    #[serde(default = "default_devmark_model")]
    pub devmark_model: String,
    /// Models asked of Gemini and Groq (any model the provider offers).
    #[serde(default = "default_gemini_model")]
    pub gemini_model: String,
    #[serde(default = "default_groq_model")]
    pub groq_model: String,
    #[serde(default = "default_devmark_max_tokens")]
    pub devmark_max_tokens: u32,
    /// Show the plan usage pill in the island's header.
    #[serde(default)]
    pub plan_gauge: bool,
    /// Pop a native Windows notification when a request needs a person and the
    /// island is hidden.
    #[serde(default = "default_true")]
    pub native_notifications: bool,
    /// Global keyboard shortcuts to approve / deny without focusing anything.
    #[serde(default = "default_true")]
    pub global_shortcuts: bool,
    /// The key (or two) that opens and closes the island from anywhere,
    /// e.g. "Ctrl+Alt+C" or "F8".
    #[serde(default = "default_toggle_shortcut")]
    pub toggle_shortcut: String,
}

fn default_true() -> bool {
    true
}

fn default_greeting_template() -> String {
    "Hola {name}".into()
}

fn default_voice_engine() -> String {
    "system".into()
}

fn default_eleven_voice() -> String {
    crate::voice::DEFAULT_VOICE.into()
}

fn default_eleven_model() -> String {
    crate::voice::DEFAULT_MODEL.into()
}

pub fn default_listen_shortcut() -> String {
    "Ctrl+Alt+M".into()
}

pub fn default_toggle_shortcut() -> String {
    "Ctrl+Alt+C".into()
}

fn default_start_pill() -> String {
    "integration_claude".into()
}

fn default_greeting_language() -> String {
    "auto".into()
}

fn default_provider() -> String {
    "anthropic".into()
}

fn default_devmark_model() -> String {
    crate::devmark::DEFAULT_MODEL.to_string()
}

fn default_gemini_model() -> String {
    crate::compat::DEFAULT_GEMINI_MODEL.to_string()
}

fn default_groq_model() -> String {
    crate::compat::DEFAULT_GROQ_MODEL.to_string()
}

fn default_devmark_max_tokens() -> u32 {
    crate::devmark::DEFAULT_MAX_TOKENS
}

fn default_model() -> String {
    crate::claude::DEFAULT_MODEL.to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            absence_interval: 180.0,
            // Only GitHub out of the box: the other pills show "not connected"
            // until you add a key, so they are opt-in in Settings → Integrations.
            active_integrations: vec!["integration_github".into()],
            screen: "primary".into(),
            autostart: false,
            hooks_installed: false,
            model: default_model(),
            user_name: String::new(),
            start_pill: default_start_pill(),
            greeting_picker: true,
            greeting_enabled: true,
            greeting_template: default_greeting_template(),
            greeting_language: default_greeting_language(),
            language: default_greeting_language(),
            voice_greeting: false,
            voice_engine: default_voice_engine(),
            eleven_voice: default_eleven_voice(),
            eleven_model: default_eleven_model(),
            wake_word: false,
            listen_shortcut: default_listen_shortcut(),
            voice_replies: false,
            chat_provider: default_provider(),
            devmark_model: default_devmark_model(),
            devmark_max_tokens: default_devmark_max_tokens(),
            gemini_model: default_gemini_model(),
            groq_model: default_groq_model(),
            plan_gauge: false,
            native_notifications: true,
            global_shortcuts: true,
            toggle_shortcut: default_toggle_shortcut(),
        }
    }
}

pub use crate::platform::{config_dir, local_dir};

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join(crate::platform::HOOK_EXE)
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    let mut settings: Settings = match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Settings::default(),
    };
    migrate(&mut settings);
    settings
}

/// Pills that were renamed keep working for people who had them switched on:
/// the Terminal pill became the VS Code pill (`agent_terminal` → `agent_vscode`).
fn migrate(settings: &mut Settings) {
    for id in settings.active_integrations.iter_mut() {
        if id == "agent_terminal" {
            *id = "agent_vscode".to_string();
        }
    }
    // n8n was removed in v2: drop it from saved settings.
    settings.active_integrations.retain(|id| id != "integration_n8n");
    let mut seen = std::collections::HashSet::new();
    settings.active_integrations.retain(|id| seen.insert(id.clone()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_terminal_pill_becomes_the_vscode_pill_without_duplicates() {
        let mut s = Settings::default();
        s.active_integrations = vec!["integration_github".into(), "agent_terminal".into(), "agent_vscode".into()];
        migrate(&mut s);
        assert_eq!(s.active_integrations, vec!["integration_github", "agent_vscode"]);
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    crate::platform::ensure_private_dir(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}
