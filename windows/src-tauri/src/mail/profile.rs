// Finds the user's Thunderbird profile and lists what it has configured —
// never touches prefs.js beyond locating the default profile's folder, never
// reads mail content. Every function here takes a root path so tests run
// against a throwaway directory, never the developer's real profile.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Folder {
    pub name: String,
    pub mbox_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub label: String,
    pub folders: Vec<Folder>,
}

/// A dead-simple `profiles.ini` reader. Modern Thunderbird (and Firefox)
/// writes an `[InstallXXXXXXXX]` section whose own `Default=` is a *path*
/// (not a flag) to the profile that install actually uses — found on a real
/// machine to disagree with an older `[ProfileN]` section's `Default=1` flag
/// left over from a previous profile switch. The Install section wins when
/// present; the `[ProfileN]` flag search is the fallback for a profiles.ini
/// with no Install section at all (older Thunderbird, or a from-scratch test
/// fixture).
pub fn default_profile_dir(root: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(root.join("profiles.ini")).ok()?;
    let mut sections: Vec<(String, Vec<(String, String)>)> = Vec::new();
    let mut current: Option<(String, Vec<(String, String)>)> = None;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            if let Some(done) = current.take() {
                sections.push(done);
            }
            current = Some((line[1..line.len() - 1].to_string(), Vec::new()));
        } else if let Some((_, fields)) = current.as_mut() {
            if let Some((k, v)) = line.split_once('=') {
                fields.push((k.trim().to_string(), v.trim().to_string()));
            }
        }
    }
    if let Some(done) = current.take() {
        sections.push(done);
    }
    let get = |s: &[(String, String)], key: &str| s.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
    let resolve = |path: &str| -> Option<PathBuf> {
        let dir = if Path::new(path).is_absolute() { PathBuf::from(path) } else { root.join(path) };
        dir.is_dir().then_some(dir)
    };

    // An Install section's Default is a path straight to the profile, already
    // relative to root the same way a [ProfileN] section's Path is.
    if let Some(install_path) = sections
        .iter()
        .find(|(name, _)| name.starts_with("Install"))
        .and_then(|(_, fields)| get(fields, "Default"))
    {
        if let Some(dir) = resolve(&install_path) {
            return Some(dir);
        }
    }

    let chosen = sections
        .iter()
        .map(|(_, fields)| fields.as_slice())
        .find(|s| get(s, "Default").as_deref() == Some("1"))
        .or_else(|| sections.first().map(|(_, fields)| fields.as_slice()))?;
    let path = get(chosen, "Path")?;
    resolve(&path)
}

fn folders_in(dir: &Path) -> Vec<Folder> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // An mbox folder file has no extension; its sibling index does
        // (.msf) and so do a handful of Thunderbird bookkeeping files.
        if path.extension().is_some() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        out.push(Folder { name: name.to_string(), mbox_path: path.clone() });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Every IMAP account under `ImapMail/`, plus "Carpetas locales" if the
/// profile has any `Mail/Local Folders`. Accounts with no folders at all are
/// left out.
pub fn accounts(profile_dir: &Path) -> Vec<Account> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(profile_dir.join("ImapMail")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(server) = path.file_name().and_then(|n| n.to_str()) else { continue };
            let folders = folders_in(&path);
            if !folders.is_empty() {
                out.push(Account { id: format!("imap:{server}"), label: server.to_string(), folders });
            }
        }
    }
    let local = profile_dir.join("Mail").join("Local Folders");
    let local_folders = folders_in(&local);
    if !local_folders.is_empty() {
        out.push(Account { id: "local".into(), label: "Carpetas locales".into(), folders: local_folders });
    }
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

/// Where Thunderbird keeps its profiles on this platform.
pub fn thunderbird_root() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("Thunderbird")).unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(windows))]
    {
        crate::platform::home_dir().join(".thunderbird")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // One directory per test: cargo runs tests in parallel threads of one
    // process, so a shared pid-only name would let one test wipe another's
    // fixture mid-run.
    fn fixture_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("coucou-mail-profile-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_the_default_profile_from_profiles_ini() {
        let root = fixture_root("default-profile");
        fs::write(
            root.join("profiles.ini"),
            "[Profile0]\nName=default\nIsRelative=1\nPath=abc123.default-release\nDefault=1\n\n[Profile1]\nName=old\nIsRelative=1\nPath=zzz.old\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("abc123.default-release")).unwrap();
        let found = default_profile_dir(&root).unwrap();
        assert_eq!(found, root.join("abc123.default-release"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_install_sections_default_path_wins_over_a_stale_profile_default_flag() {
        // Reproduces a real profiles.ini found on a real machine: a modern
        // Install section points at the profile actually in use, while an
        // older [ProfileN] section still carries Default=1 from a previous
        // profile switch, pointing at a different (here: empty) profile.
        // Before this fix, the stale flag won and the real profile, with all
        // the mail in it, was never found.
        let root = fixture_root("install-section-wins");
        fs::write(
            root.join("profiles.ini"),
            "[Install4A6DE1A2C8832F76]\n\
             Default=Profiles/real.default-release\n\
             Locked=1\n\
             \n\
             [Profile1]\n\
             Name=default\n\
             IsRelative=1\n\
             Path=Profiles/empty.default\n\
             Default=1\n\
             \n\
             [Profile0]\n\
             Name=default-release\n\
             IsRelative=1\n\
             Path=Profiles/real.default-release\n\
             \n\
             [General]\n\
             StartWithLastProfile=1\n\
             Version=2\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("Profiles").join("real.default-release")).unwrap();
        fs::create_dir_all(root.join("Profiles").join("empty.default")).unwrap();
        let found = default_profile_dir(&root).unwrap();
        assert_eq!(found, root.join("Profiles").join("real.default-release"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn no_profiles_ini_means_no_profile_found() {
        let root = fixture_root("no-profiles-ini");
        assert_eq!(default_profile_dir(&root), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lists_imap_and_local_accounts_with_their_mbox_folders() {
        let root = fixture_root("imap-and-local");
        let imap = root.join("ImapMail").join("imap.example.com");
        fs::create_dir_all(&imap).unwrap();
        fs::write(imap.join("INBOX"), b"").unwrap();
        fs::write(imap.join("INBOX.msf"), b"").unwrap();
        fs::write(imap.join("Sent"), b"").unwrap();
        let local = root.join("Mail").join("Local Folders");
        fs::create_dir_all(&local).unwrap();
        fs::write(local.join("Trash"), b"").unwrap();

        let accounts = accounts(&root);
        let imap_account = accounts.iter().find(|a| a.id.contains("imap.example.com")).unwrap();
        let mut names: Vec<&str> = imap_account.folders.iter().map(|f| f.name.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["INBOX", "Sent"]);

        let local_account = accounts.iter().find(|a| a.label == "Carpetas locales").unwrap();
        assert_eq!(local_account.folders.len(), 1);
        assert_eq!(local_account.folders[0].name, "Trash");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_profile_with_no_mail_at_all_lists_no_accounts() {
        let root = fixture_root("no-mail");
        assert_eq!(accounts(&root), Vec::<Account>::new());
        let _ = fs::remove_dir_all(&root);
    }
}
