// Windows: Win32 for the island window and the cursor, %APPDATA% for files.

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, Manager, WebviewWindow};

use ::windows::core::{BOOL, PWSTR};
use ::windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, HWND, LPARAM, LocalFree, POINT};
use ::windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use ::windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
use ::windows::Win32::System::Ole::RevokeDragDrop;
use ::windows::Win32::System::SystemInformation::GetLocalTime;
use ::windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, GetAsyncKeyState, KEYEVENTF_KEYUP, VK_LBUTTON, VK_MENU,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, EnumWindows, GetClassNameW, GetCursorPos, GetWindow, GetWindowLongPtrW,
    GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
    SetWindowLongPtrW, ShowWindow, GWL_EXSTYLE, GW_OWNER, SW_RESTORE, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW,
};

use super::LocalTime;
use crate::island::WINDOW_LABEL;

/// File name of the Claude Code relay.
pub const HOOK_EXE: &str = "coucou-hook.exe";

/// Environment variable holding the home directory.
pub const HOME_VAR: &str = "USERPROFILE";

/// Keeps spawned helpers from flashing a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ── Files ─────────────────────────────────────────────────────────────────────

/// Where VS Code remembers its windows and workspaces.
pub fn vscode_storage_path() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    base.join("Code").join("User").join("globalStorage").join("storage.json")
}

/// %APPDATA%\Coucou — preferences.
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Coucou")
}

/// %LOCALAPPDATA%\Coucou — where coucou-hook.exe, the inbox and the log live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Coucou")
}

/// %APPDATA% and %LOCALAPPDATA% are already private to the user.
pub fn ensure_private_dir(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

/// Nothing to set up before the webview starts.
pub fn prepare_environment() {}

pub fn local_time() -> LocalTime {
    let t = unsafe { GetLocalTime() };
    LocalTime {
        year: t.wYear.into(),
        month: t.wMonth.into(),
        day: t.wDay.into(),
        hour: t.wHour.into(),
        minute: t.wMinute.into(),
        second: t.wSecond.into(),
    }
}

// ── Processes ─────────────────────────────────────────────────────────────────

/// Spawned helpers must never flash a console window.
pub fn no_console(cmd: &mut Command) -> &mut Command {
    cmd.creation_flags(CREATE_NO_WINDOW)
}

pub fn open_url(url: &str) {
    let _ = no_console(Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url]))
        .spawn();
}

pub fn reveal_folder(path: &str) {
    let _ = Command::new("explorer").arg(path).spawn();
}

/// Our own `where`: walks %PATH% against %PATHEXT%, no shell involved.
/// Rust quotes arguments correctly for `.cmd`/`.bat` targets since 1.77, so
/// spawning `code.cmd` directly is safe.
pub fn find_on_path(stem: &str) -> Option<PathBuf> {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let dirs = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&dirs) {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{stem}{}", ext.to_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

// ── Who is at the keyboard ────────────────────────────────────────────────────

/// The account's display name ("Jaime Tarazona"), as Windows shows it on the
/// sign-in screen. None when the account has no full name set.
pub fn display_name() -> Option<String> {
    use ::windows::Win32::Security::Authentication::Identity::{GetUserNameExW, NameDisplay};
    unsafe {
        // The first call only reports how many characters are needed.
        let mut size = 0u32;
        let _ = GetUserNameExW(NameDisplay, None, &mut size);
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u16; size as usize];
        if !GetUserNameExW(NameDisplay, Some(PWSTR(buf.as_mut_ptr())), &mut size) {
            return None;
        }
        // On success `size` is the length without the terminating null.
        let name = String::from_utf16_lossy(&buf[..(size as usize).min(buf.len())]);
        (!name.trim().is_empty()).then_some(name)
    }
}

// ── Terminal windows ──────────────────────────────────────────────────────────

