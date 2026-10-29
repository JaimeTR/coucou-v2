// ZIP archive extraction for GOWA install.

pub fn entries(_zip: &[u8]) -> Option<Vec<String>> {
    None
}

pub fn read(_zip: &[u8], _entry: &str) -> Option<Vec<u8>> {
    None
}