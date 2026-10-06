// Coucou for Windows — app wiring and the commands the island calls.

mod agents;
mod claude;
mod compat;
mod devmark;
mod files;
mod hooks;
mod identity;
mod integrations;
mod island;
mod log;
mod pipe;
mod platform;
mod rules;
mod secrets;
mod settings;
mod tray;
mod workspaces;

use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

use claude::{Chat, ChatContext, ChatReply};
use files::DroppedFile;
use hooks::{HookPreview, HookStatus};
use island::{PollGate, ScreenInfo};
use pipe::Pending;
use settings::Settings;

pub struct Shared {
    pub settings: Mutex<Settings>,
    pub gate: Arc<PollGate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    settings: Settings,
    screen: ScreenInfo,
    version: String,
    hook_path: String,
    /// False where the OS has no global cursor (Wayland): the page then reports
    /// the cursor from its own mouse events.
    cursor_poll: bool,
    /// The name found for this account, used when the settings hold none.
    detected_name: String,
}

#[tauri::command]
fn boot(app: AppHandle, shared: State<Shared>) -> BootInfo {
    let mut settings = shared.settings.lock().unwrap().clone();
    // The real state of ~/.claude/settings.json wins over whatever we stored.
    settings.hooks_installed = hooks::status().installed;
    let screen = island::screen_info(&app, &settings.screen);
    BootInfo {
        settings,
        screen,
        version: env!("CARGO_PKG_VERSION").to_string(),
        hook_path: settings::hook_exe_path().to_string_lossy().to_string(),
        cursor_poll: platform::CURSOR_POLL,
        detected_name: identity::detect_user_name(),
    }
}

/// Recent projects for the Claude Code and VS Code cards (paths only, read-only).
#[tauri::command]
fn claude_projects() -> Vec<workspaces::Project> {
    workspaces::claude_projects(5)
}

#[tauri::command]
fn vscode_projects() -> Vec<workspaces::Project> {
    workspaces::vscode_projects(5)
}

/// Settings → Setup checklist: which of the tools Coucou knows are installed.
#[tauri::command]
fn detect_tools() -> Vec<identity::Tool> {
    identity::detect_tools()
}

// ── Global shortcuts ──────────────────────────────────────────────────────────
//
// Ctrl+Alt+Y / Ctrl+Alt+N approve or deny the permission card that is up, from
// whatever window has the keyboard. They are only registered while such a card
// exists, so the rest of the time no other program loses those keys. Ctrl+Alt+C
// opens or closes the island and stays registered.

fn allow_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyY)
}

fn deny_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN)
}

/// "Ctrl+Alt+C", "F8", "Ctrl+Space": one or more modifiers and a key, or an F key
/// alone. A bare letter would take that letter away from every other program.
fn parse_toggle(accel: &str) -> Result<Shortcut, String> {
    let accel = accel.trim();
    let shortcut: Shortcut = accel
        .parse()
        .map_err(|_| format!("«{accel}» no es una combinación válida"))?;
    let function_key = matches!(
        shortcut.key,
        Code::F1 | Code::F2 | Code::F3 | Code::F4 | Code::F5 | Code::F6 | Code::F7 | Code::F8
            | Code::F9 | Code::F10 | Code::F11 | Code::F12
    );
    if shortcut.mods.is_empty() && !function_key {
        return Err("Añade Ctrl, Alt o Shift, o usa una tecla F1 a F12".into());
    }
    Ok(shortcut)
}

/// The saved combination, or the default when it cannot be read.
fn toggle_shortcut(app: &AppHandle) -> Shortcut {
    let saved = app.state::<Shared>().settings.lock().unwrap().toggle_shortcut.clone();
    parse_toggle(&saved)
        .or_else(|_| parse_toggle(&settings::default_toggle_shortcut()))
        .expect("the default shortcut is valid")
}

