// Mochi the pet: a transparent window that sits against the left, right or
// bottom edge of the screen's work area (never over the taskbar) for a few
// seconds at a time, while the page inside it (pet.html) does the peeking, the
// talking and the mischief. Rust places it, shows and hides it, and while it is
// up watches the pointer: the window lets every click through except on Mochi
// and its speech bubble, so it never blocks what is underneath.
//
// The window is created hidden at launch, like the settings window: a WebView2
// window made later can come up blank. While it is hidden it costs nothing.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindowBuilder};

use crate::{island, platform, settings, Shared};

pub const LABEL: &str = "pet";
/// Logical size of the window: room for Mochi (a 180 px square against the edge)
/// and its speech bubble beside or above it.
pub const WIDTH: f64 = 340.0;
pub const HEIGHT: f64 = 220.0;

/// The work area of the screen the island lives on, in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Where the window's top-left goes to sit flush against `edge`, `along` (0..1)
/// of the way down (left, right) or across (bottom). `w` × `h` is the window in
/// physical pixels. None for an unknown edge.
pub fn placement(edge: &str, area: Area, w: i32, h: i32, along: f64) -> Option<(i32, i32)> {
    let t = if along.is_finite() { along.clamp(0.0, 1.0) } else { 0.5 };
    let across = |room: i32, size: i32| ((room - size).max(0) as f64 * t).round() as i32;
    match edge {
        "left" => Some((area.x, area.y + across(area.h, h))),
        "right" => Some((area.x + (area.w - w).max(0), area.y + across(area.h, h))),
        "bottom" => Some((area.x + across(area.w, w), area.y + (area.h - h).max(0))),
        _ => None,
    }
}

/// Is `(x, y)` inside any of the rectangles `[x, y, w, h]`?
pub fn inside(rects: &[[f64; 4]], x: f64, y: f64) -> bool {
    rects.iter().any(|r| x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3])
}

/// The parts of the window that take the mouse (logical px, window coordinates),
/// pushed by the page: Mochi's body and the speech bubble.
static HIT: Mutex<Vec<[f64; 4]>> = Mutex::new(Vec::new());
/// Bumped at every show and hide, so a watcher from an earlier visit stops.
static VISIT: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone)]
struct Pointer {
    /// In window-logical coordinates; may be outside the window.
    x: f64,
    y: f64,
}

pub fn create(app: &AppHandle) {
    let builder = WebviewWindowBuilder::new(app, LABEL, crate::page_url(app, "pet.html"))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Mochi")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false);
    match builder.build() {
        Ok(win) => {
            platform::make_non_activating(&win);
            // Nothing is hit until the page says where Mochi is.
            let _ = win.set_ignore_cursor_events(true);
        }
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
    let scale = monitor.scale_factor();
    let (w, h) = ((WIDTH * scale).round() as i32, (HEIGHT * scale).round() as i32);
    let area = Area {
        x: work.position.x,
        y: work.position.y,
        w: work.size.width as i32,
        h: work.size.height as i32,
    };
    let (x, y) = placement(edge, area, w, h, along).ok_or("borde desconocido")?;
    HIT.lock().unwrap().clear();
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_size(PhysicalSize::new(w as u32, h as u32));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_always_on_top(true);
    win.show().map_err(|e| e.to_string())?;
    watch(app.clone());
    Ok(())
}

pub fn hide(app: &AppHandle) {
    VISIT.fetch_add(1, Ordering::Relaxed); // stops the watcher
    HIT.lock().unwrap().clear();
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
    }
}

pub fn set_hit(rects: Vec<[f64; 4]>) {
    // A handful at most: Mochi and a bubble. Anything else is nonsense.
    *HIT.lock().unwrap() = rects.into_iter().filter(|r| r.iter().all(|v| v.is_finite())).take(4).collect();
}

