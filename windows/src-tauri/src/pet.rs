// Mochi the pet: a small transparent window that sits against the left, right
// or bottom edge of the screen's work area (never over the taskbar) for a few
// seconds at a time, while the page inside it (pet.html) does the peeking and
// the mischief. Rust only places it and shows or hides it; the page decides
// when, from the setting and a quiet moment.
//
// The window is created hidden at launch, like the settings window: a WebView2
// window made later can come up blank. While it is hidden it costs nothing.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindowBuilder};

use crate::{island, platform, settings, Shared};

pub const LABEL: &str = "pet";
/// Logical size of the window. Mochi is drawn inside it, sliding in from the edge.
pub const SIZE: f64 = 180.0;

/// The work area of the screen the island lives on, in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Where the window's top-left goes to sit flush against `edge`, `along` (0..1)
/// of the way down (left, right) or across (bottom). None for an unknown edge.
pub fn placement(edge: &str, area: Area, px: i32, along: f64) -> Option<(i32, i32)> {
    let t = if along.is_finite() { along.clamp(0.0, 1.0) } else { 0.5 };
    let across = |room: i32| ((room - px).max(0) as f64 * t).round() as i32;
    match edge {
        "left" => Some((area.x, area.y + across(area.h))),
        "right" => Some((area.x + (area.w - px).max(0), area.y + across(area.h))),
        "bottom" => Some((area.x + across(area.w), area.y + (area.h - px).max(0))),
        _ => None,
    }
}

pub fn create(app: &AppHandle) {
    let builder = WebviewWindowBuilder::new(app, LABEL, crate::page_url(app, "pet.html"))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Mochi")
        .inner_size(SIZE, SIZE)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false);
    match builder.build() {
        Ok(win) => platform::make_non_activating(&win),
        Err(err) => crate::log::line(format!("pet window failed: {err}")),
    }
}

pub fn show(app: &AppHandle, edge: &str, along: f64) -> Result<(), String> {
    let win = app.get_webview_window(LABEL).ok_or("la ventana de Mochi no existe")?;
    let pref = app
        .try_state::<Shared>()
        .map(|s| s.settings.lock().unwrap().screen.clone())
        .unwrap_or_else(|| settings::Settings::default().screen);
    let monitor = island::target_monitor(app, &pref).ok_or("no hay pantalla")?;
    let work = monitor.work_area();
    let px = (SIZE * monitor.scale_factor()).round() as i32;
    let area = Area {
        x: work.position.x,
        y: work.position.y,
        w: work.size.width as i32,
        h: work.size.height as i32,
    };
    let (x, y) = placement(edge, area, px, along).ok_or("borde desconocido")?;
    let _ = win.set_size(PhysicalSize::new(px as u32, px as u32));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_always_on_top(true);
    win.show().map_err(|e| e.to_string())
}

pub fn hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Area = Area { x: 0, y: 0, w: 1920, h: 1040 }; // a 1080 screen with a 40 px taskbar

    #[test]
    fn the_window_sits_flush_against_the_edge_inside_the_work_area() {
        assert_eq!(placement("bottom", WORK, 180, 0.0), Some((0, 860)), "above the taskbar, not behind it");
        assert_eq!(placement("bottom", WORK, 180, 1.0), Some((1740, 860)));
        assert_eq!(placement("right", WORK, 180, 0.5), Some((1740, 430)));
        assert_eq!(placement("left", WORK, 180, 1.0), Some((0, 860)));
    }

    #[test]
    fn a_second_screen_and_a_taskbar_on_the_side_move_the_area_not_the_rule() {
        let second = Area { x: 1920, y: -200, w: 2560, h: 1400 };
        assert_eq!(placement("left", second, 270, 0.0), Some((1920, -200)));
        assert_eq!(placement("right", second, 270, 0.0), Some((1920 + 2560 - 270, -200)));
        let side_taskbar = Area { x: 60, y: 0, w: 1860, h: 1080 }; // taskbar on the left
        assert_eq!(placement("left", side_taskbar, 180, 0.0), Some((60, 0)));
    }

    #[test]
    fn nonsense_never_leaves_the_screen_or_crashes() {
        assert_eq!(placement("top", WORK, 180, 0.5), None);
        assert_eq!(placement("bottom", WORK, 180, 7.0), placement("bottom", WORK, 180, 1.0));
        assert_eq!(placement("bottom", WORK, 180, -3.0), placement("bottom", WORK, 180, 0.0));
        assert_eq!(placement("bottom", WORK, 180, f64::NAN), placement("bottom", WORK, 180, 0.5));
        // A work area smaller than the window pins it to the edge instead of going negative.
        assert_eq!(placement("bottom", Area { x: 0, y: 0, w: 100, h: 100 }, 180, 0.5), Some((0, 0)));
    }
}
