// Work modes: what the person is doing decides how much Coucou may show and say.
//
//   Work     everything: the island, sounds, voice, the pet.
//   Game     a full-screen or known game: no window at all over it (some games
//            minimise or close when another window appears on top), no sounds;
//            the pet may still cheer, by voice only, if the person wants it.
//   Meeting  a call or a presentation (the microphone or camera is in use, or
//            Windows is in presentation mode): silent and nothing on the screen,
//            which may be shared.
//   Video    something full-screen while a video plays: as quiet as a meeting.
//
// The mode is detected every couple of seconds (never over a game: the first
// frames of one matter), or chosen by hand, which always wins. In every mode but
// Work a permission request goes straight back to the terminal: Claude Code is
// never blocked, and nothing pops up over the game or the shared screen.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::platform::Signals;
use crate::{island, log, pet, platform, Shared};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Work,
    Game,
    Meeting,
    Video,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "work" => Some(Mode::Work),
            "game" => Some(Mode::Game),
            "meeting" => Some(Mode::Meeting),
            "video" => Some(Mode::Video),
            _ => None,
        }
    }
}

/// The mode in force, for the page.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub mode: Mode,
    /// True when it was detected, false when the person chose it.
    pub auto: bool,
    /// The game being played, when it is known by name.
    pub game: Option<String>,
}

static CURRENT: Mutex<Info> = Mutex::new(Info { mode: Mode::Work, auto: true, game: None });

pub fn current() -> Info {
    CURRENT.lock().unwrap().clone()
}

/// What the signals say. Pure.
pub fn decide(s: &Signals, video_playing: bool) -> Mode {
    if s.presentation {
        return Mode::Meeting;
    }
    if s.game.is_some() {
        return Mode::Game;
    }
    if s.fullscreen {
        // Something full-screen that is not a known game: a film is quiet, anything
        // else is treated as a game (it must not be disturbed either).
        return if video_playing { Mode::Video } else { Mode::Game };
    }
    if s.call {
        return Mode::Meeting;
    }
    Mode::Work
}

/// Programs that are games, by their file name: [(file, shown name)]. Anything the
/// person adds in Settings is shown by its file name.
const KNOWN_GAMES: &[(&str, &str)] = &[
    ("dota2.exe", "Dota 2"),
    ("cs2.exe", "Counter-Strike 2"),
    ("csgo.exe", "Counter-Strike"),
    ("valorant-win64-shipping.exe", "Valorant"),
    ("fortniteclient-win64-shipping.exe", "Fortnite"),
    ("league of legends.exe", "League of Legends"),
    ("leagueclient.exe", "League of Legends"),
    ("overwatch.exe", "Overwatch"),
    ("r5apex.exe", "Apex Legends"),
    ("gta5.exe", "Grand Theft Auto V"),
    ("eldenring.exe", "Elden Ring"),
    ("rocketleague.exe", "Rocket League"),
    ("robloxplayerbeta.exe", "Roblox"),
    ("genshinimpact.exe", "Genshin Impact"),
    ("tslgame.exe", "PUBG"),
    ("rainbowsix.exe", "Rainbow Six Siege"),
    ("destiny2.exe", "Destiny 2"),
    ("witcher3.exe", "The Witcher 3"),
    ("cyberpunk2077.exe", "Cyberpunk 2077"),
    ("warframe.x64.exe", "Warframe"),
    ("wow.exe", "World of Warcraft"),
    ("hearthstone.exe", "Hearthstone"),
    ("starfield.exe", "Starfield"),
    ("helldivers2.exe", "Helldivers 2"),
    ("minecraft.exe", "Minecraft"),
];

/// The game a running program is, if it is one: a known one, or one the person listed.
pub fn known_game(exe: &str, extra: &[String]) -> Option<String> {
    let exe = exe.trim().to_lowercase();
    if exe.is_empty() {
        return None;
    }
    if let Some((_, name)) = KNOWN_GAMES.iter().find(|(file, _)| *file == exe) {
        return Some((*name).to_string());
    }
    extra
        .iter()
        .find(|e| {
            let e = e.trim().to_lowercase();
            !e.is_empty() && (e == exe || format!("{e}.exe") == exe)
        })
        .map(|e| e.trim().trim_end_matches(".exe").to_string())
}

/// Is the program playing the media one that shows video (a browser, a film player)?
pub fn is_video_app(app: &str) -> bool {
    let who = app.to_lowercase();
    ["chrome", "edge", "firefox", "brave", "opera", "vivaldi", "safari", "netflix", "prime", "disney", "youtube", "plex", "mpv", "kodi", "video", "film", "movie", "vlc", "potplayer"]
        .iter()
        .any(|w| who.contains(w))
}

/// What the person chose in Settings, and the programs they listed.
fn preferences(app: &AppHandle) -> (String, Vec<String>, bool) {
    app.try_state::<Shared>()
        .map(|s| {
            let s = s.settings.lock().unwrap();
            (s.work_mode.clone(), s.game_programs.clone(), s.detect_meetings)
        })
        .unwrap_or_else(|| ("auto".into(), Vec::new(), true))
}

