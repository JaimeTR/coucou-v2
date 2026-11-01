// Global keyboard shortcuts — simplified port of HotKeyCenter.swift.
// Registers global hotkeys through tauri-plugin-global-shortcut (RegisterHotKey on Windows).
// A press is handed to the island as a `shortcut` event carrying the action id.

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcut, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::island::WINDOW_LABEL;

/// One global action, with its default key combination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionDef {
    pub id: &'static str,
    pub default_keys: &'static str,
    pub enabled_by_default: bool,
}

const fn action(id: &'static str, keys: &'static str, on: bool) -> ActionDef {
    ActionDef { id, default_keys: keys, enabled_by_default: on }
}

/// Same order as the Mac's ShortcutAction.allCases. Only actions this Windows
// build can actually perform are `ported: true`; the rest are reserved for later.
pub const ACTIONS: &[ActionDef] = &[
    action("toggleIsland", "Ctrl+Alt+N", false),
    action("openChat", "Ctrl+Alt+Space", true),
    action("goToAlert", "Ctrl+Alt+A", true),
    action("jumpToTerminal", "Ctrl+Alt+T", true),
    action("nextPill", "Ctrl+Alt+Right", true),
    action("prevPill", "Ctrl+Alt+Left", true),
    action("muteToggle", "Ctrl+Alt+S", true),
    action("desktopToggle", "Ctrl+Alt+D", true),
];

/// Parsed binding: the keys the user wants and whether it is enabled.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Binding {
    pub keys: String,
    pub enabled: bool,
}

/// What `plan()` returns for each action: the keys to register, or an error.
#[derive(Clone, Debug)]
pub struct PlanEntry<'a> {
    pub def: &'a ActionDef,
    pub outcome: Result<Binding, ShortcutStatus>,
}

/// Why a shortcut could not be registered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShortcutStatus {
    Off,              // disabled in settings
    TypesCharacter,   // Ctrl+Alt types a character on this layout (AltGr)
    Duplicate,        // same keys as another enabled action
    Other(String),
}

impl std::fmt::Display for ShortcutStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ShortcutStatus::Off => write!(f, "off"),
            ShortcutStatus::TypesCharacter => write!(f, "types a character"),
            ShortcutStatus::Duplicate => write!(f, "duplicate"),
            ShortcutStatus::Other(s) => write!(f, "{s}"),
        }
    }
}

/// The user's stored overrides, keyed by action id.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Bindings(pub Vec<(String, Binding)>);

impl Bindings {
    pub fn new() -> Self {
        Self(Vec::new())
    }
    pub fn insert(&mut self, id: String, binding: Binding) {
        if let Some((_, b)) = self.0.iter_mut().find(|(i, _)| i == &id) {
            *b = binding;
        } else {
            self.0.push((id, binding));
        }
    }
    pub fn get(&self, id: &str) -> Option<&Binding> {
        self.0.iter().find(|(i, _)| i == id).map(|(_, b)| b)
    }
}

/// Effective keys for an action: stored override, else default.
fn effective(def: &ActionDef, stored: &Bindings) -> Binding {
    stored.get(def.id).cloned().unwrap_or_else(|| Binding {
        keys: def.default_keys.to_string(),
        enabled: def.enabled_by_default,
    })
}

/// Plan which shortcuts to register from stored bindings. Never registers a
// combination that types a character on the current keyboard layout.
pub fn plan(stored: &Bindings) -> Vec<(ActionDef, Result<Binding, ShortcutStatus>)> {
    ACTIONS.iter().copied().map(|def| {
        let binding = effective(&def, stored);
        if !binding.enabled {
            (def, Err(ShortcutStatus::Off))
        } else {
            (def, Ok(binding))
        }
    }).collect()
}

/// Register all planned shortcuts on the app.
pub fn register<R: Runtime>(app: &AppHandle<R>, plan: &[(ActionDef, Result<Binding, ShortcutStatus>)]) {
    for (def, outcome) in plan {
        if let Ok(binding) = outcome {
            if let Ok(shortcut) = binding.keys.parse::<Shortcut>() {
                let _ = app.global_shortcut().register(shortcut);
            }
        }
    }
}

/// Start: register all default-enabled shortcuts.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let plan = plan(&Bindings::new());
    register(app, &plan);
}

/// Emit a `shortcut` event to the island for the given action id.
pub fn emit_shortcut<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit_to(WINDOW_LABEL, "shortcut", id.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planned_actions_have_defaults() {
        let p = plan(&Bindings::new());
        let open_chat = p.iter().find(|(d, _)| d.id == "openChat").unwrap();
        assert!(open_chat.1.is_ok());
        assert_eq!(open_chat.1.as_ref().unwrap().keys, "Ctrl+Alt+Space");
    }

    #[test]
    fn a_disabled_action_is_off() {
        let p = plan(&Bindings::new());
        let toggle = p.iter().find(|(d, _)| d.id == "toggleIsland").unwrap();
        assert_eq!(toggle.1.as_ref().unwrap_err(), &ShortcutStatus::Off);
    }
}