// Mochi's voice, both ways.
//
//   ElevenLabs   text → speech. POST /v1/text-to-speech/{voice_id}, key in the
//                `xi-api-key` header. Returns MP3.
//   Groq Whisper speech → text. POST /openai/v1/audio/transcriptions, multipart,
//                Bearer auth with the same key as the Groq chat.
//
// Keys stay in the Credential Manager and never reach the page; the page only
// hands over text (to speak) or a recording (to transcribe) and gets sound or
// text back.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::claude::base64_for;
use crate::secrets;

const ELEVEN_BASE: &str = "https://api.elevenlabs.io/v1";
const GROQ_STT: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
pub const ELEVEN_KEY: &str = "elevenlabs-api-key";
const GROQ_KEY: &str = "groq-api-key";
const TIMEOUT: Duration = Duration::from_secs(60);

/// Premade "Rachel": available on every plan and speaks Spanish with the
/// multilingual models.
pub const DEFAULT_VOICE: &str = "21m00Tcm4TlvDq8ikWAM";
pub const DEFAULT_MODEL: &str = "eleven_multilingual_v2";
const STT_MODELS: &[&str] = &["whisper-large-v3-turbo", "whisper-large-v3"];
/// ElevenLabs charges per character and is only for Mochi's own short phrases.
const MAX_SPOKEN_CHARS: usize = 300;
/// Groq accepts 25 MB; a spoken question is a small fraction of that.
const MAX_AUDIO_BYTES: usize = 8 * 1024 * 1024;

#[derive(Serialize)]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    pub category: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| e.to_string())
}

/// ElevenLabs voice ids are short alphanumeric strings; anything else would end
/// up inside a URL path.
pub fn valid_voice_id(id: &str) -> bool {
    (8..=40).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric())
}

fn eleven_error(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            let d = v.get("detail")?;
            d.get("message").and_then(Value::as_str).or_else(|| d.as_str()).map(str::to_string)
        })
        .unwrap_or_default();
    match status {
        401 => format!("ElevenLabs rechazó la clave de API (401). Revísala en Ajustes. {detail}"),
        402 | 403 => format!("Tu plan de ElevenLabs no permite esto ({status}). {detail}"),
        404 | 422 => format!("ElevenLabs no encontró esa voz o ese modelo ({status}). Revisa la voz en Ajustes. {detail}"),
        429 => "Se alcanzó el límite de ElevenLabs (429). Espera un momento e inténtalo de nuevo.".into(),
        500..=599 => format!("ElevenLabs no está disponible ({status}). Inténtalo en un momento."),
        _ => format!("ElevenLabs respondió {status}. {detail}"),
    }
    .trim()
    .to_string()
}

