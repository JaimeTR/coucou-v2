// WhatsApp gateway link state and webhook event types.

use serde::Serialize;

/// The kind of gateway: GOWA or OpenWA.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum Kind {
    Gowa,
    OpenWa,
}

/// The current link state of the gateway.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum Link {
    /// Not linked yet; QR code must be scanned.
    NeedsQr { qr: String },
    /// Linked and ready.
    Connected { who: String },
}

/// An event received from the gateway webhook.
#[derive(Clone, Debug)]
pub enum WebhookEvent {
    Message {
        id: String,
        from: String,
        to: String,
        text: Option<String>,
        media: Option<String>,
        timestamp: u64,
    },
    StatusUpdate,
}