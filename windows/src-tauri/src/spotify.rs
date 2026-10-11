// The Spotify pill: what Spotify plays, and its controls.
//
// Windows shows Spotify in the system media controls (the volume flyout's
// panel), so that is where it is read from and driven: the track, the cover,
// the position, play/pause, next and previous. Nothing runs on a timer here:
// the page asks while the pill is on screen, and a hidden island asks nothing.
//
// Mac and Linux have no reader yet: the commands answer "Spotify is not running".

use serde::Serialize;


/// What the card shows.
#[derive(Serialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyState {
    /// Spotify is open (it has a media session).
    pub running: bool,
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Seconds into the track, and its length; 0 when Spotify does not say.
    pub position: f64,
    pub duration: f64,
    /// The cover as a data URL, when Spotify gave one.
    pub artwork: Option<String>,
}

/// The controls the card has.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action {
    PlayPause,
    Next,
    Previous,
    Seek(f64),
}

impl Action {
    pub fn parse(name: &str, value: Option<f64>) -> Option<Action> {
        match name {
            "playPause" => Some(Action::PlayPause),
            "next" => Some(Action::Next),
            "previous" => Some(Action::Previous),
            // A negative or absurd position is refused, not clamped into something plausible.
            "seek" => value.filter(|s| s.is_finite() && (0.0..=86_400.0).contains(s)).map(Action::Seek),
            _ => None,
        }
    }
}

/// Is this media session Spotify's? The app id is `Spotify.exe` for the classic
/// installer and `SpotifyAB.SpotifyMusic_…!Spotify` for the Store's.
pub fn is_spotify(app_id: &str) -> bool {
    app_id.to_lowercase().contains("spotify")
}

/// `bytes` as a `data:` URL for the cover; `None` for anything that is not a
/// picture or is too big to be a cover (Spotify's are ~100 KB JPEGs).
pub fn artwork_data_url(bytes: &[u8]) -> Option<String> {
    use base64::Engine;
    const LIMIT: usize = 3 * 1024 * 1024;
    if bytes.is_empty() || bytes.len() > LIMIT {
        return None;
    }
    let mime = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spotify_is_found_by_its_app_id_in_both_installs() {
        assert!(is_spotify("Spotify.exe"));
        assert!(is_spotify("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"));
        assert!(!is_spotify("Chrome"));
        assert!(!is_spotify(""));
    }

    #[test]
    fn actions_are_parsed_and_a_bad_seek_is_refused() {
        assert_eq!(Action::parse("playPause", None), Some(Action::PlayPause));
        assert_eq!(Action::parse("next", None), Some(Action::Next));
        assert_eq!(Action::parse("previous", None), Some(Action::Previous));
        assert_eq!(Action::parse("seek", Some(42.5)), Some(Action::Seek(42.5)));
        for bad in [None, Some(-1.0), Some(f64::NAN), Some(f64::INFINITY), Some(1e9)] {
            assert_eq!(Action::parse("seek", bad), None, "{bad:?}");
        }
        assert_eq!(Action::parse("format-disk", None), None);
    }

    #[test]
    fn only_a_reasonable_picture_becomes_a_cover() {
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];
        assert!(artwork_data_url(&jpeg).unwrap().starts_with("data:image/jpeg;base64,"));
        let png = [0x89, b'P', b'N', b'G', 1, 2];
        assert!(artwork_data_url(&png).unwrap().starts_with("data:image/png;base64,"));
        assert_eq!(artwork_data_url(&[]), None);
        assert_eq!(artwork_data_url(b"<html>not a picture</html>"), None);
        assert_eq!(artwork_data_url(&vec![0xFF; 4 * 1024 * 1024]), None, "too big");
    }
}
