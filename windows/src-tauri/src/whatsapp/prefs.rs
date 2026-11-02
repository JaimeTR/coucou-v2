// WhatsApp preferences live on the app's main Settings struct (settings.rs) — same
// persistence as every other non-secret setting, no separate file or save() of its own.
// `gateway` isn't here: Settings only ever tracks GOWA (settings.rs has no
// `whatsapp_gateway` field), so there is nothing to route through — the Tauri command that
// receives it (`whatsapp_save_gateway`) just ignores the value, keeping its signature intact
// for the frontend.

#[derive(Clone, Debug, Default)]
pub struct Prefs {
    pub enabled: bool,
    pub mute_groups: bool,
    pub mark_read_on_open: bool,
    pub port: u16,
    pub auto_start: bool,
    pub gowa_path: String,
    pub ignored: Vec<String>,
}

impl Prefs {
    pub fn cleaned(mut self) -> Self {
        self.ignored.sort_unstable();
        self.ignored.dedup();
        self
    }

    pub fn from_settings(s: &crate::settings::Settings) -> Self {
        Self {
            enabled: s.whatsapp_enabled,
            mute_groups: s.whatsapp_mute_groups,
            mark_read_on_open: s.whatsapp_mark_read_on_open,
            port: s.whatsapp_port,
            auto_start: s.whatsapp_auto_start,
            gowa_path: s.whatsapp_gowa_path.clone(),
            ignored: s.whatsapp_ignored.clone(),
        }
    }

    pub fn write_into(&self, s: &mut crate::settings::Settings) {
        s.whatsapp_enabled = self.enabled;
        s.whatsapp_mute_groups = self.mute_groups;
        s.whatsapp_mark_read_on_open = self.mark_read_on_open;
        s.whatsapp_port = self.port;
        s.whatsapp_auto_start = self.auto_start;
        s.whatsapp_gowa_path = self.gowa_path.clone();
        s.whatsapp_ignored = self.ignored.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleaned_sorts_and_dedupes_ignored() {
        let p = Prefs { ignored: vec!["b".into(), "a".into(), "a".into()], ..Default::default() };
        assert_eq!(p.cleaned().ignored, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn from_settings_and_write_into_round_trip() {
        let mut s = crate::settings::Settings::default();
        s.whatsapp_enabled = true;
        s.whatsapp_port = 9001;
        s.whatsapp_ignored = vec!["x@s.whatsapp.net".to_string()];
        let p = Prefs::from_settings(&s);
        assert_eq!(p.enabled, true);
        assert_eq!(p.port, 9001);

        let mut s2 = crate::settings::Settings::default();
        p.write_into(&mut s2);
        assert_eq!(s2.whatsapp_enabled, true);
        assert_eq!(s2.whatsapp_port, 9001);
        assert_eq!(s2.whatsapp_ignored, vec!["x@s.whatsapp.net".to_string()]);
    }
}
