// Mochi on the desktop — his own small window, wherever the user dropped him.
// Minimal Windows port: creates a borderless, always-on-top, never-focus window
// that can be moved around and sent back home to the island.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "mochi";
pub const SIZE: f64 = 120.0;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopEvent {
    pub kind: String, // "show" | "hide" | "home" | "moved"
    pub x: f64,
    pub y: f64,
}

/// Create the mochi window (parked off-screen, not visible yet).
pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let win = WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App("mochi.html".into()))
        .title("Mochi")
        .inner_size(SIZE, SIZE)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focus()
        .build()?;
    // Park it off-screen until the user brings it out.
    let _ = win.set_position(tauri::PhysicalPosition::new(-32000, -32000));
    Ok(win)
}

/// Show the window at the given logical position.
pub fn show(app: &AppHandle, x: f64, y: f64) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit("desktop", &DesktopEvent { kind: "show".into(), x, y });
    }
}

/// Hide the window (park off-screen).
pub fn hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.set_position(tauri::PhysicalPosition::new(-32000, -32000));
        let _ = win.hide();
        let _ = app.emit("desktop", &DesktopEvent { kind: "hide".into(), x: 0.0, y: 0.0 });
    }
}

/// Send Mochi back home to the island.
pub fn home(app: &AppHandle) {
    hide(app);
    let _ = app.emit("desktop", &DesktopEvent { kind: "home".into(), x: 0.0, y: 0.0 });
}

/// Move the window to a new position.
pub fn move_to(app: &AppHandle, x: f64, y: f64) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        let _ = app.emit("desktop", &DesktopEvent { kind: "moved".into(), x, y });
    }
}

/// Current position of the mochi window, or None if not visible.
pub fn position(app: &AppHandle) -> Option<(f64, f64)> {
    app.get_webview_window(LABEL).and_then(|win| {
        win.outer_position().ok().map(|p| (p.x as f64, p.y as f64))
    })
}

/// Whether the mochi window exists and is visible.
pub fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_is_120() {
        assert_eq!(SIZE, 120.0);
    }

    #[test]
    fn label_is_mochi() {
        assert_eq!(LABEL, "mochi");
    }
}