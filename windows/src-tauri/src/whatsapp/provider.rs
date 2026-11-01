// HTTP provider: calls to the local WhatsApp gateway (GOWA/OpenWA).

use reqwest::Client;

use super::model::Message;

/// Error from the WhatsApp provider.
#[derive(Clone, Debug)]
pub enum WaError {
    NotLinked,
    TooLong,
    TooFast,
    Unreachable,
    Unauthorized,
    NeedsQr,
    Refused { detail: String },
    Other { detail: String },
}

impl std::fmt::Display for WaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WaError::NotLinked => write!(f, "not linked"),
            WaError::TooLong => write!(f, "message too long"),
            WaError::TooFast => write!(f, "too fast"),
            WaError::Unreachable => write!(f, "gateway unreachable"),
            WaError::Unauthorized => write!(f, "unauthorized"),
            WaError::NeedsQr => write!(f, "needs QR"),
            WaError::Refused { detail } => write!(f, "refused: {detail}"),
            WaError::Other { detail } => write!(f, "error: {detail}"),
        }
    }
}

impl std::error::Error for WaError {}

/// The provider talks to the gateway over HTTP.
#[derive(Clone)]
pub struct Provider {
    client: Client,
    base_url: String,
    api_key: Option<String>,
}

impl Provider {
    pub fn new(base_url: String, api_key: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url,
            api_key,
        }
    }

    /// Send a message to a chat.
    pub async fn send(&self, _chat: &str, _text: &str) -> Result<(), WaError> {
        Err(WaError::NotLinked)
    }

    /// Check the gateway status (returns the linked phone number).
    pub async fn status(&self) -> Result<String, WaError> {
        Err(WaError::NotLinked)
    }
}