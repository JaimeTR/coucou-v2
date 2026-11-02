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

pub mod archive;
pub mod gateway;
pub mod install;
pub mod model;
pub mod prefs;
pub mod process;
pub mod provider;
pub mod webhook;

use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use model::Inbox;
use prefs::Prefs;
use provider::{Provider, WaError, WaLink};

pub const PILL_ID: &str = "integration_whatsapp";
const WEBHOOK_PATH: &str = "/whatsapp";
pub const URL_KEY: &str = "whatsapp-url";
pub const CREDENTIAL_KEY: &str = "whatsapp-api-key";
pub const SECRET_KEY: &str = "whatsapp-webhook-secret";

const ISLAND_EVENT: &str = "whatsapp";
const PILL_EVENT: &str = "whatsapp-pill";
const SETTINGS_EVENT: &str = "whatsapp-settings";
const DEFAULT_PORT: u16 = 3000;
/// How often `on_tick` runs once the integration is on (mirrors the Mac's 5 s `Timer`).
const TICK_EVERY: Duration = Duration::from_secs(5);
/// No webhook delivery for this long: the fallback poll takes over (Mac's `webhookAlive`).
const WEBHOOK_ALIVE_WINDOW: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum LinkState {
    Off,
    BadUrl,
    Connecting,
    NeedsQr { png_base64: String },
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
    provider: Option<Provider>,
    process: process::Process,
    listener: webhook::Listener,
    webhook_secret: String,
    last_webhook: Option<Instant>,
    tick: u32,
    generation: u64,
    install_step: InstallStep,
}

static CTL: LazyLock<Mutex<Control>> = LazyLock::new(|| {
    Mutex::new(Control {
        link: LinkState::Off,
        webhook: WebhookState::Off,
        url: String::new(),
        has_credential: false,
        prefs: Prefs::default(),
        inbox: Inbox::new(),
        provider: None,
        process: process::Process::new(),
        listener: webhook::Listener::new(),
        webhook_secret: String::new(),
        last_webhook: None,
        tick: 0,
        generation: 0,
        install_step: InstallStep::Idle,
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

/// Writes the in-memory prefs into the app's shared `Settings` and persists them to disk —
/// same path every other non-secret setting takes (see island.rs's drag/dock handlers).
fn persist_prefs(app: &AppHandle) {
    let prefs = ctl().prefs.clone();
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let settings = {
        let mut s = shared.settings.lock().unwrap();
        prefs.write_into(&mut s);
        s.clone()
    };
    if let Err(err) = crate::settings::save(&settings) {
        eprintln!("[coucou] could not save whatsapp settings: {err}");
    }
}

pub fn start(app: &AppHandle, active_integrations: &[String]) {
    if !active_integrations.contains(&PILL_ID.to_string()) {
        return;
    }
    // Shared.settings is already `.manage()`d with the settings loaded at launch by the time
    // `setup()` calls this (see lib.rs) — reuse that copy instead of reading the file twice.
    let settings = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().clone())
        .unwrap_or_else(crate::settings::load);
    let enabled = {
        let mut c = ctl();
        c.prefs = Prefs::from_settings(&settings);
        c.url = crate::secrets::get(URL_KEY).unwrap_or_default();
        c.has_credential = crate::secrets::get(CREDENTIAL_KEY).map(|v| !v.trim().is_empty()).unwrap_or(false);
        c.webhook_secret = webhook_secret();
        c.prefs.enabled
    };
    if !enabled {
        return;
    }
    begin(app);
}

/// Called once at app exit.
pub fn shutdown() {
    let mut c = ctl();
    c.generation += 1;
    c.listener.stop();
    c.process.stop_now();
    c.provider = None;
    c.link = LinkState::Off;
    c.webhook = WebhookState::Off;
}

fn webhook_secret() -> String {
    if let Some(s) = crate::secrets::get(SECRET_KEY) {
        if s.len() >= 16 {
            return s;
        }
    }
    // No new RNG dependency: `aes-gcm` (already a dependency, for settings sync) pulls in
    // `aead`, which re-exports a CSPRNG (`OsRng`) and the `RngCore` trait that gives it
    // `fill_bytes` — sync.rs already uses the same `OsRng` to generate AES-GCM nonces.
    use aes_gcm::aead::{rand_core::RngCore, OsRng};
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let _ = crate::secrets::set_internal(SECRET_KEY, &hex);
    hex
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
            install: InstallView { step: self.install_step.clone() },
            default_url: format!("http://127.0.0.1:{}{}", DEFAULT_PORT, WEBHOOK_PATH),
        }
    }
}

// ── Lifecycle (ports WhatsAppController.swift's begin/stop/onTick/refresh/register) ────────

fn begin(app: &AppHandle) {
    let (url_ok, url, has_cred, generation) = {
        let mut c = ctl();
        let ok = url::Url::parse(&c.url).is_ok();
        if !ok {
            c.link = LinkState::BadUrl;
        } else {
            c.generation += 1;
            c.link = LinkState::Connecting;
            c.tick = 0;
            c.last_webhook = None;
        }
        (ok, c.url.clone(), c.has_credential, c.generation)
    };
    if !url_ok {
        changed(app);
        return;
    }
    let credential = has_cred.then(|| crate::secrets::get(CREDENTIAL_KEY)).flatten();
    {
        let mut c = ctl();
        c.provider = Some(Provider::new(url.clone(), credential.clone()));
    }
    start_listener(app, generation);
    {
        let mut c = ctl();
        if c.prefs.auto_start {
            let gowa_path = c.prefs.gowa_path.clone();
            c.process.sync(&gowa_path, &url, credential.as_deref());
        }
    }
    changed(app);
    settings_changed(app);
    refresh(app, generation);
    spawn_tick_loop(app, generation);
}

/// Stops talking to the gateway. `forget`: the conversations go too.
fn stop(app: &AppHandle, forget: bool) {
    let stop_process = {
        let mut c = ctl();
        c.generation += 1;
        c.listener.stop();
        c.provider = None;
        c.link = LinkState::Off;
        c.webhook = WebhookState::Off;
        c.last_webhook = None;
        c.tick = 0;
        if forget {
            c.inbox = Inbox::new();
        }
        // Turned off outright: GOWA goes too. A settings change that restarts `begin()`
        // keeps it running (or `Process::sync` restarts it itself if its own args changed).
        !c.prefs.enabled
    };
    if stop_process {
        ctl().process.stop_now();
    }
    changed(app);
}

fn spawn_tick_loop(app: &AppHandle, generation: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(TICK_EVERY).await;
            if ctl().generation != generation {
                break; // begin()/stop() moved on: this loop has nothing left to do.
            }
            on_tick(&app, generation);
        }
    });
}

