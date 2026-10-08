// macOS: ~/Library/Application Support for files, `open` for links and folders,
// a Unix socket in the per-user temporary directory for the relay, and the same
// cursor-polling click-through as Windows (the cursor comes from Core Graphics).
//
// This port is built and tested by CI on a Mac (.github/workflows/macos.yml) but
// has not been run on real hardware by its author: expect rough edges around the
// island's window (the notch, spaces, full-screen apps).

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use core_graphics::display::CGDisplay;
use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use tauri::{AppHandle, WebviewWindow};

use super::{home_dir, LocalTime};

/// File name of the Claude Code relay.
pub const HOOK_EXE: &str = "coucou-hook";

/// Environment variable holding the home directory.
pub const HOME_VAR: &str = "HOME";

// ── Files ─────────────────────────────────────────────────────────────────────

/// ~/Library/Application Support/Coucou — preferences, the relay, the log.
pub fn config_dir() -> PathBuf {
    home_dir().join("Library").join("Application Support").join("Coucou")
}

pub fn local_dir() -> PathBuf {
    config_dir()
}

/// Nothing to prepare before the webview starts.
pub fn prepare_environment() {}

pub fn local_time() -> LocalTime {
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe {
        let now = libc::time(std::ptr::null_mut());
        libc::localtime_r(&now, &mut tm);
    }
    LocalTime {
        year: (tm.tm_year + 1900) as u32,
        month: (tm.tm_mon + 1) as u32,
        day: tm.tm_mday as u32,
        hour: tm.tm_hour as u32,
        minute: tm.tm_min as u32,
        second: tm.tm_sec as u32,
    }
}

/// Creates `dir` and closes it to other users.
pub fn ensure_private_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
}

/// A real directory (not a symlink), owned by us, with no access for group or others.
fn is_private_dir(dir: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    std::fs::symlink_metadata(dir)
        .map(|m| m.file_type().is_dir() && m.uid() == unsafe { libc::getuid() } && m.mode() & 0o077 == 0)
        .unwrap_or(false)
}

/// Where coucou-hook finds us: `$TMPDIR/coucou.sock`. macOS gives each user a
/// private temporary directory (`/var/folders/…/T/`); one that is not ours and
/// closed to others means no relay at all. Must match `socket_path()` in
/// hook/src/unix.rs exactly.
pub fn relay_socket_path() -> Option<PathBuf> {
    let dir = std::env::var_os("TMPDIR").map(PathBuf::from).filter(|p| p.is_absolute())?;
    is_private_dir(&dir).then(|| dir.join("coucou.sock"))
}

// ── Processes ─────────────────────────────────────────────────────────────────

/// Nothing to hide: a spawned process only gets a terminal if it asks for one.
pub fn no_console(cmd: &mut Command) -> &mut Command {
    cmd
}

pub fn open_url(url: &str) {
    let _ = Command::new("open").arg(url).spawn();
}

/// Shows the folder in Finder.
pub fn reveal_folder(path: &str) {
    let _ = Command::new("open").arg(path).spawn();
}

/// Where VS Code remembers its windows and workspaces.
pub fn vscode_storage_path() -> PathBuf {
    home_dir()
        .join("Library")
        .join("Application Support")
        .join("Code")
        .join("User")
        .join("globalStorage")
        .join("storage.json")
}

/// The account's full name from the passwd entry ("Jaime Tarazona").
pub fn display_name() -> Option<String> {
    use std::ffi::CStr;
    unsafe {
        let pw = libc::getpwuid(libc::getuid());
        if pw.is_null() || (*pw).pw_gecos.is_null() {
            return None;
        }
        let gecos = CStr::from_ptr((*pw).pw_gecos).to_string_lossy().to_string();
        let name = gecos.split(',').next().unwrap_or("").trim().to_string();
        (!name.is_empty()).then_some(name)
    }
}

