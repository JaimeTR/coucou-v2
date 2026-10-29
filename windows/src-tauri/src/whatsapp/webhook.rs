// Webhook listener: receives new messages from the gateway on a local HTTP endpoint.

use super::gateway::WebhookEvent;

pub struct Listener;

impl Listener {
    pub fn new() -> Self {
        Self
    }

    pub async fn start(&self) -> Result<(), String> {
        Err("webhook listener not yet implemented".into())
    }

    pub fn on_event(&self, _event: WebhookEvent) {
        // Handled by the caller.
    }
}