/// Brings forward the window of the terminal a Claude Code session runs in.
///
/// `pids` is the session's process chain, nearest first (coucou-hook walks it).
/// The nearest process that owns a real top-level window is the terminal host —
/// Windows Terminal, VS Code, a classic console — because the shells and
/// OpenConsole.exe in between have none. Going further up would end at
/// explorer.exe, which owns every folder window, so the walk stops at the first
/// hit. Several windows of the same host cannot be told apart: the top one wins.
pub fn focus_terminal(pids: &[u32]) -> bool {
    struct Search<'a> {
        pids: &'a [u32],
        best: Option<(usize, HWND)>,
    }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = unsafe { &mut *(lparam.0 as *mut Search) };
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() {
                return true.into();
            }
            // Owned windows (dialogs, popups) and tool windows are not the terminal.
            if GetWindow(hwnd, GW_OWNER).map(|w| !w.0.is_null()).unwrap_or(false) {
                return true.into();
            }
            if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW.0 as isize != 0 {
                return true.into();
            }
            if GetWindowTextLengthW(hwnd) == 0 {
                return true.into();
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if let Some(rank) = search.pids.iter().position(|p| *p == pid) {
                // EnumWindows runs top of the z-order first, so on a tie the
                // first window seen is kept.
                if search.best.map(|(r, _)| rank < r).unwrap_or(true) {
                    search.best = Some((rank, hwnd));
                }
            }
        }
        true.into()
    }

    let mut search = Search { pids, best: None };
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
    }
    let Some((_, hwnd)) = search.best else { return false };

    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        // Windows only lets the process that last received input take the
        // foreground. A tap on Alt makes ours count as that one.
        keybd_event(VK_MENU.0 as u8, 0, Default::default(), 0);
        let ok = SetForegroundWindow(hwnd).as_bool();
        keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        ok
    }
}

// ── Who we are ────────────────────────────────────────────────────────────────
//
// Named pipes share one machine-wide namespace, so the SID in the name is what
// keeps two accounts on the same machine from ever meeting on `coucou-*`.
// coucou-hook computes the same string (hook/src/win.rs) and additionally checks
// that the process serving the pipe really is us.

/// The SID of the account this process runs as, as `S-1-5-21-…`.
pub fn current_user_sid() -> Option<String> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).ok()?;

        // First call sizes the buffer, second fills it.
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
        if needed == 0 {
            let _ = CloseHandle(token);
            return None;
        }
        let mut buf = vec![0u8; needed as usize];
        let ok = GetTokenInformation(
            token,
            TokenUser,
            Some(buf.as_mut_ptr().cast()),
            needed,
            &mut needed,
        )
        .is_ok();
        let _ = CloseHandle(token);
        if !ok {
            return None;
        }

        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut text = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text).ok()?;
        let sid = text.to_string().ok();
        let _ = LocalFree(Some(HLOCAL(text.0 as *mut _)));
        sid
    }
}

// ── Cursor ────────────────────────────────────────────────────────────────────

/// The 60 Hz poll reads the cursor and flips click-through from it.
pub const CURSOR_POLL: bool = true;

/// Cursor position in physical screen pixels.
// ── What the person is doing (modes.rs) ───────────────────────────────────────

/// The names of the subkeys of `HKCU\<path>`.
fn reg_subkeys(path: &str) -> Vec<String> {
    use ::windows::core::PCWSTR;
    use ::windows::Win32::System::Registry::{RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ};
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut key = HKEY::default();
    let mut out = Vec::new();
    unsafe {
        if RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(wide.as_ptr()), None, KEY_READ, &mut key).is_err() {
            return out;
        }
        for index in 0.. {
            let mut name = [0u16; 512];
            let mut len = name.len() as u32;
            let status = RegEnumKeyExW(key, index, Some(::windows::core::PWSTR(name.as_mut_ptr())), &mut len, None, None, None, None);
            if status.is_err() {
                break;
            }
            out.push(String::from_utf16_lossy(&name[..len as usize]));
        }
        let _ = RegCloseKey(key);
    }
    out
}

/// A numeric value (QWORD or DWORD) of `HKCU\<path>`.
fn reg_number(path: &str, name: &str) -> Option<u64> {
    use ::windows::core::PCWSTR;
    use ::windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_VALUE_TYPE,
    };
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let value: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut key = HKEY::default();
    unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(wide.as_ptr()), None, KEY_READ, &mut key).ok().ok()?;
        let mut kind = REG_VALUE_TYPE(0);
        let mut data = [0u8; 8];
        let mut size = data.len() as u32;
        let status = RegQueryValueExW(key, PCWSTR(value.as_ptr()), None, Some(&mut kind), Some(data.as_mut_ptr()), Some(&mut size));
        let _ = RegCloseKey(key);
        status.ok().ok()?;
        match size {
            8 => Some(u64::from_le_bytes(data)),
            4 => Some(u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as u64),
            _ => None,
        }
    }
}