/// Settings → "Atajo para abrir Coucou": tries the new combination, keeps the old
/// one when it is taken, and saves it only when it worked.
#[tauri::command]
fn set_toggle_shortcut(app: AppHandle, shared: State<Shared>, accel: String) -> Result<String, String> {
    let wanted = parse_toggle(&accel)?;
    let enabled = shared.settings.lock().unwrap().global_shortcuts;
    let old = toggle_shortcut(&app);
    if wanted != old && enabled {
        let keys = app.global_shortcut();
        keys.register(wanted).map_err(|_| "Otra aplicación ya usa esa combinación".to_string())?;
        let _ = keys.unregister(old);
    }
    let accel = accel.trim().to_string();
    let snapshot = {
        let mut current = shared.settings.lock().unwrap();
        current.toggle_shortcut = accel.clone();
        current.clone()
    };
    if let Err(err) = settings::save(&snapshot) {
        eprintln!("[coucou] could not save settings: {err}");
    }
    let _ = app.emit("settings-changed", snapshot);
    Ok(accel)
}

fn register_shortcut(app: &AppHandle, shortcut: Shortcut, label: &str) {
    let keys = app.global_shortcut();
    if keys.is_registered(shortcut) {
        return;
    }
    // Another program may already own the combination: say so and carry on.
    if let Err(err) = keys.register(shortcut) {
        log::line(format!("global shortcut {label} unavailable: {err}"));
    }
}

fn unregister_shortcut(app: &AppHandle, shortcut: Shortcut) {
    let keys = app.global_shortcut();
    if keys.is_registered(shortcut) {
        let _ = keys.unregister(shortcut);
    }
}

/// The island shows a permission card (`active`) or has just let it go.
#[tauri::command]
fn set_decision_shortcuts(app: AppHandle, shared: State<Shared>, active: bool) {
    let enabled = shared.settings.lock().unwrap().global_shortcuts;
    if active && enabled {
        register_shortcut(&app, allow_shortcut(), "Ctrl+Alt+Y");
        register_shortcut(&app, deny_shortcut(), "Ctrl+Alt+N");
    } else {
        unregister_shortcut(&app, allow_shortcut());
        unregister_shortcut(&app, deny_shortcut());
    }
}

/// The permanent one follows the setting; the other two only ever follow a card.
fn apply_shortcut_setting(app: &AppHandle, enabled: bool) {
    if enabled {
        register_shortcut(app, toggle_shortcut(app), "the open shortcut");
    } else {
        unregister_shortcut(app, toggle_shortcut(app));
        unregister_shortcut(app, allow_shortcut());
        unregister_shortcut(app, deny_shortcut());
    }
}

// ── Native notifications ──────────────────────────────────────────────────────

/// A Windows toast for something that needs a person. Kept short on purpose:
/// the notification centre remembers what it was given.
#[tauri::command]
fn notify(app: AppHandle, shared: State<Shared>, title: String, body: String) {
    if !shared.settings.lock().unwrap().native_notifications {
        return;
    }
    let cut = |s: String, max: usize| -> String {
        if s.chars().count() <= max {
            s
        } else {
            s.chars().take(max).collect::<String>() + "…"
        }
    };
    let result = app
        .notification()
        .builder()
        .title(cut(title, 80))
        .body(cut(body, 160))
        .show();
    if let Err(err) = result {
        log::line(format!("notification failed: {err}"));
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, shared: State<Shared>, settings: Settings) {
    let (screen_changed, autostart_changed, shortcuts_changed) = {
        let mut current = shared.settings.lock().unwrap();
        let screen_changed = current.screen != settings.screen;
        let autostart_changed = current.autostart != settings.autostart;
        let shortcuts_changed = current.global_shortcuts != settings.global_shortcuts;
        *current = settings.clone();
        (screen_changed, autostart_changed, shortcuts_changed)
    };
    if shortcuts_changed {
        apply_shortcut_setting(&app, settings.global_shortcuts);
    }
    if let Err(err) = settings::save(&settings) {
        eprintln!("[coucou] could not save settings: {err}");
    }
    if autostart_changed {
        let manager = app.autolaunch();
        let result = if settings.autostart { manager.enable() } else { manager.disable() };
        if let Err(err) = result {
            eprintln!("[coucou] autostart: {err}");
        }
    }
    if screen_changed {
        let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
        island::apply_geometry(&app, &settings.screen, collapsed);
    }
    // Keep the other window in step (island ⇄ settings window).
    let _ = app.emit("settings-changed", settings);
}

/// Hidden island → shrink the window to the invisible wake strip and park the
/// cursor poll; anything else → full panel and 60 Hz polling.
#[tauri::command]
fn set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool) {
    let pref = shared.settings.lock().unwrap().screen.clone();
    shared.gate.collapsed.store(collapsed, Ordering::Relaxed);
    island::apply_geometry(&app, &pref, collapsed);
    // The wake strip must always take the mouse, and a resize invalidates the flag.
    island::refresh_click_through(&app, &shared.gate);
    shared.gate.set_active(!collapsed);
}