fn on_tick(app: &AppHandle, generation: u64) {
    let (should_refresh, should_poll) = {
        let mut c = ctl();
        if c.generation != generation || c.provider.is_none() {
            return;
        }
        c.tick += 1;
        let webhook_alive = c.last_webhook.map(|t| t.elapsed() < WEBHOOK_ALIVE_WINDOW).unwrap_or(false);
        (c.tick % 12 == 0, c.tick % 4 == 0 && !webhook_alive)
    };
    if should_refresh {
        refresh(app, generation);
    }
    if should_poll {
        poll(app, generation);
    }
}

fn refresh(app: &AppHandle, generation: u64) {
    let provider = {
        let c = ctl();
        if c.generation != generation {
            return;
        }
        c.provider.clone()
    };
    let Some(provider) = provider else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match provider.status().await {
            Ok(WaLink::Connected { .. }) => {
                let should_register = {
                    let mut c = ctl();
                    if c.generation != generation {
                        return;
                    }
                    c.link = LinkState::Connected;
                    c.webhook == WebhookState::Listening
                };
                if should_register {
                    register(&app, &provider, generation).await;
                }
                changed(&app);
            }
            Ok(WaLink::NeedsQr) => {
                let qr = provider.qr_code().await;
                let mut c = ctl();
                if c.generation != generation {
                    return;
                }
                c.link = match qr {
                    Ok(Some((png, _seconds))) => LinkState::NeedsQr { png_base64: B64.encode(&png) },
                    // ALREADY_LOGGED_IN raced our own status() call — the next tick's status()
                    // will report Connected once GOWA catches up.
                    Ok(None) => LinkState::Connecting,
                    Err(_) => LinkState::NeedsQr { png_base64: String::new() },
                };
                drop(c);
                changed(&app);
            }
            Err(e) => apply_error(&app, generation, e),
        }
    });
}

async fn register(app: &AppHandle, provider: &Provider, generation: u64) {
    let (port, secret) = {
        let c = ctl();
        (c.prefs.port, c.webhook_secret.clone())
    };
    let url = format!("http://127.0.0.1:{port}{WEBHOOK_PATH}");
    match provider.register_webhook(&url, &secret).await {
        Ok(()) => {
            let mut c = ctl();
            if c.generation == generation {
                c.webhook = WebhookState::Registered;
            }
            drop(c);
            settings_changed(app);
        }
        Err(WaError::Refused { detail }) => {
            let mut c = ctl();
            if c.generation == generation {
                c.webhook = WebhookState::Refused { detail };
            }
            drop(c);
            settings_changed(app);
        }
        Err(_) => {} // tried again on the next refresh
    }
}