/// A text value of `HKCU\<path>`.
fn reg_text(path: &str, name: &str) -> Option<String> {
    use ::windows::core::PCWSTR;
    use ::windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
    };
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let value: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut key = HKEY::default();
    unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(wide.as_ptr()), None, KEY_READ, &mut key).ok().ok()?;
        let mut data = [0u8; 1024];
        let mut size = data.len() as u32;
        let status = RegQueryValueExW(key, PCWSTR(value.as_ptr()), None, None, Some(data.as_mut_ptr()), Some(&mut size));
        let _ = RegCloseKey(key);
        status.ok().ok()?;
        let units: Vec<u16> = data[..size as usize].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        let text = String::from_utf16_lossy(&units);
        let text = text.trim_end_matches('\0').trim().to_string();
        (!text.is_empty()).then_some(text)
    }
}

/// The file names (lowercase) of the running programs.
fn running_programs() -> Vec<String> {
    use ::windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut out = Vec::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                out.push(String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase());
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    out
}

/// The Steam game running now, by name: Steam keeps its id in the registry.
fn steam_game() -> Option<String> {
    let id = reg_number("Software\\Valve\\Steam", "RunningAppID").filter(|id| *id != 0)?;
    reg_text(&format!("Software\\Valve\\Steam\\Apps\\{id}"), "Name").or_else(|| Some("un juego de Steam".into()))
}

/// Is another program using the microphone or the camera right now? Windows
/// keeps, for each program, when it started and stopped using them: started and
/// not stopped means in use. Our own program (its listening for "Oye Mochi") does not count.
fn camera_or_microphone_in_use() -> bool {
    for device in ["microphone", "webcam"] {
        let base = format!("Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\{device}");
        let mut keys: Vec<String> = reg_subkeys(&base).into_iter().filter(|k| k != "NonPackaged").map(|k| format!("{base}\\{k}")).collect();
        keys.extend(reg_subkeys(&format!("{base}\\NonPackaged")).into_iter().map(|k| format!("{base}\\NonPackaged\\{k}")));
        for key in keys {
            if key.to_lowercase().contains("coucou") {
                continue;
            }
            let started = reg_number(&key, "LastUsedTimeStart").unwrap_or(0);
            let stopped = reg_number(&key, "LastUsedTimeStop").unwrap_or(1);
            if started > 0 && stopped == 0 {
                return true;
            }
        }
    }
    false
}

/// Everything modes.rs decides from. `extra_games` are the programs the person listed.
pub fn signals(extra_games: &[String]) -> super::Signals {
    use ::windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
    let state = unsafe { SHQueryUserNotificationState() }.ok();
    let programs = running_programs();
    let game = programs
        .iter()
        .find_map(|p| crate::modes::known_game(p, extra_games))
        .or_else(steam_game);
    super::Signals {
        fullscreen: state.map(|s| s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN).unwrap_or(false),
        presentation: state.map(|s| s == QUNS_PRESENTATION_MODE).unwrap_or(false),
        game,
        call: camera_or_microphone_in_use(),
    }
}

/// True when the person should not be interrupted: a full-screen game or video,
/// a presentation, or Windows' own "busy" state (Focus assist).
pub fn user_is_busy() -> bool {
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    unsafe { SHQueryUserNotificationState() }
        .map(|s| s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE)
        .unwrap_or(false)
}

/// What the system media controls (the same ones the volume flyout shows —
/// Spotify, the browser, the media player…) say is playing. Blocks for a few
/// milliseconds: call it from a worker thread.
pub fn now_playing() -> Option<super::NowPlaying> {
    // WinRT needs COM on the calling thread, and the threads this runs on (a
    // blocking pool, a test) have not started it: use a thread of its own.
    std::thread::spawn(|| {
        use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
        let started = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
        let found = media_session();
        if started {
            unsafe { CoUninitialize() };
        }
        found
    })
    .join()
    .ok()
    .flatten()
}

/// Apps that show up as a media session while a message, a call or a ringtone plays.
fn is_not_music(app: &str) -> bool {
    let app = app.to_lowercase();
    ["whatsapp", "telegram", "teams", "zoom", "skype", "discord", "slack", "signal", "viber", "webex", "messenger"]
        .iter()
        .any(|w| app.contains(w))
}