/// Works out the mode now.
fn evaluate(app: &AppHandle) -> Info {
    let (chosen, extra, meetings) = preferences(app);
    if let Some(mode) = Mode::parse(&chosen) {
        return Info { mode, auto: false, game: None };
    }
    let mut signals = platform::signals(&extra);
    if !meetings {
        signals.call = false;
    }
    let video = signals.fullscreen
        && signals.game.is_none()
        && platform::now_playing().map(|n| n.playing && is_video_app(&n.app)).unwrap_or(false);
    Info { mode: decide(&signals, video), auto: true, game: signals.game }
}

/// Re-evaluates now and, if anything changed, applies it and tells the pages.
pub fn refresh(app: &AppHandle) {
    let next = evaluate(app);
    let changed = {
        let mut now = CURRENT.lock().unwrap();
        if *now == next {
            false
        } else {
            *now = next.clone();
            true
        }
    };
    if !changed {
        return;
    }
    log::line(format!("mode: {:?} ({})", next.mode, if next.auto { "detected" } else { "chosen" }));
    apply(app, &next);
    let _ = app.emit("mode-changed", next);
}

/// Over a game or a shared screen nothing of ours may be on top: the island and
/// the pet are put away, and come back when the mode does.
fn apply(app: &AppHandle, info: &Info) {
    let Some(win) = island::window(app) else { return };
    if info.mode == Mode::Work {
        let Some(shared) = app.try_state::<Shared>() else { return };
        let pref = shared.settings.lock().unwrap().screen.clone();
        let collapsed = shared.gate.collapsed.load(std::sync::atomic::Ordering::Relaxed);
        island::apply_geometry(app, &pref, collapsed);
        island::refresh_click_through(app, &shared.gate);
        shared.gate.set_active(!collapsed);
        let _ = win.show();
    } else {
        if let Some(shared) = app.try_state::<Shared>() {
            shared.gate.set_active(false);
        }
        let _ = win.hide();
        pet::hide(app);
    }
}

/// Looks every two seconds; asks nothing of a hidden island but this.
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || loop {
        refresh(&app);
        std::thread::sleep(Duration::from_secs(2));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(fullscreen: bool, presentation: bool, game: Option<&str>, call: bool) -> Signals {
        Signals { fullscreen, presentation, game: game.map(str::to_string), call }
    }

    #[test]
    fn nothing_going_on_is_work() {
        assert_eq!(decide(&s(false, false, None, false), false), Mode::Work);
    }

    #[test]
    fn a_game_wins_over_a_call_so_a_voice_chat_does_not_make_it_a_meeting() {
        assert_eq!(decide(&s(true, false, Some("Dota 2"), true), false), Mode::Game);
        assert_eq!(decide(&s(false, false, Some("Dota 2"), true), false), Mode::Game, "windowed too");
    }

    #[test]
    fn a_call_or_a_presentation_is_a_meeting() {
        assert_eq!(decide(&s(false, false, None, true), false), Mode::Meeting);
        assert_eq!(decide(&s(false, true, None, false), false), Mode::Meeting);
        assert_eq!(decide(&s(true, true, Some("Dota 2"), false), false), Mode::Meeting, "presenting is explicit");
    }

    #[test]
    fn something_full_screen_is_a_film_if_a_video_plays_and_a_game_if_not() {
        assert_eq!(decide(&s(true, false, None, false), true), Mode::Video);
        assert_eq!(decide(&s(true, false, None, false), false), Mode::Game, "an unknown full-screen app is not to be disturbed");
    }

    #[test]
    fn games_are_found_by_file_name_and_by_the_persons_own_list() {
        assert_eq!(known_game("Dota2.exe", &[]).as_deref(), Some("Dota 2"));
        assert_eq!(known_game("  CS2.EXE ", &[]).as_deref(), Some("Counter-Strike 2"));
        assert_eq!(known_game("notepad.exe", &[]), None);
        assert_eq!(known_game("", &[]), None);
        let mine = vec!["MiJuego".to_string(), "otro.exe".to_string(), "".to_string()];
        assert_eq!(known_game("mijuego.exe", &mine).as_deref(), Some("MiJuego"));
        assert_eq!(known_game("OTRO.exe", &mine).as_deref(), Some("otro"));
        assert_eq!(known_game("", &mine), None, "an empty entry matches nothing");
    }

    #[test]
    fn browsers_and_film_players_are_video_music_programs_are_not() {
        assert!(is_video_app("chrome.exe") && is_video_app("MSEdge") && is_video_app("VLC media player"));
        assert!(!is_video_app("Spotify.exe") && !is_video_app("Music"));
    }

    #[test]
    fn a_chosen_mode_is_read_back_and_nonsense_is_not_a_mode() {
        assert_eq!(Mode::parse("game"), Some(Mode::Game));
        assert_eq!(Mode::parse("work"), Some(Mode::Work));
        assert_eq!(Mode::parse("auto"), None, "auto means: detect");
        assert_eq!(Mode::parse("nonsense"), None);
    }
}