/// Speaks `text` with the chosen voice; the answer is the MP3, base64-encoded.
pub async fn speak(text: &str, voice_id: &str, model: &str) -> Result<String, String> {
    let key = secrets::get(ELEVEN_KEY).ok_or("Falta la clave de ElevenLabs. Añádela en Ajustes.")?;
    if !valid_voice_id(voice_id) {
        return Err("La voz de ElevenLabs no es válida: elige una en Ajustes.".into());
    }
    let text: String = text.chars().take(MAX_SPOKEN_CHARS).collect();
    if text.trim().is_empty() {
        return Err("No hay nada que decir.".into());
    }
    let response = client()?
        .post(format!("{ELEVEN_BASE}/text-to-speech/{voice_id}?output_format=mp3_44100_128"))
        .header("xi-api-key", key)
        .json(&json!({ "text": text, "model_id": model }))
        .send()
        .await
        .map_err(|e| format!("Error de red al hablar con ElevenLabs: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(eleven_error(status.as_u16(), &body));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(base64_for(&bytes))
}

/// The voices this key can use, for the picker in Settings.
pub async fn voices() -> Result<Vec<VoiceInfo>, String> {
    let key = secrets::get(ELEVEN_KEY).ok_or("Aún no hay clave de ElevenLabs guardada.")?;
    let response = client()?
        .get(format!("{ELEVEN_BASE}/voices"))
        .header("xi-api-key", key)
        .send()
        .await
        .map_err(|e| format!("No se puede llegar a ElevenLabs: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(eleven_error(status.as_u16(), &body));
    }
    Ok(parse_voices(&serde_json::from_str(&body).map_err(|e| e.to_string())?))
}

fn parse_voices(json: &Value) -> Vec<VoiceInfo> {
    json.get("voices")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|v| {
                    let id = v.get("voice_id")?.as_str()?.to_string();
                    if !valid_voice_id(&id) {
                        return None;
                    }
                    Some(VoiceInfo {
                        id,
                        name: v.get("name").and_then(Value::as_str).unwrap_or("Voz").to_string(),
                        category: v.get("category").and_then(Value::as_str).unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

// ── Speech to text ────────────────────────────────────────────────────────────

/// One `multipart/form-data` body, built by hand: the three fields Whisper needs
/// and the audio file.
fn multipart(boundary: &str, fields: &[(&str, &str)], file_name: &str, mime: &str, audio: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(audio.len() + 512);
    for (name, value) in fields {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {mime}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(audio);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

fn stt_error(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("error")?.get("message")?.as_str().map(str::to_string))
        .unwrap_or_default();
    match status {
        401 | 403 => "Groq rechazó la clave de API (401). Revísala en Ajustes.".to_string(),
        413 => "La grabación es demasiado larga.".to_string(),
        429 => "Se alcanzó el límite de peticiones de Groq (429). Espera un momento e inténtalo de nuevo.".to_string(),
        500..=599 => format!("Groq no está disponible ({status}). Inténtalo en un momento."),
        _ => format!("Groq no pudo transcribir el audio ({status}). {detail}").trim().to_string(),
    }
}

/// What was said in `audio` (WAV or WebM), in `lang` ("es" or "en"). Empty when
/// nothing intelligible was heard.
pub async fn transcribe(audio: &[u8], mime: &str, lang: &str) -> Result<String, String> {
    let key = secrets::get(GROQ_KEY)
        .or_else(|| std::env::var("GROQ_API_KEY").ok().filter(|v| !v.is_empty()))
        .ok_or("Falta la clave de Groq para entender tu voz. Añádela en Ajustes → Proveedor de chat.")?;
    if audio.is_empty() {
        return Ok(String::new());
    }
    if audio.len() > MAX_AUDIO_BYTES {
        return Err("La grabación es demasiado larga.".into());
    }
    let (extension, mime) = match mime {
        m if m.contains("wav") => ("wav", "audio/wav"),
        m if m.contains("ogg") => ("ogg", "audio/ogg"),
        _ => ("webm", "audio/webm"),
    };
    let lang = if lang == "en" { "en" } else { "es" };
    let client = client()?;
    let mut last = String::new();
    // A retired model answers 404: fall back to the next one.
    for model in STT_MODELS {
        let boundary = format!("----coucou{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(7));
        let body = multipart(
            &boundary,
            &[("model", model), ("language", lang), ("response_format", "json"), ("temperature", "0")],
            &format!("voice.{extension}"),
            mime,
            audio,
        );
        let response = client
            .post(GROQ_STT)
            .bearer_auth(&key)
            .header("Content-Type", format!("multipart/form-data; boundary={boundary}"))
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Error de red al hablar con Groq: {e}"))?;
        let status = response.status();
        let text = response.text().await.map_err(|e| e.to_string())?;
        if status.is_success() {
            let value: Value = serde_json::from_str(&text).map_err(|e| format!("Respuesta no válida de Groq: {e}"))?;
            return Ok(value.get("text").and_then(Value::as_str).unwrap_or("").trim().to_string());
        }
        last = stt_error(status.as_u16(), &text);
        if status.as_u16() != 404 {
            break;
        }
    }
    Err(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_ids_are_plain_alphanumerics() {
        assert!(valid_voice_id(DEFAULT_VOICE));
        assert!(!valid_voice_id("../etc"));
        assert!(!valid_voice_id("abc"));
        assert!(!valid_voice_id("21m00Tcm4TlvDq8ik/WAM"));
    }

    #[test]
    fn the_voice_list_keeps_only_usable_entries() {
        let v = json!({ "voices": [
            { "voice_id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel", "category": "premade" },
            { "voice_id": "bad/id", "name": "Nope" },
            { "name": "No id" },
        ]});
        let list = parse_voices(&v);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Rachel");
    }

    #[test]
    fn multipart_carries_fields_then_the_file() {
        let body = multipart("B", &[("model", "m"), ("language", "es")], "voice.wav", "audio/wav", b"RIFF");
        let text = String::from_utf8_lossy(&body);
        assert!(text.starts_with("--B\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nm\r\n"));
        assert!(text.contains("name=\"file\"; filename=\"voice.wav\"\r\nContent-Type: audio/wav\r\n\r\nRIFF\r\n--B--"));
    }

    #[test]
    fn errors_say_which_service_spoke() {
        assert!(eleven_error(401, "{}").contains("ElevenLabs rechazó"));
        assert!(eleven_error(429, "{}").contains("límite"));
        assert!(stt_error(401, "{}").contains("Groq"));
        let quota = r#"{"detail":{"status":"quota_exceeded","message":"You have no credits left."}}"#;
        assert!(eleven_error(401, quota).contains("no credits left"));
    }
}
