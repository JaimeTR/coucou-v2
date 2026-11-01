// WhatsApp in the island (experimental) — Windows port of the Mac's WhatsAppController.
//
// Talks to the local gateway the user runs (GOWA, which Coucou can install and start itself,
// or OpenWA), receives new messages on a webhook bound to 127.0.0.1, falls back to polling
// every 20 s when no webhook comes, and keeps the conversations in memory only: nothing of a
// message is ever written to disk or to a log, and everything is forgotten when Coucou quits
// or the integration is turned off. Runs only while the integration is on and its pill is
// active: otherwise there is no timer, no listener and no request at all.
//
// The island draws what `IslandView` says (src/views/whatsapp.ts); it only ever sees status
// codes, which the front end translates.

pub mod gateway;
pub mod model;
pub mod prefs;
pub mod process;
pub mod provider;
pub mod webhook;

use std::sync::{LazyLock, Mutex, OnceLock};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use model::Inbox;
use prefs::Prefs;
use provider::Provider;

pub const PILL_ID: &str = "integration_whatsapp";
const WEBHOOK_PATH: &str = "/whatsapp";
pub const URL_KEY: &str = "whatsapp-url";
pub const CREDENTIAL_KEY: &str = "whatsapp-api-key";
pub const SECRET_KEY: &str = "whatsapp-webhook-secret";