/// While the window is up: tells the page where the pointer is (so Mochi's eyes
/// follow it anywhere on the screen) and lets clicks through everywhere but on
/// Mochi and its bubble. Without a global pointer (Linux) the whole window takes
/// the mouse instead.
fn watch(app: AppHandle) {
    let me = VISIT.fetch_add(1, Ordering::Relaxed) + 1;
    if !platform::CURSOR_POLL {
        if let Some(win) = app.get_webview_window(LABEL) {
            let _ = win.set_ignore_cursor_events(false);
        }
        return;
    }
    std::thread::spawn(move || {
        let mut ignoring = true;
        let mut last = (f64::MIN, f64::MIN);
        while VISIT.load(Ordering::Relaxed) == me {
            std::thread::sleep(Duration::from_millis(30));
            let Some(win) = app.get_webview_window(LABEL) else { break };
            let (Some((cx, cy)), Ok(pos), Ok(scale)) = (platform::cursor_physical(), win.outer_position(), win.scale_factor()) else {
                continue;
            };
            let (x, y) = ((cx - pos.x as f64) / scale, (cy - pos.y as f64) / scale);
            let over = inside(&HIT.lock().unwrap(), x, y);
            if ignoring == over {
                ignoring = !over;
                let _ = win.set_ignore_cursor_events(ignoring);
            }
            if (x - last.0).abs() >= 1.0 || (y - last.1).abs() >= 1.0 {
                last = (x, y);
                let _ = win.emit("pet-pointer", Pointer { x, y });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Area = Area { x: 0, y: 0, w: 1920, h: 1040 }; // a 1080 screen with a 40 px taskbar

    #[test]
    fn the_window_sits_flush_against_the_edge_inside_the_work_area() {
        assert_eq!(placement("bottom", WORK, 340, 220, 0.0), Some((0, 820)), "above the taskbar, not behind it");
        assert_eq!(placement("bottom", WORK, 340, 220, 1.0), Some((1580, 820)));
        assert_eq!(placement("right", WORK, 340, 220, 0.5), Some((1580, 410)));
        assert_eq!(placement("left", WORK, 340, 220, 1.0), Some((0, 820)));
    }

    #[test]
    fn a_second_screen_and_a_taskbar_on_the_side_move_the_area_not_the_rule() {
        let second = Area { x: 1920, y: -200, w: 2560, h: 1400 };
        assert_eq!(placement("left", second, 510, 330, 0.0), Some((1920, -200)));
        assert_eq!(placement("right", second, 510, 330, 0.0), Some((1920 + 2560 - 510, -200)));
        let side_taskbar = Area { x: 60, y: 0, w: 1860, h: 1080 }; // taskbar on the left
        assert_eq!(placement("left", side_taskbar, 340, 220, 0.0), Some((60, 0)));
    }

    #[test]
    fn nonsense_never_leaves_the_screen_or_crashes() {
        assert_eq!(placement("top", WORK, 340, 220, 0.5), None);
        assert_eq!(placement("bottom", WORK, 340, 220, 7.0), placement("bottom", WORK, 340, 220, 1.0));
        assert_eq!(placement("bottom", WORK, 340, 220, -3.0), placement("bottom", WORK, 340, 220, 0.0));
        assert_eq!(placement("bottom", WORK, 340, 220, f64::NAN), placement("bottom", WORK, 340, 220, 0.5));
        // A work area smaller than the window pins it to the edge instead of going negative.
        assert_eq!(placement("bottom", Area { x: 0, y: 0, w: 100, h: 100 }, 340, 220, 0.5), Some((0, 0)));
    }

    #[test]
    fn only_mochi_and_the_bubble_take_the_mouse() {
        let rects = [[80.0, 100.0, 180.0, 120.0], [20.0, 0.0, 300.0, 60.0]];
        assert!(inside(&rects, 100.0, 150.0), "on Mochi");
        assert!(inside(&rects, 30.0, 30.0), "on the bubble");
        assert!(!inside(&rects, 20.0, 150.0), "the empty corner lets the click through");
        assert!(!inside(&[], 5.0, 5.0), "nothing is hit until the page says where Mochi is");
        assert!(inside(&rects, 80.0, 100.0) && inside(&rects, 260.0, 220.0), "the edges count");
    }
}
