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
    /// Apps of your own that get a pill: fed by a webhook or by polling a URL.
    #[serde(default)]
    pub custom_pills: Vec<CustomPill>,
    /// Mochi says the welcome aloud.
    #[serde(default)]
    pub voice_greeting: bool,
    /// Chat replies are read aloud as they arrive (each one also has a speaker button).
    #[serde(default)]
    pub voice_replies: bool,
    /// Master switch: Mochi's automatic phrases are spoken (off by default).
    #[serde(default)]
    pub voice_enabled: bool,
    /// Agent news is spoken: session finished, permission, question, error.
    #[serde(default)]
    pub voice_events: bool,
    /// Mochi's moods are spoken: slapped, dizzy, loved.
    #[serde(default)]
    pub voice_emotions: bool,
    /// "fixed" = glued to the top centre (the default), "free" = wherever it was dragged.
    #[serde(default = "default_island_position")]
    pub island_position: String,
    /// Free mode: the island window's top-left, in logical px from the display's
    /// top-left. None until the island is first dragged. Only Rust writes it.
    #[serde(default)]
    pub island_offset: Option<(f64, f64)>,
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

/// One app of your own in Mochi's pills.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomPill {
    /// "custom_" + lowercase letters and digits; the pill's stable id.
    pub id: String,
    pub name: String,
    /// "#rrggbb"
    pub color: String,
    /// "webhook" or "poll"
    pub kind: String,
    /// Webhook: the secret in its address. Generated by the page.
    pub hook_token: String,
    /// Poll: the address, the dotted path of the value, how often (seconds).
    pub poll_url: String,
    pub poll_path: String,
    pub poll_every: u32,
    /// Poll: the header that carries the token (default Authorization).
    pub auth_header: String,
    /// Opened from the pill's card.
    pub open_url: String,
}

pub const MAX_CUSTOM_PILLS: usize = 8;

fn is_web(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// Settings come from the page: keep only what is well-formed, so a bad value can
/// neither break the pill nor reach a style attribute, a URL or a header.
pub fn sanitize_pills(pills: Vec<CustomPill>) -> Vec<CustomPill> {
    let mut seen = std::collections::HashSet::new();
    pills
        .into_iter()
        .filter_map(|mut p| {
            let slug = p.id.strip_prefix("custom_")?;
            if slug.is_empty() || slug.len() > 24 || !slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
                return None;
            }
            if !seen.insert(p.id.clone()) {
                return None;
            }
            p.name = p.name.trim().chars().take(24).collect();
            if p.name.is_empty() {
                return None;
            }
            let hex = p.color.len() == 7 && p.color.starts_with('#') && p.color[1..].chars().all(|c| c.is_ascii_hexdigit());
            if !hex {
                p.color = "#8C8C8C".into();
            }
            match p.kind.as_str() {
                "webhook" => {
                    if p.hook_token.len() < 16 || p.hook_token.len() > 64 || !p.hook_token.chars().all(|c| c.is_ascii_alphanumeric()) {
                        return None;
                    }
                }
                "poll" => {
                    if !is_web(&p.poll_url) || p.poll_url.len() > 500 {
                        return None;
                    }
                    p.poll_every = p.poll_every.clamp(30, 86_400);
                    p.poll_path = p.poll_path.trim().chars().take(120).collect();
                    let header_ok = !p.auth_header.is_empty()
                        && p.auth_header.len() <= 40
                        && p.auth_header.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
                    if !header_ok {
                        p.auth_header = "Authorization".into();
                    }
                }
                _ => return None,
            }
            if !p.open_url.is_empty() && (!is_web(&p.open_url) || p.open_url.len() > 500) {
                p.open_url.clear();
            }
            Some(p)
        })
        .take(MAX_CUSTOM_PILLS)
        .collect()
}

pub fn default_toggle_shortcut() -> String {
    "Ctrl+Alt+C".into()
}

fn default_start_pill() -> String {
    "integration_claude".into()
}

fn default_island_position() -> String {
    "fixed".into()
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
            custom_pills: Vec::new(),
            voice_greeting: false,
            voice_enabled: false,
            voice_events: false,
            voice_emotions: false,
            island_position: default_island_position(),
            island_offset: None,
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

#[cfg(test)]
mod custom_pill_tests {
    use super::*;

    fn pill(id: &str) -> CustomPill {
        CustomPill {
            id: id.into(),
            name: "Mi app".into(),
            color: "#22C55E".into(),
            kind: "webhook".into(),
            hook_token: "abcdef0123456789abcdef".into(),
            ..Default::default()
        }
    }

    #[test]
    fn a_good_pill_is_kept_and_a_bad_one_is_dropped() {
        let kept = sanitize_pills(vec![pill("custom_abc1"), pill("nope"), pill("custom_UP"), pill("custom_abc1")]);
        assert_eq!(kept.len(), 1, "wrong prefix, capitals and a repeated id are dropped");
    }

    #[test]
    fn colour_urls_and_header_are_cleaned() {
        let mut p = pill("custom_x1");
        p.color = "red; background:url(x)".into();
        p.open_url = "javascript:alert(1)".into();
        let kept = sanitize_pills(vec![p]);
        assert_eq!(kept[0].color, "#8C8C8C");
        assert_eq!(kept[0].open_url, "");

        let mut poll = pill("custom_p1");
        poll.kind = "poll".into();
        poll.poll_url = "https://example.com/x".into();
        poll.poll_every = 1;
        poll.auth_header = "X Bad\r\nHeader".into();
        let kept = sanitize_pills(vec![poll]);
        assert_eq!(kept[0].poll_every, 30);
        assert_eq!(kept[0].auth_header, "Authorization");
    }

    #[test]
    fn a_webhook_needs_a_long_secret_and_a_poll_needs_a_web_address() {
        let mut short = pill("custom_s1");
        short.hook_token = "abc".into();
        let mut bad_url = pill("custom_u1");
        bad_url.kind = "poll".into();
        bad_url.poll_url = "file:///etc/passwd".into();
        assert!(sanitize_pills(vec![short, bad_url]).is_empty());
    }

    #[test]
    fn there_is_a_limit() {
        let many: Vec<_> = (0..20).map(|i| pill(&format!("custom_a{i}"))).collect();
        assert_eq!(sanitize_pills(many).len(), MAX_CUSTOM_PILLS);
    }
}
