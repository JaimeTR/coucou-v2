// Everything that differs between operating systems, behind one set of names.
//
// The rest of the app calls `platform::…` and never touches Win32 or a Linux
// API directly. Each OS file exposes the same functions; the compiler picks one.

use std::path::PathBuf;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use self::linux::*;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use self::macos::*;

/// Wall-clock time in the user's time zone, for log lines and backup names.
pub struct LocalTime {
    pub year: u32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

/// What the computer is playing right now, as far as its media controls say.
/// Read-only and local: nothing is sent anywhere.
#[derive(serde::Serialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub playing: bool,
    pub title: String,
    pub artist: String,
    /// Which program plays it ("Spotify.exe", "chrome.exe", "Music"…), to tell music from video.
    pub app: String,
}

/// What the computer says about what the person is doing (see modes.rs).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Signals {
    /// A full-screen application is in front.
    pub fullscreen: bool,
    /// Windows is in presentation mode.
    pub presentation: bool,
    /// A game is running: its name.
    pub game: Option<String>,
    /// A call: some other program is using the microphone or the camera.
    pub call: bool,
}

/// The user's home directory, where `.claude/settings.json` lives.
pub fn home_dir() -> PathBuf {
    std::env::var_os(HOME_VAR)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