/// Raising another app's window needs accessibility permission: the island falls
/// back to opening the folder in VS Code.
pub fn focus_terminal(_pids: &[u32]) -> bool {
    false
}

/// Folders where the tools Coucou starts usually live. A Dock-launched app does
/// not inherit the shell's PATH, so `claude` or `code` would never be found.
fn extra_bin_dirs() -> Vec<PathBuf> {
    let home = home_dir();
    vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join(".local").join("bin"),
        home.join(".npm-global").join("bin"),
        home.join(".claude").join("local"),
        home.join(".bun").join("bin"),
        PathBuf::from("/Applications/Visual Studio Code.app/Contents/Resources/app/bin"),
    ]
}

/// The first executable file named `stem` on $PATH or in the usual tool folders.
pub fn find_on_path(stem: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    dirs.extend(extra_bin_dirs());
    dirs.into_iter().map(|dir| dir.join(stem)).find(|p| {
        std::fs::metadata(p)
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    })
}

// ── Cursor ────────────────────────────────────────────────────────────────────

/// The 60 Hz poll reads the cursor and flips click-through from it.
pub const CURSOR_POLL: bool = true;

/// Physical pixels per point on the main display (2.0 on Retina).
fn main_scale() -> f64 {
    let d = CGDisplay::main();
    let points = d.bounds().size.width;
    if points > 0.0 {
        d.pixels_wide() as f64 / points
    } else {
        1.0
    }
}

/// Lists the on-screen windows and the screens, as text, through JXA (the ObjC bridge):
/// no extra permission is needed for owner names and sizes, and nothing is linked.
const WINDOWS_JXA: &str = r#"ObjC.import('CoreGraphics');ObjC.import('AppKit');
var o=[],n=$.NSScreen.screens.count;
for(var i=0;i<n;i++){var f=$.NSScreen.screens.objectAtIndex(i).frame;o.push('S|'+Math.round(f.size.width)+'|'+Math.round(f.size.height));}
var l=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(17,0)));
for(var j=0;j<l.length;j++){var w=l[j],b=w.kCGWindowBounds||{};o.push('W|'+(w.kCGWindowOwnerName||'')+'|'+w.kCGWindowLayer+'|'+Math.round(b.Width)+'|'+Math.round(b.Height));}
o.join('\n')"#;

/// The owner of a normal window as big as a whole screen (a full-screen app or game).
fn fullscreen_owner(text: &str) -> Option<String> {
    let screens: Vec<(&str, &str)> = text
        .lines()
        .filter_map(|l| l.strip_prefix("S|"))
        .filter_map(|l| l.split_once('|'))
        .collect();
    text.lines().filter_map(|l| l.strip_prefix("W|")).find_map(|l| {
        let p: Vec<&str> = l.split('|').collect();
        let [owner, layer, w, h] = p[..] else { return None };
        let system = ["Finder", "Dock", "Window Server", "Coucou", "Coucou v2", "SystemUIServer", "Control Center"];
        (layer == "0" && !system.contains(&owner) && screens.iter().any(|&(sw, sh)| sw == w && sh == h))
            .then(|| owner.to_string())
    })
}

/// Games that run on a Mac, by the name of the process (lower case).
const MAC_GAMES: &[(&str, &str)] = &[
    ("dota2", "Dota 2"),
    ("cs2", "Counter-Strike 2"),
    ("minecraft", "Minecraft"),
    ("world of warcraft", "World of Warcraft"),
    ("hearthstone", "Hearthstone"),
    ("league of legends", "League of Legends"),
    ("civilization vi", "Civilization VI"),
    ("stardew valley", "Stardew Valley"),
];

fn run_text(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd).args(args).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}