/// The front end pushes the island shape; Rust decides click-through from it.
#[tauri::command]
fn set_island_rect(app: AppHandle, shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    shared.gate.set_rect(island::IslandRect { x, y, w: width, h: height });
    // Without the cursor poll the input region is the click-through: it follows the island.
    if !platform::CURSOR_POLL {
        island::refresh_click_through(&app, &shared.gate);
    }
}

#[tauri::command]
fn focus_window(app: AppHandle, focused: bool) {
    let Some(win) = island::window(&app) else { return };
    platform::set_activating(&win, focused);
    if focused {
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn reposition(app: AppHandle, shared: State<Shared>) {
    let pref = shared.settings.lock().unwrap().screen.clone();
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(&app, &pref, collapsed);
}

#[tauri::command]
fn open_url(url: String) {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    platform::open_url(&url);
}

/// "Open terminal" opens the working folder in VS Code when `code` is on PATH,
/// and falls back to the file manager otherwise.
#[tauri::command]
fn open_in_vscode(path: Option<String>) -> bool {
    // No shell anywhere near this. The path is a project folder chosen by
    // whoever is using Claude Code, and a shell would happily read `&`, `^`, `%`
    // or `$` in a folder name as syntax. Finding the launcher ourselves and
    // handing the path over as a separate argument keeps it a path.
    let path = path.filter(|p| !p.is_empty());
    // It arrives in a hook payload: only an existing folder, given by its full
    // path, goes any further. `code` would read `--something` as an option, and
    // xdg-open would launch a file with whatever handles its type.
    if let Some(p) = path.as_deref() {
        let p = std::path::Path::new(p);
        if !(p.is_absolute() && p.is_dir()) {
            return false;
        }
    }
    if let Some(code) = platform::find_on_path("code") {
        let mut cmd = Command::new(code);
        if let Some(p) = path.as_deref() {
            cmd.arg(p);
        }
        if platform::no_console(&mut cmd).spawn().is_ok() {
            return true;
        }
    }
    if let Some(p) = path.as_deref() {
        platform::reveal_folder(p);
    }
    false
}

/// Starts a per-user program installed under `%LOCALAPPDATA%Programs`.
#[cfg(windows)]
fn open_local_program(folder: &str, exe: &str) -> bool {
    let Some(base) = std::env::var_os("LOCALAPPDATA") else {
        return false;
    };
    let exe = std::path::PathBuf::from(base).join("Programs").join(folder).join(exe);
    exe.is_file() && Command::new(exe).spawn().is_ok()
}

/// Opens the installed desktop program of an agent: OpenCode's Windows app, or
/// Gemini on the web (it has no desktop app). False when it is not installed.
#[tauri::command]
fn open_agent_app(agent: String) -> bool {
    match agent.as_str() {
        "gemini" => {
            platform::open_url("https://gemini.google.com/app");
            true
        }
        #[cfg(windows)]
        "opencode" => open_local_program("@opencode-aidesktop", "OpenCode.exe"),
        #[cfg(windows)]
        "antigravity" => open_local_program("Antigravity", "Antigravity.exe"),
        #[cfg(windows)]
        "antigravity-ide" => open_local_program("Antigravity IDE", "Antigravity IDE.exe"),
        _ => false,
    }
}

/// Starts a coding agent in a new terminal window, in a project folder (the home
/// folder when none is given). `resume` continues that folder's latest
/// conversation where the agent supports it. Only these three agents can be
/// started, and the folder is the working directory — never part of a command
/// line, so nothing in its name can be read as shell syntax.
#[tauri::command]
fn launch_agent(agent: String, path: Option<String>, resume: bool) -> bool {
    let (program, resume_args): (&str, &[&str]) = match agent.as_str() {
        "claude" => ("claude", &["--continue"]),
        "opencode" => ("opencode", &["--continue"]),
        "gemini" => ("gemini", &[]),
        "agy" => ("agy", &[]),
        _ => return false,
    };
    // Without the program installed, Windows would show its own "cannot find the
    // file" dialog; the island says so (and how to install it) instead.
    if platform::find_on_path(program).is_none() {
        return false;
    }
    let dir = match path.filter(|p| !p.is_empty()) {
        Some(p) => {
            let d = std::path::PathBuf::from(p);
            if !(d.is_absolute() && d.is_dir()) {
                return false;
            }
            d
        }
        None => match std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            Some(h) => std::path::PathBuf::from(h),
            None => return false,
        },
    };
    #[cfg(windows)]
    {
        let mut cmd = Command::new("cmd");
        cmd.current_dir(&dir)// The title must be quoted (a space makes Rust quote it): an unquoted
        // one is taken for the program, and the program for its argument.
        .args(["/c", "start", "Coucou agente", program]);
        if resume {
            cmd.args(resume_args);
        }
        return platform::no_console(&mut cmd).spawn().is_ok();
    }
    #[cfg(not(windows))]
    {
        let _ = (program, resume_args, resume, dir);
        false
    }
}

/// "Open terminal": brings forward the window of the terminal this session runs
/// in, given the process chain coucou-hook captured. False means "no window
/// found", and the island falls back to opening the folder in VS Code.
#[tauri::command]
fn focus_terminal(pids: Vec<u32>) -> bool {
    // It arrives in a hook payload: a short list, nothing else.
    if pids.is_empty() || pids.len() > 16 {
        return false;
    }
    platform::focus_terminal(&pids)
}

/// The ↗ on the live diff card: one edited file, opened in VS Code.
///
/// The path comes from a hook payload, so it gets the same care as a folder: an
/// existing file, by its full path, handed over as a separate argument. `-g`
/// goes first so a file name that starts with `-` is still just a name.
#[tauri::command]
fn open_file_in_vscode(path: String) -> bool {
    let p = std::path::Path::new(&path);
    if !(p.is_absolute() && p.is_file()) {
        return false;
    }
    let Some(code) = platform::find_on_path("code") else { return false };
    let mut cmd = Command::new(code);
    cmd.arg("-g").arg(&path);
    platform::no_console(&mut cmd).spawn().is_ok()
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// The page resolved its interface language: the tray menu follows it.
#[tauri::command]
fn set_ui_language(app: AppHandle, lang: String) {
    tray::set_language(&app, &lang);
}

/// Tray → Pause. Paused means paused: the pollers stop talking to the network,
/// not just the island stopping showing things.
#[tauri::command]
fn set_paused(paused: bool) {
    integrations::set_paused(paused);
}

// ── Claude Code hooks ─────────────────────────────────────────────────────────

#[tauri::command]
fn hooks_status() -> HookStatus {
    hooks::status()
}

/// Returns the diff the user has to look at before anything is written.
#[tauri::command]
fn hooks_preview(install: bool) -> Result<HookPreview, String> {
    hooks::preview(install)
}

/// Only ever called from an explicit click in the settings window.
#[tauri::command]
fn hooks_apply(
    app: AppHandle,
    shared: State<Shared>,
    install: bool,
    fingerprint: String,
) -> Result<String, String> {
    // The fingerprint comes from the preview the user actually looked at, so a
    // settings.json that changed in between is refused rather than overwritten.
    let backup = hooks::write(install, &fingerprint)?;
    let updated = {
        let mut current = shared.settings.lock().unwrap();
        current.hooks_installed = install;
        let _ = settings::save(&current);
        current.clone()
    };
    let _ = app.emit("settings-changed", updated);
    Ok(backup)
}

// ── "Always allow" rules ──────────────────────────────────────────────────────

#[tauri::command]
fn rules_list(rules: State<rules::Rules>) -> Vec<rules::Rule> {
    rules.list()
}

/// Only ever called from the "Always" button on a permission card.
#[tauri::command]
fn rules_add(
    app: AppHandle,
    rules: State<rules::Rules>,
    project: String,
    tool: String,
    pattern: String,
    label: String,
) -> Result<rules::Rule, String> {
    let rule = rules.add(project, tool, pattern, label)?;
    log::line(format!("always-allow rule added: {} · {}", rule.tool, rule.label));
    let _ = app.emit("rules-changed", rules.list());
    Ok(rule)
}

#[tauri::command]
fn rules_remove(app: AppHandle, rules: State<rules::Rules>, id: String) -> Result<(), String> {
    rules.remove(&id)?;
    log::line(format!("always-allow rule removed: {id}"));
    let _ = app.emit("rules-changed", rules.list());
    Ok(())
}

// ── Other agents: Gemini CLI, OpenCode, your terminal ─────────────────────────

#[tauri::command]
fn agents_status() -> Vec<agents::AgentStatus> {
    agents::status()
}

/// The diff to look at before anything is written. `install: false` previews removal.
#[tauri::command]
fn agents_preview(id: String, install: bool) -> Result<HookPreview, String> {
    agents::preview(&id, install)
}

/// Only ever called from an explicit click in the settings window.
#[tauri::command]
fn agents_apply(app: AppHandle, id: String, install: bool, fingerprint: String) -> Result<String, String> {
    let backup = agents::write(&id, install, &fingerprint)?;
    log::line(format!("agent {id} {}", if install { "connected" } else { "disconnected" }));
    let _ = app.emit("agents-changed", ());
    Ok(backup)
}

/// Same flow for the plan usage relay (statusLine): diff first, write on a click.
#[tauri::command]
fn statusline_preview(install: bool) -> Result<HookPreview, String> {
    hooks::preview_statusline(install)
}

#[tauri::command]
fn statusline_apply(app: AppHandle, install: bool, fingerprint: String) -> Result<String, String> {
    let backup = hooks::write_statusline(install, &fingerprint)?;
    let _ = app.emit("hooks-changed", ());
    Ok(backup)
}

/// The person's answer to a question from Claude, or `ask` for "reply in the
/// terminal". See pipe::answer_question for what is accepted.
#[tauri::command]
fn question_answer(app: AppHandle, request_id: String, reply: String) {
    pipe::answer_question(&app, &request_id, &reply);
}

#[tauri::command]
fn approval_decision(app: AppHandle, request_id: String, decision: String) {
    pipe::answer(&app, &request_id, &decision);
}

/// The island has the card on screen, so the long wait for a human may begin.
/// Until this arrives the relay only waits a few hundred milliseconds, which is
/// what stops a paused or unresponsive island from freezing Claude Code.
#[tauri::command]
fn approval_ack(app: AppHandle, request_id: String) {
    pipe::acknowledge(&app, &request_id);
}

/// Nobody can act on this request — the island is paused, or another card is
/// already up. Claude Code falls back to asking in the terminal immediately.
#[tauri::command]
fn approval_decline(app: AppHandle, request_id: String) {
    pipe::decline(&app, &request_id);
}

// ── Chat, files and secrets ───────────────────────────────────────────────────

/// One chat turn. The API key and any file bytes stay on the Rust side.
#[tauri::command]
async fn chat_send(
    shared: State<'_, Shared>,
    chat: State<'_, Chat>,
    devmark_chat: State<'_, devmark::DevmarkChat>,
    compat_chat: State<'_, compat::CompatChat>,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let (provider, model, dm_model, dm_tokens, gemini_model, groq_model) = {
        let s = shared.settings.lock().unwrap();
        (
            s.chat_provider.clone(),
            s.model.clone(),
            s.devmark_model.clone(),
            s.devmark_max_tokens,
            s.gemini_model.clone(),
            s.groq_model.clone(),
        )
    };
    match provider.as_str() {
        "devmark" => devmark::send(&devmark_chat, &dm_model, dm_tokens, query, context).await,
        "gemini" => compat::send(&compat_chat, &compat::GEMINI, &gemini_model, query, context).await,
        "groq" => compat::send(&compat_chat, &compat::GROQ, &groq_model, query, context).await,
        _ => claude::send(&chat, &model, query, context).await,
    }
}

/// Starts the conversation over, whoever answers it.
#[tauri::command]
fn chat_reset(
    chat: State<Chat>,
    devmark_chat: State<devmark::DevmarkChat>,
    compat_chat: State<compat::CompatChat>,
) {
    chat.reset();
    devmark_chat.reset();
    compat_chat.reset();
}

/// Settings → Chat provider → "Test connection": no text is generated.
#[tauri::command]
async fn provider_test(id: String) -> devmark::Check {
    match id.as_str() {
        "devmark" => devmark::check().await,
        other => match compat::provider(other) {
            Some(p) => compat::check(p).await,
            None => devmark::Check { ok: false, message: format!("proveedor desconocido: {other}") },
        },
    }
}

/// Copies a dropped file into the inbox and reports its name back.
#[tauri::command]
fn ingest_file(path: String) -> Result<DroppedFile, String> {
    files::ingest(&path)
}

/// The island may only ask whether a key exists — never read it.
#[tauri::command]
fn secret_present(key: String) -> bool {
    secrets::present(&key)
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    secrets::set(&key, &value)
}

#[tauri::command]
fn secret_clear(key: String) -> Result<(), String> {
    secrets::clear(&key)
}


/// Refresh buttons in the integration cards.
#[tauri::command]
async fn refresh_integration(app: AppHandle, id: String) {
    integrations::poll_once(app, &id).await;
}

/// Lets the island write to the same log as the Rust side.
#[tauri::command]
fn log_line(message: String) {
    log::line(format!("ui  {message}"));
}

// ── Settings window ───────────────────────────────────────────────────────────

/// WebView2 allows exactly one browser environment per app, and its options are
/// fixed by whichever webview is created first. Every window must therefore ask
/// for the *same* arguments as the island (see `additionalBrowserArgs` in
/// tauri.conf.json) — a mismatch makes the second window come up blank, with no
/// error anywhere.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// In a dev build the pages are served by Vite, so the second window needs the
/// absolute dev URL; a bundled build resolves it inside the app bundle.
fn settings_page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/settings.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("settings.html".into())
}

