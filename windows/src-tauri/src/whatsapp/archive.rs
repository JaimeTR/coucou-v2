// Minimal zip reading for GOWA's release archive: find one named entry, return its bytes.

pub fn extract(zip_bytes: &[u8], entry_suffix: &str) -> Option<Vec<u8>> {
    let reader = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader).ok()?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).ok()?;
        if file.name().ends_with(entry_suffix) {
            let mut out = Vec::new();
            std::io::Read::read_to_end(&mut file, &mut out).ok()?;
            return Some(out);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip(entry_name: &str, content: &[u8]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut writer = zip::ZipWriter::new(cursor);
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file(entry_name, options).unwrap();
            writer.write_all(content).unwrap();
            writer.finish().unwrap();
        }
        buf
    }

    #[test]
    fn extracts_the_entry_matching_the_suffix() {
        let zip = make_zip("whatsapp_9.8.0_windows_amd64/whatsapp.exe", b"fake binary bytes");
        let found = extract(&zip, "whatsapp.exe").unwrap();
        assert_eq!(found, b"fake binary bytes");
    }

    #[test]
    fn returns_none_when_nothing_matches() {
        let zip = make_zip("readme.txt", b"hello");
        assert!(extract(&zip, "whatsapp.exe").is_none());
    }

    #[test]
    fn returns_none_for_bytes_that_are_not_a_zip() {
        assert!(extract(b"not a zip file at all", "whatsapp.exe").is_none());
    }
}
