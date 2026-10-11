// The weekly recap as a picture: the page draws it into a canvas and hands over
// the PNG as a `data:` URL; this writes it to Pictures\Coucou and nothing else.
//
// Only a real PNG is ever written, never bigger than a few MB, and always to a
// file name of our own making: the page chooses no path.

use std::path::PathBuf;

use base64::Engine;

use crate::platform;

/// A 1080 x 1920 PNG of text and flat colours is well under this.
const MAX_BYTES: usize = 8 * 1024 * 1024;
const PREFIX: &str = "data:image/png;base64,";

/// The PNG inside a `data:image/png;base64,…` URL, or `None` for anything else.
pub fn png_from_data_url(url: &str) -> Option<Vec<u8>> {
    let encoded = url.strip_prefix(PREFIX)?;
    // The decoded size is 3/4 of the text: refuse before decoding something huge.
    if encoded.len() > MAX_BYTES * 4 / 3 + 8 {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded.trim()).ok()?;
    let is_png = bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    (is_png && bytes.len() <= MAX_BYTES).then_some(bytes)
}

/// Pictures\Coucou, or the home folder when there is no Pictures.
pub fn folder() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    match home {
        Some(home) => {
            let pictures = home.join("Pictures");
            if pictures.is_dir() { pictures.join("Coucou") } else { home.join("Coucou") }
        }
        None => platform::config_dir().join("recaps"),
    }
}

/// `Resumen-semanal-<unix seconds>.png`: a name that cannot clash or escape.
pub fn file_name(unix_seconds: u64) -> String {
    format!("Resumen-semanal-{unix_seconds}.png")
}

/// Writes the picture and returns where it went.
pub fn save(data_url: &str) -> Result<PathBuf, String> {
    let bytes = png_from_data_url(data_url).ok_or("La imagen no es un PNG válido.")?;
    let dir = folder();
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = dir.join(file_name(now));
    std::fs::write(&path, bytes).map_err(|e| format!("No se pudo guardar {}: {e}", path.display()))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url_of(bytes: &[u8]) -> String {
        format!("{PREFIX}{}", base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    const PNG_HEAD: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    #[test]
    fn a_png_data_url_gives_its_bytes_back() {
        assert_eq!(png_from_data_url(&url_of(&PNG_HEAD)).unwrap(), PNG_HEAD);
    }

    #[test]
    fn nothing_else_is_accepted() {
        assert!(png_from_data_url("data:image/jpeg;base64,/9j/4AAQ").is_none());
        assert!(png_from_data_url("https://example.com/a.png").is_none());
        assert!(png_from_data_url(&url_of(b"<html>not a png</html>")).is_none());
        assert!(png_from_data_url(&format!("{PREFIX}!!!not base64!!!")).is_none());
        assert!(png_from_data_url("").is_none());
    }

    #[test]
    fn a_huge_picture_is_refused_before_it_is_decoded() {
        let mut big = PNG_HEAD.to_vec();
        big.resize(MAX_BYTES + 1, 0);
        assert!(png_from_data_url(&url_of(&big)).is_none());
        let ok = {
            let mut v = PNG_HEAD.to_vec();
            v.resize(1000, 0);
            v
        };
        assert!(png_from_data_url(&url_of(&ok)).is_some());
    }

    #[test]
    fn the_file_name_is_ours_alone() {
        let name = file_name(1_700_000_000);
        assert_eq!(name, "Resumen-semanal-1700000000.png");
        assert!(!name.contains('/') && !name.contains('\\') && !name.contains(".."));
    }
}