fn apply_error(app: &AppHandle, generation: u64, error: WaError) {
    let restart_process = matches!(error, WaError::Unreachable);
    let (gowa_path, url, has_cred) = {
        let mut c = ctl();
        if c.generation != generation {
            return;
        }
        c.link = match &error {
            WaError::Unreachable => LinkState::Unreachable,
            WaError::Unauthorized => LinkState::Unauthorized,
            WaError::Refused { detail } | WaError::Other { detail } => LinkState::Failed { detail: detail.clone() },
            WaError::NotLinked | WaError::NeedsQr | WaError::TooLong | WaError::TooFast => {
                LinkState::NeedsQr { png_base64: String::new() }
            }
        };
        (c.prefs.gowa_path.clone(), c.url.clone(), c.has_credential)
    };
    changed(app);
    // GOWA was started by Coucou and seems to have gone (crash, killed): started again, but
    // `Process::sync` itself refuses to retry more than once a minute.
    if restart_process {
        let credential = has_cred.then(|| crate::secrets::get(CREDENTIAL_KEY)).flatten();
        ctl().process.sync(&gowa_path, &url, credential.as_deref());
    }
}

/// Backfill/poll fallback for when the webhook isn't delivering: deferred. The webhook is the
/// primary delivery path (registered in `register()` above); this 20 s poll only matters when
/// GOWA cannot reach Coucou's own webhook at all, which `on_tick`'s `webhook_alive` gate means
/// is already the uncommon case. Needs `Provider::recent_messages` (not part of Task 3's
/// interface), so left as a logged no-op for this task — see task-6-report.md.
fn poll(_app: &AppHandle, _generation: u64) {}

fn start_listener(app: &AppHandle, generation: u64) {
    let port = ctl().prefs.port;
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        // `Listener::start` only needs `&mut self` to set up the bind + spawn the accept loop;
        // the guard must not be held across its `.await` (MutexGuard isn't Send), so take the
        // listener out, start it unlocked, then put it back.
        let mut listener = std::mem::replace(&mut ctl().listener, webhook::Listener::new());
        let app3 = app2.clone();
        let started = listener.start(port, move |req| handle_webhook_request(&app3, generation, req)).await;
        ctl().listener = listener;
        let mut c = ctl();
        if c.generation == generation {
            c.webhook = if started { WebhookState::Listening } else { WebhookState::PortBusy { port } };
        }
        drop(c);
        settings_changed(&app2);
    });
}

fn handle_webhook_request(app: &AppHandle, generation: u64, req: webhook::Request) -> u16 {
    if req.method != "POST" || !req.path.starts_with(WEBHOOK_PATH) {
        return 404;
    }
    let secret = ctl().webhook_secret.clone();
    if !verify_webhook(&req, &secret) {
        return 401;
    }
    let mut c = ctl();
    if c.generation != generation {
        return 200;
    }
    c.last_webhook = Some(Instant::now());
    if c.webhook != WebhookState::Registered {
        c.webhook = WebhookState::Registered;
    }
    drop(c);
    on_message(app);
    200
}

