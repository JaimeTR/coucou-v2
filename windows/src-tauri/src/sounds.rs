// Your own sounds: a file named like one of Mochi's sounds, in the sounds folder,
// replaces it (finish.wav, approval.mp3, greet.m4a…).
//
// The page asks for one sound by name; only the 28 names Mochi knows are
// answered, and only from the folder: a name can never reach another path.

use std::path::{Path, PathBuf};

use crate::platform;

/// The sounds the island plays (same list as src/core/sound.ts).
pub const NAMES: &[&str] = &[
    "peek", "open", "close", "hover", "blip", "slap", "annoyed", "dizzy", "greet",
    "work", "finish", "error", "approval", "question", "approve", "gulp", "tick",
    "send", "love", "pop", "proud", "wink", "yawn", "attach", "think", "search",
    "rate", "sleep",
];

/// What the webview can decode.
const EXTENSIONS: &[&str] = &["wav", "mp3", "m4a", "ogg", "flac", "aac"];

/// A sound is a few seconds long: anything bigger is not one.
const MAX_BYTES: u64 = 5 * 1024 * 1024;

pub fn folder() -> PathBuf {
    platform::config_dir().join("sounds")
}

/// The folder, made on the way so there is always one to open.
pub fn ensure_folder() -> PathBuf {
    let dir = folder();
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// The file in `dir` that replaces `name`, if there is one: the first extension
/// that exists, in the order above. Pure apart from the file system.
pub fn find(dir: &Path, name: &str) -> Option<PathBuf> {
    if !NAMES.contains(&name) {
        return None;
    }
    EXTENSIONS
        .iter()
        .map(|ext| dir.join(format!("{name}.{ext}")))
        .find(|path| std::fs::metadata(path).map(|m| m.is_file() && m.len() <= MAX_BYTES).unwrap_or(false))
}

pub fn read(dir: &Path, name: &str) -> Option<Vec<u8>> {
    std::fs::read(find(dir, name)?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("coucou-sounds-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_file_named_like_a_sound_replaces_it_in_any_known_format() {
        let dir = scratch("known");
        std::fs::write(dir.join("finish.mp3"), b"mp3").unwrap();
        std::fs::write(dir.join("approval.WAV"), b"upper").unwrap();
        std::fs::write(dir.join("greet.wav"), b"wav").unwrap();
        assert_eq!(read(&dir, "finish").unwrap(), b"mp3");
        assert_eq!(read(&dir, "greet").unwrap(), b"wav");
        assert!(read(&dir, "error").is_none(), "no file, no replacement");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_cannot_reach_outside_the_folder_or_the_list() {
        let dir = scratch("names");
        std::fs::write(dir.join("secret.wav"), b"x").unwrap();
        for bad in ["secret", "../secret", "..\\finish", "finish/../../x", "", "finish.wav", "FINISH"] {
            assert!(find(&dir, bad).is_none(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_huge_file_or_a_folder_is_not_a_sound() {
        let dir = scratch("big");
        std::fs::create_dir_all(dir.join("open.wav")).unwrap();
        assert!(find(&dir, "open").is_none(), "a folder");
        std::fs::write(dir.join("close.wav"), vec![0u8; (MAX_BYTES + 1) as usize]).unwrap();
        assert!(find(&dir, "close").is_none(), "too big");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_names_match_the_ones_the_page_plays() {
        assert_eq!(NAMES.len(), 28);
        let page = include_str!("../../src/core/sound.ts");
        for name in NAMES {
            assert!(page.contains(&format!("\"{name}\"")), "{name} missing from sound.ts");
        }
    }
}
