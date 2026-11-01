// Verification-code (OTP) detection: a run of 4-8 digits near a trigger word,
// in the subject or the first part of the body. Pure function, no I/O — the
// caller decides what counts as "the first part of the body" and never hands
// this more than it has to (see watch.rs).

const TRIGGER_WORDS: &[&str] = &[
    "código", "codigo", "code", "verification", "verifica", "otp",
    "one-time", "one time", "security code", "clave de acceso",
];

/// Groups like "90-21-44" or "123 456" collapse to one run before counting digits.
fn digit_runs(text: &str) -> Vec<(usize, usize, String)> {
    let mut runs = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            let mut digits = String::new();
            let mut j = i;
            while j < chars.len() && (chars[j].is_ascii_digit() || ((chars[j] == '-' || chars[j] == ' ') && j + 1 < chars.len() && chars[j + 1].is_ascii_digit())) {
                if chars[j].is_ascii_digit() {
                    digits.push(chars[j]);
                }
                j += 1;
            }
            if (4..=8).contains(&digits.len()) {
                runs.push((start, j, digits));
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
    runs
}

/// A trigger word within this many characters of a digit run counts as "near it".
const NEAR: usize = 40;

fn code_in(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    for (start, end, digits) in digit_runs(text) {
        let window_start = start.saturating_sub(NEAR);
        let window_end = (end + NEAR).min(lower.chars().count());
        let window: String = lower.chars().skip(window_start).take(window_end - window_start).collect();
        if TRIGGER_WORDS.iter().any(|w| window.contains(w)) {
            return Some(digits);
        }
    }
    None
}

/// The subject is checked first (codes are almost always there), then the body.
pub fn find_code(subject: &str, body_start: &str) -> Option<String> {
    code_in(subject).or_else(|| code_in(body_start))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_code_next_to_a_trigger_word_in_spanish_or_english() {
        assert_eq!(find_code("Tu código es 482913", ""), Some("482913".into()));
        assert_eq!(find_code("Verification code: 7734", ""), Some("7734".into()));
        assert_eq!(find_code("", "Your OTP is 5521 - do not share it"), Some("5521".into()));
        assert_eq!(find_code("Clave de acceso: 90-21-44", ""), Some("902144".into()));
    }

    #[test]
    fn ignores_digit_runs_with_no_trigger_word_nearby() {
        assert_eq!(find_code("Your order #4820391 has shipped", ""), None);
        assert_eq!(find_code("Invoice total: $192.50", "Thanks for your purchase"), None);
        assert_eq!(find_code("Call us at 555-0142-9981", ""), None);
    }

    #[test]
    fn ignores_runs_shorter_than_4_or_longer_than_8_digits() {
        assert_eq!(find_code("Your code is 12", ""), None);
        assert_eq!(find_code("Your code is 123456789012", ""), None);
    }

    #[test]
    fn the_subject_is_checked_before_the_body() {
        // A code in the subject wins even if the body also has a run of digits.
        assert_eq!(find_code("Code: 1111", "unrelated 2222 numbers here"), Some("1111".into()));
    }
}