const ISLAND_EVENT: &str = "whatsapp";
const PILL_EVENT: &str = "whatsapp-pill";
const SETTINGS_EVENT: &str = "whatsapp-settings";
const DEFAULT_PORT: u16 = 3000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum LinkState {
    Off,
    BadUrl,
    Connecting,
    NeedsQr,
    Connected,
    Unreachable,
    Unauthorized,
    Failed { detail: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum WebhookState {
    Off,
    Listening,
    Registered,
    Refused { detail: String },
    PortBusy { port: u16 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum SendError {
    TooLong,
    TooFast,
    Unreachable,
    Unauthorized,
    NeedsQr,
    Refused { detail: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum PillEvent {
    Message { name: String },
    Read,
    Reset,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandView {
    pub link: LinkView,
    pub webhook: WebhookView,
    pub conversations: Vec<ConversationView>,
    pub unread: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkView {
    pub state: LinkState,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookView {
    pub state: WebhookState,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationView {
    pub id: String,
    pub name: String,
    pub unread: u32,
    pub last_activity: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub webhook: WebhookView,
    pub install: InstallView,
    pub default_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallView {
    pub step: InstallStep,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "step", rename_all = "camelCase")]
pub enum InstallStep {
    Idle,
    Checking,
    Downloading { megabytes: u64 },
    Verifying,
    Installing,
    Done { version: String },
    Failed { reason: String },
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum TestResult {
    Connected { who: String },
    Failed { detail: String },
}

/// Central control: the single in-memory WhatsApp state.
struct Control {
    link: LinkState,
    webhook: WebhookState,
    url: String,
    has_credential: bool,
    prefs: Prefs,
    inbox: Inbox,
    provider: OnceLock<Provider>,
}

static CTL: LazyLock<Mutex<Control>> = LazyLock::new(|| {
    Mutex::new(Control {
        link: LinkState::Off,
        webhook: WebhookState::Off,
        url: String::new(),
        has_credential: false,
        prefs: Prefs::default(),
        inbox: Inbox::new(),
        provider: OnceLock::new(),
    })
});

fn ctl() -> std::sync::MutexGuard<'static, Control> {
    CTL.lock().unwrap()
}

fn only(window: &WebviewWindow, expected: &str) -> Result<(), String> {
    if window.label() != expected {
        return Err("wrong window".into());
    }
    Ok(())
}

fn changed(app: &AppHandle) {
    let v = ctl().island_view();
    let _ = app.emit(ISLAND_EVENT, &v);
}

fn settings_changed(app: &AppHandle) {
    let v = ctl().settings_view();
    let _ = app.emit(SETTINGS_EVENT, &v);
}

fn pill_event(app: &AppHandle, event: &PillEvent) {
    let _ = app.emit(PILL_EVENT, event);
}

pub fn start(app: &AppHandle, active_integrations: &[String]) {
    if !active_integrations.contains(&PILL_ID.to_string()) {
        return;
    }
    let mut c = ctl();
    if !c.prefs.enabled {
        return;
    }
    c.link = LinkState::Connecting;
    c.webhook = WebhookState::Listening;
    drop(c);
    changed(app);
    settings_changed(app);
}

pub fn shutdown() {
    let mut c = ctl();
    c.link = LinkState::Off;
    c.webhook = WebhookState::Off;
    c.provider = OnceLock::new();
}

impl Control {
    fn island_view(&self) -> IslandView {
        IslandView {
            link: LinkView { state: self.link.clone() },
            webhook: WebhookView { state: self.webhook.clone() },
            conversations: self
                .inbox
                .conversations
                .iter()
                .filter(|c| !self.prefs.ignored.contains(&c.id))
                .map(|c| ConversationView {
                    id: c.id.clone(),
                    name: c.name.clone(),
                    unread: c.unread,
                    last_activity: c.last_activity,
                })
                .collect(),
            unread: self
                .inbox
                .conversations
                .iter()
                .filter(|c| !self.prefs.ignored.contains(&c.id))
                .map(|c| c.unread)
                .sum(),
        }
    }

    fn settings_view(&self) -> SettingsView {
        SettingsView {
            webhook: WebhookView { state: self.webhook.clone() },
            install: InstallView { step: InstallStep::Idle },
            default_url: format!("http://127.0.0.1:{}/{}", DEFAULT_PORT, WEBHOOK_PATH.trim_start_matches('/')),
        }
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn whatsapp_settings(window: WebviewWindow, app: AppHandle) -> Result<SettingsView, String> {
    only(&window, crate::island::WINDOW_LABEL)?;
    Ok(ctl().settings_view())
}

#[tauri::command]
pub fn whatsapp_set_options(
    window: WebviewWindow,
    app: AppHandle,
    enabled: bool,
    mute_groups: bool,
    mark_read_on_open: bool,
) -> Result<(), String> {
    only(&window, crate::island::WINDOW_LABEL)?;
    let restart = {
        let mut c = ctl();
        let restart = c.prefs.enabled != enabled;
        c.prefs.enabled = enabled;
        c.prefs.mute_groups = mute_groups;
        c.prefs.mark_read_on_open = mark_read_on_open;
        prefs::save(&c.prefs);
        restart
    };
    if restart {
        settings_changed(&app);
    } else {
        changed(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn whatsapp_save_gateway(
    window: WebviewWindow,
    app: AppHandle,
    gateway: String,
    url: String,
    credential: Option<String>,
    port: u16,
    auto_start: bool,
    gowa_path: String,
) -> Result<(), String> {
    only(&window, crate::island::WINDOW_LABEL)?;
    let url = url.trim().to_string();
    if url.len() > 512 || credential.as_ref().is_some_and(|c| c.len() > 1024) {
        return Err("too long".into());
    }
    crate::secrets::set_internal(URL_KEY, &url)?;
    if let Some(credential) = &credential {
        crate::secrets::set_internal(CREDENTIAL_KEY, credential.trim())?;
    }
    {
        let mut c = ctl();
        c.url = url;
        if let Some(credential) = credential {
            c.has_credential = !credential.trim().is_empty();
        }
        let mut next = c.prefs.clone();
        next.gateway = gateway;
        if (1024..=65535).contains(&port) {
            next.port = port;
        }
        next.auto_start = auto_start;
        next.gowa_path = gowa_path;
        c.prefs = next.cleaned();
        prefs::save(&c.prefs);
    }
    settings_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn whatsapp_test(window: WebviewWindow, app: AppHandle) -> Result<TestResult, String> {
    only(&window, crate::island::WINDOW_LABEL)?;
    Ok(test_connection().await)
}

#[tauri::command]
pub fn whatsapp_install(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    only(&window, crate::island::WINDOW_LABEL)?;
    install();
    Ok(())
}

#[tauri::command]
pub fn whatsapp_send(window: WebviewWindow, chat: String, text: String) -> Result<(), String> {
    if window.label() != crate::island::WINDOW_LABEL {
        only(&window, crate::island::WINDOW_LABEL)?;
    }
    let chat = model::chat_from_entry(&chat).ok_or("not a chat")?;
    let provider = ctl().provider.get().ok_or("not connected")?.clone();
    tauri::async_runtime::spawn(async move {
        let _ = provider.send(&chat, &text).await;
    });
    Ok(())
}

#[tauri::command]
pub fn whatsapp_ignore(window: WebviewWindow, chat: String) -> Result<(), String> {
    if window.label() != crate::island::WINDOW_LABEL {
        only(&window, crate::island::WINDOW_LABEL)?;
    }
    let chat = model::chat_from_entry(&chat).ok_or("not a chat")?;
    model::ignore(&chat);
    changed(&window.app_handle());
    Ok(())
}

#[tauri::command]
pub fn whatsapp_unignore(window: WebviewWindow, chat: String) -> Result<(), String> {
    only(&window, crate::island::WINDOW_LABEL)?;
    {
        let mut c = ctl();
        c.prefs.ignored.retain(|x| x != &chat);
        prefs::save(&c.prefs);
    }
    changed(&window.app_handle());
    Ok(())
}

async fn test_connection() -> TestResult {
    let provider = match ctl().provider.get() {
        Some(p) => p.clone(),
        None => return TestResult::Failed { detail: "not configured".into() },
    };
    match provider.status().await {
        Ok(who) => TestResult::Connected { who },
        Err(e) => TestResult::Failed { detail: e.to_string() },
    }
}

fn install() {
    let _ = process::start_gowa();
}

pub fn on_message(app: &AppHandle) {
    changed(app);
    pill_event(app, &PillEvent::Message { name: String::new() });
}

pub fn mark_read(app: &AppHandle, chat_id: &str) {
    let mut c = ctl();
    if let Some(conv) = c.inbox.conversations.iter_mut().find(|c| c.id == chat_id) {
        conv.unread = 0;
    }
    drop(c);
    changed(app);
    pill_event(app, &PillEvent::Read);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pill_id_is_whatsapp() {
        assert_eq!(PILL_ID, "integration_whatsapp");
    }
}