/// The settings window is created hidden at launch and only ever shown and
/// hidden afterwards. A WebView2 window created later — on the main thread or
/// not — silently comes up blank in this app, so the window that works is the
/// one that exists before the island's webview does.
fn create_settings_window(app: &AppHandle) {
    let url = settings_page_url(app);
    match WebviewWindowBuilder::new(app, "settings", url)
        .additional_browser_args(BROWSER_ARGS)
        .title("Ajustes — Coucou")
        .inner_size(560.0, 680.0)
        .min_inner_size(460.0, 480.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
    {
        Ok(win) => {
            // Closing it must only hide it, or it could never be reopened.
            let hidden = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.hide();
                }
            });
        }
        Err(err) => log::line(format!("settings window failed: {err}")),
    }
}

pub fn show_settings_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        log::line("settings window missing");
        return;
    };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

pub fn run() {
    platform::prepare_environment();
    let loaded = settings::load();
    let gate = Arc::new(PollGate::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = app.emit_to(island::WINDOW_LABEL, "tray", "open".to_string());
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let name = if shortcut == &allow_shortcut() {
                        "allow"
                    } else if shortcut == &deny_shortcut() {
                        "deny"
                    } else if shortcut == &toggle_shortcut(app) {
                        "toggle"
                    } else {
                        return;
                    };
                    let _ = app.emit_to(island::WINDOW_LABEL, "shortcut", name);
                })
                .build(),
        )
        .manage(Shared {
            settings: Mutex::new(loaded.clone()),
            gate: gate.clone(),
        })
        .manage(Pending::default())
        .manage(rules::load())
        .manage(Chat::default())
        .manage(devmark::DevmarkChat::default())
        .manage(compat::CompatChat::default())
        .invoke_handler(tauri::generate_handler![
            boot,
            detect_tools,
            claude_projects,
            vscode_projects,
            save_settings,
            set_collapsed,
            set_island_rect,
            focus_window,
            reposition,
            open_url,
            open_in_vscode,
            launch_agent,
            open_agent_app,
            open_file_in_vscode,
            focus_terminal,
            quit_app,
            hooks_status,
            hooks_preview,
            hooks_apply,
            set_decision_shortcuts,
            notify,
            rules_list,
            rules_add,
            rules_remove,
            agents_status,
            agents_preview,
            agents_apply,
            statusline_preview,
            statusline_apply,
            question_answer,
            approval_decision,
            approval_ack,
            approval_decline,
            log_line,
            chat_send,
            chat_reset,
            provider_test,
            ingest_file,
            secret_present,
            secret_set,
            secret_clear,
            refresh_integration,
            open_settings_window,
            set_paused,
            set_ui_language,
            set_toggle_shortcut,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tray::build(&handle)?;
            // Before the island: see create_settings_window.
            create_settings_window(&handle);

            if let Some(win) = island::window(&handle) {
                platform::make_non_activating(&win);
                island::apply_geometry(&handle, &loaded.screen, false);
                let _ = win.show();
            }
            gate.collapsed.store(false, Ordering::Relaxed);
            // Nothing drawn yet, so nothing takes the mouse until the page
            // reports the island's shape.
            if !platform::CURSOR_POLL {
                island::refresh_click_through(&handle, &gate);
            }
            gate.set_active(true);
            island::spawn_cursor_poll(handle.clone(), gate.clone());

            log::line(format!("--- Coucou {} started ---", env!("CARGO_PKG_VERSION")));
            hooks::ensure_hook_exe(&handle);
            apply_shortcut_setting(&handle, loaded.global_shortcuts);
            pipe::start(handle.clone());
            integrations::start(handle.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Coucou");
}

#[cfg(test)]
mod shortcut_tests {
    use super::*;

    #[test]
    fn the_open_shortcut_takes_one_or_two_keys_but_never_a_bare_letter() {
        assert!(parse_toggle("Ctrl+Alt+C").is_ok());
        assert!(parse_toggle("F8").is_ok());
        assert!(parse_toggle("Ctrl+Space").is_ok());
        assert!(parse_toggle("Alt+Shift+1").is_ok());
        assert!(parse_toggle("C").is_err(), "a bare letter would break typing everywhere");
        assert!(parse_toggle("Space").is_err());
        assert!(parse_toggle("nonsense+++").is_err());
        assert!(parse_toggle(&settings::default_toggle_shortcut()).is_ok());
    }
}