/// What the Mac says the person is doing. Any failure reads as "nothing special", so a
/// problem here can only mean the island stays as it was.
/// ponytail: a Zoom call (its CptHost helper) is the one call told apart; the rest of the
/// meetings are chosen by hand. Spawns two small processes every 2 s.
pub fn signals(extra_games: &[String]) -> super::Signals {
    let windows = run_text("osascript", &["-l", "JavaScript", "-e", WINDOWS_JXA]);
    let owner = fullscreen_owner(&windows);
    let processes = run_text("ps", &["-axco", "comm"]).to_lowercase();
    let running = |name: &str| processes.lines().any(|p| p.trim() == name);
    let game = MAC_GAMES
        .iter()
        .find(|(file, _)| running(file))
        .map(|(_, name)| name.to_string())
        .or_else(|| {
            extra_games.iter().map(|e| e.trim().trim_end_matches(".app").to_string()).find(|e| {
                let e = e.to_lowercase();
                !e.is_empty() && running(&e)
            })
        });
    super::Signals { fullscreen: owner.is_some(), presentation: false, game, call: running("cpthost") }
}

/// ponytail: macOS has no cheap "full screen app" test; the pet may peek over a
/// full-screen app. NSApplication.presentationOptions of another app is private.
pub fn user_is_busy() -> bool {
    false
}

/// Music or Spotify, when one of them is open and playing. `osascript` asks
/// only if the app is already running (`is running` never launches it); the first
/// time, macOS asks the person to allow Coucou to control it.
pub fn now_playing() -> Option<super::NowPlaying> {
    for app in ["Music", "Spotify"] {
        let script = format!(
            "if application \"{app}\" is running then tell application \"{app}\" to \
             if player state is playing then return (name of current track) & \"\\n\" & (artist of current track)"
        );
        let out = Command::new("osascript").args(["-e", &script]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if out.status.success() && !text.is_empty() {
            let mut lines = text.lines();
            return Some(super::NowPlaying {
                playing: true,
                title: lines.next().unwrap_or("").to_string(),
                artist: lines.next().unwrap_or("").to_string(),
                app: app.to_string(),
            });
        }
    }
    Some(super::NowPlaying::default())
}

/// Cursor position in physical screen pixels.
pub fn cursor_physical() -> Option<(f64, f64)> {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).ok()?;
    let at = CGEvent::new(source).ok()?.location();
    let scale = main_scale();
    Some((at.x * scale, at.y * scale))
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// core-graphics 0.24 does not wrap this one.
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
}

/// True while the left mouse button is held.
pub fn left_button_down() -> bool {
    // kCGEventSourceStateCombinedSessionState = 0, kCGMouseButtonLeft = 0.
    unsafe { CGEventSourceButtonState(0, 0) }
}

// ── Island window ─────────────────────────────────────────────────────────────

/// WKWebView has no competing drop target to remove.
pub fn unblock_webview_drops(_app: &AppHandle) {}

/// The island must not take focus from the app you are working in. The app
/// itself runs as an "accessory" (no Dock icon, set at startup).
pub fn make_non_activating(win: &WebviewWindow) {
    let _ = win.set_focusable(false);
    let _ = win.set_visible_on_all_workspaces(true);
}

/// Temporarily allow focus so a text field inside the island can be typed in.
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    let _ = win.set_focusable(activating);
}

/// Click-through here is the poll's ignore-cursor toggle, not a region.
pub fn set_input_region(_win: &WebviewWindow, _rect: Option<(f64, f64, f64, f64)>) {}

#[cfg(test)]
mod mode_tests {
    use super::fullscreen_owner;

    #[test]
    fn a_window_as_big_as_a_screen_is_full_screen_unless_it_is_the_desktop() {
        let t = "S|1512|982\nW|Dock|20|1512|982\nW|Finder|0|1512|982\nW|Safari|0|1200|800\nW|Dota 2|0|1512|982";
        assert_eq!(fullscreen_owner(t).as_deref(), Some("Dota 2"));
        assert_eq!(fullscreen_owner("S|1512|982\nW|Safari|0|1200|800"), None);
        assert_eq!(fullscreen_owner(""), None);
    }
}
