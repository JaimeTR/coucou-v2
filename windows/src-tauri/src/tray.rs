// Notification-area icon: Open, Settings, Pause, Quit.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::island::WINDOW_LABEL;

/// The menu entries, kept so their text can follow the interface language.
struct Items {
    open: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

fn labels(lang: &str) -> [&'static str; 4] {
    if lang == "en" {
        ["Open Coucou", "Settings…", "Pause", "Quit"]
    } else {
        ["Abrir Coucou", "Ajustes…", "Pausar", "Salir"]
    }
}

/// The page tells us which language it resolved; the menu follows.
pub fn set_language(app: &AppHandle, lang: &str) {
    let Some(items) = app.try_state::<Items>() else {
        return;
    };
    let [open, settings, pause, quit] = labels(lang);
    let _ = items.open.set_text(open);
    let _ = items.settings.set_text(settings);
    let _ = items.pause.set_text(pause);
    let _ = items.quit.set_text(quit);
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let [l_open, l_settings, l_pause, l_quit] = labels("es");
    let open = MenuItem::with_id(app, "open", l_open, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", l_settings, true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", l_pause, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l_quit, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&open, &sep1, &settings, &pause, &sep2, &quit])?;
    app.manage(Items { open, settings, pause, quit });

    let mut builder = TrayIconBuilder::with_id("coucou")
        .tooltip("Coucou")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            id => {
                let _ = app.emit_to(WINDOW_LABEL, "tray", id.to_string());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}