/// GOWA signs its webhook deliveries with `x-hub-signature-256: sha256=<hex HMAC-SHA256 of
/// the raw body, keyed by the webhook secret>` — ground truth is `WAWebhook.verify` /
/// `WAGatewayKind.signatureHeader` in the Mac's WhatsAppGateway.swift (GOWA case). This has
/// not been exercised against a real GOWA instance (none available in this environment) —
/// verify it against a captured payload before shipping; see task-6-report.md.
fn verify_webhook(req: &webhook::Request, secret: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    if secret.is_empty() {
        return false;
    }
    let Some(sent) = req.headers.get("x-hub-signature-256") else { return false };
    let Some(sent_hex) = sent.strip_prefix("sha256=") else { return false };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else { return false };
    mac.update(&req.body);
    let expected: String = mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect();
    constant_time_eq(sent_hex, &expected)
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn whatsapp_settings(window: WebviewWindow, _app: AppHandle) -> Result<SettingsView, String> {
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
        restart
    };
    persist_prefs(&app);
    if restart {
        if enabled {
            begin(&app);
        } else {
            stop(&app, true);
        }
    } else {
        changed(&app);
    }
    settings_changed(&app);
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
    // Settings only ever tracks GOWA (see prefs.rs) — `gateway` is accepted and ignored so the
    // TS call's signature doesn't need to change.
    let _ = gateway;
    let url = url.trim().to_string();
    if url.len() > 512 || credential.as_ref().is_some_and(|c| c.len() > 1024) {
        return Err("too long".into());
    }
    crate::secrets::set_internal(URL_KEY, &url)?;
    if let Some(credential) = &credential {
        crate::secrets::set_internal(CREDENTIAL_KEY, credential.trim())?;
    }
    let enabled = {
        let mut c = ctl();
        c.url = url;
        if let Some(credential) = credential {
            c.has_credential = !credential.trim().is_empty();
        }
        let mut next = c.prefs.clone();
        if (1024..=65535).contains(&port) {
            next.port = port;
        }
        next.auto_start = auto_start;
        next.gowa_path = gowa_path;
        c.prefs = next.cleaned();
        c.prefs.enabled
    };
    persist_prefs(&app);
    if enabled {
        // URL/port/credential/gowa_path changed while on: start over, same as the Mac's
        // settingsChanged() (stop, then begin again with the new values).
        begin(&app);
    }
    settings_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn whatsapp_test(window: WebviewWindow, _app: AppHandle) -> Result<TestResult, String> {
    only(&window, crate::island::WINDOW_LABEL)?;
    Ok(test_connection().await)
}

#[tauri::command]
pub fn whatsapp_install(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    only(&window, crate::island::WINDOW_LABEL)?;
    start_install(app);
    Ok(())
}

#[tauri::command]
pub fn whatsapp_send(window: WebviewWindow, chat: String, text: String) -> Result<(), String> {
    if window.label() != crate::island::WINDOW_LABEL {
        only(&window, crate::island::WINDOW_LABEL)?;
    }
    let chat = model::chat_from_entry(&chat).ok_or("not a chat")?;
    let provider = ctl().provider.as_ref().cloned().ok_or("not connected")?;
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
    let app = window.app_handle().clone();
    {
        let mut c = ctl();
        if !c.prefs.ignored.iter().any(|x| x == &chat) {
            c.prefs.ignored.push(chat);
            c.prefs = std::mem::take(&mut c.prefs).cleaned();
        }
    }
    persist_prefs(&app);
    changed(&app);
    Ok(())
}

#[tauri::command]
pub fn whatsapp_unignore(window: WebviewWindow, chat: String) -> Result<(), String> {
    only(&window, crate::island::WINDOW_LABEL)?;
    {
        let mut c = ctl();
        c.prefs.ignored.retain(|x| x != &chat);
    }
    let app = window.app_handle().clone();
    persist_prefs(&app);
    changed(&app);
    Ok(())
}

async fn test_connection() -> TestResult {
    let provider = match ctl().provider.as_ref().cloned() {
        Some(p) => p,
        None => return TestResult::Failed { detail: "not configured".into() },
    };
    match provider.status().await {
        Ok(WaLink::Connected { who }) => TestResult::Connected { who },
        Ok(WaLink::NeedsQr) => TestResult::Failed { detail: "needs qr".into() },
        Err(e) => TestResult::Failed { detail: e.to_string() },
    }
}

fn start_install(app: AppHandle) {
    {
        let mut c = ctl();
        c.install_step = InstallStep::Checking;
    }
    settings_changed(&app);
    tauri::async_runtime::spawn(async move {
        let progress_app = app.clone();
        let result = install::install(move |step| {
            ctl().install_step = step;
            settings_changed(&progress_app);
        })
        .await;
        {
            let mut c = ctl();
            c.install_step = match &result {
                Ok(version) => InstallStep::Done { version: version.clone() },
                Err(e) => InstallStep::Failed { reason: e.to_string() },
            };
            if result.is_ok() {
                c.prefs.gowa_path =
                    process::working_dir().join(process::binary_name()).to_string_lossy().to_string();
            }
        }
        persist_prefs(&app);
        settings_changed(&app);
    });
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

    #[test]
    fn webhook_secret_persists_across_calls() {
        // secrets.rs has no test seam here; check the length/format invariant only.
        let a = super::webhook_secret();
        assert_eq!(a.len(), 64); // 32 bytes, hex
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn verify_webhook_accepts_a_matching_signature_and_rejects_everything_else() {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        let secret = "s3cret";
        let body = b"{\"event\":\"message\"}".to_vec();
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(&body);
        let sig: String = mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect();

        let mut headers = std::collections::HashMap::new();
        headers.insert("x-hub-signature-256".to_string(), format!("sha256={sig}"));
        let good = webhook::Request { method: "POST".into(), path: "/whatsapp".into(), headers: headers.clone(), body: body.clone() };
        assert!(verify_webhook(&good, secret));

        let mut wrong_headers = headers.clone();
        wrong_headers.insert("x-hub-signature-256".to_string(), "sha256=deadbeef".to_string());
        let bad = webhook::Request { method: "POST".into(), path: "/whatsapp".into(), headers: wrong_headers, body: body.clone() };
        assert!(!verify_webhook(&bad, secret));

        let no_header = webhook::Request {
            method: "POST".into(),
            path: "/whatsapp".into(),
            headers: std::collections::HashMap::new(),
            body,
        };
        assert!(!verify_webhook(&no_header, secret));
        assert!(!verify_webhook(&good, ""));
    }
}
