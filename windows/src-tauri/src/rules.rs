// "Always allow" rules: the permissions a person has said yes to for good.
//
// Only the list lives here (and on disk, next to the preferences). Deciding
// whether a request matches is the island's job, because it is the one holding
// the request; the logic is in src/island/rules.ts and is tested there.
//
// A rule is an explicit, revocable act: it is created by clicking "Always" on a
// permission card, it is visible in the settings window, and removing it puts
// the question back on the card the next time.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Plenty for a person, small enough that a runaway loop cannot fill the disk.
const MAX_RULES: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    /// The project folder the session runs in; the rule only applies there.
    pub project: String,
    pub tool: String,
    /// What the rule covers, in the tool's own terms (see rules.ts).
    pub pattern: String,
    /// The same thing in words, as shown on the card and in the settings.
    pub label: String,
    /// Unix seconds.
    pub created_at: u64,
}

#[derive(Default)]
pub struct Rules(Mutex<Vec<Rule>>);

fn path() -> PathBuf {
    crate::settings::config_dir().join("allow-rules.json")
}

/// A damaged or missing file is an empty list, never a crash: rules only ever
/// grant convenience, so losing them costs a click, not safety.
pub fn load() -> Rules {
    let rules = std::fs::read(path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<Rule>>(&bytes).ok())
        .unwrap_or_default();
    Rules(Mutex::new(rules))
}

fn save(rules: &[Rule]) -> Result<(), String> {
    let dir = crate::settings::config_dir();
    crate::platform::ensure_private_dir(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(rules).map_err(|e| e.to_string())?;
    // Beside the target, then renamed over it: a crash leaves the old list whole.
    let temp = dir.join(format!("allow-rules.json.{}", std::process::id()));
    std::fs::write(&temp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, path()).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        e.to_string()
    })
}

fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("r{now:x}-{:x}", N.fetch_add(1, Ordering::Relaxed))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Rules {
    pub fn list(&self) -> Vec<Rule> {
        self.0.lock().unwrap().clone()
    }

    /// Adds a rule, or hands back the identical one that is already there.
    pub fn add(
        &self,
        project: String,
        tool: String,
        pattern: String,
        label: String,
    ) -> Result<Rule, String> {
        if tool.is_empty() || tool.len() > 64 || pattern.is_empty() || pattern.len() > 400 {
            return Err("that rule isn't valid".into());
        }
        if project.len() > 500 || label.len() > 400 {
            return Err("that rule isn't valid".into());
        }
        let mut rules = self.0.lock().unwrap();
        if let Some(same) = rules
            .iter()
            .find(|r| r.project == project && r.tool == tool && r.pattern == pattern)
        {
            return Ok(same.clone());
        }
        if rules.len() >= MAX_RULES {
            return Err(format!("{MAX_RULES} rules is the limit — remove some in Settings first"));
        }
        let rule = Rule { id: new_id(), project, tool, pattern, label, created_at: now_secs() };
        let mut next = rules.clone();
        next.push(rule.clone());
        save(&next)?;
        *rules = next;
        Ok(rule)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut rules = self.0.lock().unwrap();
        let next: Vec<Rule> = rules.iter().filter(|r| r.id != id).cloned().collect();
        if next.len() == rules.len() {
            return Ok(());
        }
        save(&next)?;
        *rules = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(project: &str, tool: &str, pattern: &str) -> (String, String, String, String) {
        (project.into(), tool.into(), pattern.into(), "label".into())
    }

    #[test]
    fn add_remove_and_dedupe_without_touching_the_disk_format() {
        // `Rules` is exercised through the same methods the commands call, with
        // the config dir pointed at a temp folder (process-wide, so one test).
        let tmp = std::env::temp_dir().join(format!("coucou-rules-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        #[cfg(windows)]
        std::env::set_var("APPDATA", &tmp);
        #[cfg(not(windows))]
        std::env::set_var("XDG_CONFIG_HOME", &tmp);

        let rules = load();
        assert!(rules.list().is_empty());

        let (p, t, pat, l) = rule("C:/p", "Bash", "git status");
        let first = rules.add(p.clone(), t.clone(), pat.clone(), l.clone()).unwrap();
        let again = rules.add(p, t, pat, l).unwrap();
        assert_eq!(first.id, again.id, "the same rule must not be added twice");
        assert_eq!(rules.list().len(), 1);

        // It survives a restart.
        assert_eq!(load().list().len(), 1);

        // Invalid rules are refused.
        assert!(rules.add("C:/p".into(), "".into(), "x".into(), "".into()).is_err());
        assert!(rules.add("C:/p".into(), "Bash".into(), "".into(), "".into()).is_err());

        rules.remove(&first.id).unwrap();
        assert!(rules.list().is_empty());
        assert!(load().list().is_empty());
        // Removing what is not there is not an error.
        rules.remove("nope").unwrap();

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