fn media_session() -> Option<super::NowPlaying> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    let manager = Manager::RequestAsync().ok()?.get().ok()?;
    let session = manager.GetCurrentSession().ok()?;
    let playing = session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()? == Status::Playing;
    let (title, artist) = session
        .TryGetMediaPropertiesAsync()
        .ok()
        .and_then(|op| op.get().ok())
        .map(|p| {
            (
                p.Title().map(|t| t.to_string()).unwrap_or_default(),
                p.Artist().map(|t| t.to_string()).unwrap_or_default(),
            )
        })
        .unwrap_or_default();
    let app = session.SourceAppUserModelId().map(|t| t.to_string()).unwrap_or_default();
    // A chat or call app reports "playing" for a voice note or a ring: not music.
    let playing = playing && !is_not_music(&app);
    Some(super::NowPlaying { playing, title, artist, app })
}

pub fn cursor_physical() -> Option<(f64, f64)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

/// True while the left mouse button is held — the only signal we get that a
/// drag might be in flight before it reaches the window.
pub fn left_button_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

// ── Island window ─────────────────────────────────────────────────────────────

fn hwnd_of(win: &WebviewWindow) -> Option<HWND> {
    let raw = win.hwnd().ok()?.0 as isize;
    if raw == 0 {
        return None;
    }
    Some(HWND(raw as *mut _))
}

/// Lets dropped files reach the app again.
///
/// wry installs its drop target by walking the webview's child windows **once**,
/// when the webview is created. WebView2 creates `Chrome_RenderWidgetHostHWND`
/// later and registers its own target on it; being the innermost window, that one
/// wins, and since the page has no HTML5 drop handler it refuses everything — the
/// "no drop" cursor, with nothing reaching Tauri. Revoking it makes OLE fall
/// through to the target wry registered on the parent widget, which is the one
/// that feeds Tauri's drag events.
///
/// Cheap and idempotent, so it is simply re-run whenever a drag might be starting.
pub fn unblock_webview_drops(app: &AppHandle) {
    for label in [WINDOW_LABEL, "settings"] {
        let Some(win) = app.get_webview_window(label) else { continue };
        let Some(hwnd) = hwnd_of(&win) else { continue };
        unsafe {
            let _ = EnumChildWindows(Some(hwnd), Some(revoke_render_widget), LPARAM(0));
        }
    }
}

unsafe extern "system" fn revoke_render_widget(hwnd: HWND, _: LPARAM) -> BOOL {
    let mut name = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, &mut name) };
    if len > 0 {
        let class = String::from_utf16_lossy(&name[..len as usize]);
        if class == "Chrome_RenderWidgetHostHWND" {
            let _ = unsafe { RevokeDragDrop(hwnd) };
        }
    }
    true.into()
}

/// WS_EX_NOACTIVATE keeps clicks from stealing focus; WS_EX_TOOLWINDOW keeps the
/// island out of Alt-Tab.
pub fn make_non_activating(win: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Temporarily allow activation so a text field inside the island can be typed in.
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = if activating {
            ex & !(WS_EX_NOACTIVATE.0 as isize)
        } else {
            ex | WS_EX_NOACTIVATE.0 as isize
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Click-through here is the poll's WS_EX_TRANSPARENT toggle, not a region.
pub fn set_input_region(_win: &WebviewWindow, _rect: Option<(f64, f64, f64, f64)>) {}

#[cfg(test)]
mod now_playing_tests {
    /// Asks the real system media controls. Prints what it finds (nothing playing is a
    /// valid answer); it only fails if the call itself breaks.
    /// `cargo test now_playing_smoke -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn now_playing_smoke() {
        println!("{:?}", super::now_playing());
    }
}

#[cfg(test)]
mod signals_tests {
    /// Asks the real system. Prints what it finds; it only fails if the calls themselves break.
    /// `cargo test signals_smoke -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn signals_smoke() {
        println!("{:?}", super::signals(&[]));
        println!("steam: {:?}", super::steam_game());
        println!("programs: {}", super::running_programs().len());
    }
}

#[cfg(test)]
mod not_music_tests {
    #[test]
    fn chat_and_call_apps_are_not_music() {
        assert!(super::is_not_music("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"));
        assert!(super::is_not_music("MSTeams_8wekyb3d8bbwe!MSTeams"));
        assert!(!super::is_not_music("Spotify.exe"));
        assert!(!super::is_not_music("chrome.exe"));
    }
}
