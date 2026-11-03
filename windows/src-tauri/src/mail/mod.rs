// Mail (Thunderbird): a read-only pill over the user's local Thunderbird
// profile. Nothing is read until an account is in Settings' watched list
// (mail_watched_accounts); no network call is made for this feature at all.

pub mod direct;
pub mod index;
pub mod mbox;
pub mod otp;
pub mod profile;
pub mod watch;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

use mbox::MessageHeaders;
use profile::Account;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: String,
    pub label: String,
    pub folders: Vec<String>,
    /// Connected straight to the provider over IMAP (can be removed from Settings).
    #[serde(default)]
    pub direct: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageInfo {
    pub account: String,
    pub folder: String,
    pub offset: usize,
    pub len: usize,
    pub subject: String,
    pub from: String,
    pub date_rfc3339: String,
}

fn to_account_info(a: &Account) -> AccountInfo {
    AccountInfo { id: a.id.clone(), label: a.label.clone(), folders: a.folders.iter().map(|f| f.name.clone()).collect(), direct: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_account_info_keeps_only_folder_names() {
        let a = Account {
            id: "imap:x".into(),
            label: "x".into(),
            folders: vec![
                profile::Folder { name: "INBOX".into(), mbox_path: "/a/INBOX".into() },
                profile::Folder { name: "Sent".into(), mbox_path: "/a/Sent".into() },
            ],
        };
        let info = to_account_info(&a);
        assert_eq!(info.id, "imap:x");
        assert_eq!(info.folders, vec!["INBOX", "Sent"]);
    }

    #[test]
    fn require_watched_rejects_an_account_not_in_the_watched_list() {
        let watched = vec!["imap:a".to_string()];
        assert!(require_watched(&watched, "imap:a").is_ok());
        assert!(require_watched(&watched, "imap:b").is_err());
        assert!(require_watched(&[], "imap:a").is_err());
    }

    fn msg(day: u32, subject: &str) -> Vec<u8> {
        format!("From x Mon Oct {day:02} 09:00:00 2026\r\nSubject: {subject}\r\nDate: {day:02} Oct 2026 09:00:00 +0000\r\n\r\nbody\r\n").into_bytes()
    }

    fn indexed(messages: &[Vec<u8>]) -> index::FolderIndex {
        let mut idx = index::FolderIndex::new();
        index::rescan(&mut idx, &messages.concat());
        idx
    }

    #[test]
    fn list_is_newest_first_and_capped() {
        let mut indexes = Indexes::new();
        let many: Vec<_> = (0..MAX_RESULTS + 50).map(|i| msg(1 + (i % 28) as u32, &format!("m{i}"))).collect();
        indexes.insert(("a".into(), "INBOX".into()), indexed(&many));
        let out = list(&indexes, "a", "INBOX");
        assert_eq!(out.len(), MAX_RESULTS);
        assert_eq!(out[0].subject, format!("m{}", MAX_RESULTS + 49));
        assert!(list(&indexes, "a", "Never scanned").is_empty());
    }

    #[test]
    fn search_covers_only_watched_accounts_newest_date_first() {
        let mut indexes = Indexes::new();
        indexes.insert(("a".into(), "INBOX".into()), indexed(&[msg(3, "pago old")]));
        indexes.insert(("a".into(), "Archive".into()), indexed(&[msg(20, "pago new")]));
        indexes.insert(("b".into(), "INBOX".into()), indexed(&[msg(25, "pago other account")]));
        let out = search(&indexes, &["a".to_string()], "pago");
        let subjects: Vec<_> = out.iter().map(|m| m.subject.as_str()).collect();
        assert_eq!(subjects, vec!["pago new", "pago old"]);
    }

    #[test]
    fn read_range_reads_just_the_slice() {
        let path = std::env::temp_dir().join(format!("coucou-mail-range-{}", std::process::id()));
        std::fs::write(&path, b"0123456789").unwrap();
        assert_eq!(read_range(&path, 3, 4).unwrap(), b"3456");
        assert_eq!(read_range(&path, 8, 10).unwrap(), b"89");
        let _ = std::fs::remove_file(&path);
    }
}

/// One `FolderIndex` per (account id, folder name), kept for the life of the
/// app. Rebuilt from nothing at launch — see the privacy section of the spec.
/// Only the watcher (watch.rs) writes it; the commands below only read it.
#[derive(Default)]
pub struct MailState {
    indexes: Mutex<Indexes>,
}

type Indexes = HashMap<(String, String), index::FolderIndex>;

/// Newest this many messages per list or search: the reader builds one row
/// per message, a 40 000-message INBOX must not reach it whole.
const MAX_RESULTS: usize = 200;

fn profile_dir() -> Result<std::path::PathBuf, String> {
    let root = profile::thunderbird_root();
    profile::default_profile_dir(&root).ok_or_else(|| "No se encontró un perfil de Thunderbird.".to_string())
}

fn find_folder(account_id: &str, folder: &str) -> Result<profile::Folder, String> {
    let dir = profile_dir()?;
    let account = profile::accounts(&dir)
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| "Esa cuenta ya no está en Thunderbird.".to_string())?;
    account.folders.into_iter().find(|f| f.name == folder).ok_or_else(|| "Esa carpeta ya no existe.".to_string())
}

/// Every account-reading command routes through this: nothing is read for an
/// account the person hasn't explicitly added to Settings' watched list.
fn require_watched(watched: &[String], account: &str) -> Result<(), String> {
    if watched.iter().any(|w| w == account) {
        Ok(())
    } else {
        Err("Esa cuenta no está activada en Ajustes.".to_string())
    }
}

/// `len` bytes of `path` from `offset` on, without reading the rest of the
/// file (fewer when the file is shorter).
pub(crate) fn read_range(path: &std::path::Path, offset: usize, len: usize) -> std::io::Result<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(offset as u64))?;
    let mut out = Vec::with_capacity(len);
    file.take(len as u64).read_to_end(&mut out)?;
    Ok(out)
}

fn info(account: &str, folder: &str, h: &MessageHeaders) -> MessageInfo {
    MessageInfo {
        account: account.to_string(),
        folder: folder.to_string(),
        offset: h.offset,
        len: h.len,
        subject: h.subject.clone(),
        from: h.from.clone(),
        date_rfc3339: h.date_rfc3339.clone(),
    }
}

fn list(indexes: &Indexes, account: &str, folder: &str) -> Vec<MessageInfo> {
    let key = (account.to_string(), folder.to_string());
    indexes.get(&key).map(|idx| idx.messages().iter().take(MAX_RESULTS).map(|h| info(account, folder, h)).collect()).unwrap_or_default()
}

fn search(indexes: &Indexes, watched: &[String], query: &str) -> Vec<MessageInfo> {
    let mut hits: Vec<(&(String, String), &MessageHeaders)> = indexes
        .iter()
        .filter(|((account, _), _)| watched.contains(account))
        .flat_map(|(key, idx)| idx.search(query).into_iter().map(move |h| (key, h)))
        .collect();
    hits.sort_by(|a, b| b.1.timestamp.cmp(&a.1.timestamp));
    hits.into_iter().take(MAX_RESULTS).map(|((account, folder), h)| info(account, folder, h)).collect()
}

fn watched_accounts(app: &tauri::AppHandle) -> Vec<String> {
    app.state::<crate::Shared>().settings.lock().unwrap().mail_watched_accounts.clone()
}

/// Runs `f` on the blocking pool (same as lib.rs's now_playing/spotify):
/// these commands take the index lock, which the watcher can hold while it
/// indexes a big folder, and never on the main thread.
async fn off_main<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn mail_accounts(app: tauri::AppHandle) -> Result<Vec<AccountInfo>, String> {
    // Without Thunderbird the directly connected accounts are still listed.
    let mut out: Vec<AccountInfo> = profile_dir().map(|dir| profile::accounts(&dir).iter().map(to_account_info).collect()).unwrap_or_default();
    let direct_accounts = app.state::<crate::Shared>().settings.lock().unwrap().mail_imap_accounts.clone();
    out.extend(direct_accounts.iter().map(|a| AccountInfo {
        id: direct::account_id(&a.id),
        label: format!("{} ({})", a.label, a.user),
        folders: vec!["INBOX".into()],
        direct: true,
    }));
    if out.is_empty() {
        return Err("No se encontró un perfil de Thunderbird ni hay cuentas conectadas.".into());
    }
    Ok(out)
}

/// Read-only over what the watcher has already indexed: no file read here,
/// so a message mid-write is never cached truncated and a new message is
/// never "seen" before the watcher can alert on it. A folder the watcher
/// hasn't scanned yet (an account ticked in Settings a moment ago) lists
/// empty until its first stable poll, ~16 s later.
#[tauri::command]
pub async fn mail_list(app: tauri::AppHandle, account: String, folder: String) -> Result<Vec<MessageInfo>, String> {
    off_main(move || {
        require_watched(&watched_accounts(&app), &account)?;
        if account.starts_with(direct::PREFIX) {
            return Ok(direct::cached(&account).iter().take(MAX_RESULTS).map(|h| info(&account, "INBOX", h)).collect());
        }
        Ok(list(&app.state::<MailState>().indexes.lock().unwrap(), &account, &folder))
    })
    .await
}

/// Same read-only rule as `mail_list`, across every watched folder.
#[tauri::command]
pub async fn mail_search(app: tauri::AppHandle, query: String) -> Result<Vec<MessageInfo>, String> {
    off_main(move || {
        let watched = watched_accounts(&app);
        let mut hits = search(&app.state::<MailState>().indexes.lock().unwrap(), &watched, &query);
        let q = query.to_lowercase();
        let mut more: Vec<(MessageInfo, i64)> = direct::cached_all(&watched)
            .into_iter()
            .filter(|(_, h)| h.subject.to_lowercase().contains(&q) || h.from.to_lowercase().contains(&q))
            .map(|(a, h)| (info(&a, "INBOX", &h), h.timestamp))
            .collect();
        more.sort_by(|a, b| b.1.cmp(&a.1));
        hits.extend(more.into_iter().map(|(m, _)| m));
        hits.truncate(MAX_RESULTS);
        Ok(hits)
    })
    .await
}

#[tauri::command]
pub async fn mail_read(app: tauri::AppHandle, account: String, folder: String, offset: usize, len: usize) -> Result<String, String> {
    off_main(move || {
        require_watched(&watched_accounts(&app), &account)?;
        if account.starts_with(direct::PREFIX) {
            let acc = direct::find(&app, &account).ok_or("Esa cuenta ya no está conectada.")?;
            let pass = direct::password(&acc).ok_or("Falta la contraseña de esa cuenta.")?;
            return direct::read(&acc, &pass, offset);
        }
        let moved = || "Ese mensaje ya no está donde se esperaba.".to_string();
        offset.checked_add(len).ok_or_else(moved)?;
        let f = find_folder(&account, &folder)?;
        let raw = read_range(&f.mbox_path, offset, len).map_err(|e| e.to_string())?;
        if raw.len() != len {
            return Err(moved());
        }
        mbox::parse_body(&raw).ok_or_else(|| "No se pudo leer este mensaje.".to_string())
    })
    .await
}

/// Connects a mail account straight over IMAP (Gmail, Titan, any server). The login is
/// tried first; only a working account is kept, and its password goes to the credential
/// store. `preset` is "gmail", "titan" or anything else (then `host` and `port` count).
/// Watching it (the Settings toggle) is the front end's, like for the other accounts.
#[tauri::command]
pub async fn mail_imap_add(app: tauri::AppHandle, label: String, preset: String, host: String, port: u16, user: String, password: String) -> Result<AccountInfo, String> {
    off_main(move || {
        let (host, port) = match direct::preset(&preset) {
            Some((h, p)) => (h.to_string(), p),
            None => (host.trim().to_lowercase(), port),
        };
        let user = user.trim().to_string();
        if !direct::valid_host(&host) || port == 0 {
            return Err("El servidor o el puerto no son válidos.".into());
        }
        if user.is_empty() || user.len() > 120 || password.is_empty() {
            return Err("Falta el correo o la contraseña.".into());
        }
        let id = direct::slug(&user);
        if id.is_empty() {
            return Err("El correo no es válido.".into());
        }
        let label = if label.trim().is_empty() { preset_label(&preset, &host) } else { label.trim().chars().take(40).collect() };
        let acc = direct::ImapAccount { id: id.clone(), label: label.clone(), host, port, user: user.clone() };
        direct::check(&acc, &password)?;
        crate::secrets::set(&direct::secret_key(&id), &password)?;
        let shared = app.state::<crate::Shared>();
        let snapshot = {
            let mut s = shared.settings.lock().unwrap();
            s.mail_imap_accounts.retain(|a| a.id != id);
            s.mail_imap_accounts.push(acc);
            s.clone()
        };
        crate::settings::save(&snapshot).map_err(|e| e.to_string())?;
        Ok(AccountInfo { id: direct::account_id(&id), label: format!("{label} ({user})"), folders: vec!["INBOX".into()], direct: true })
    })
    .await
}

fn preset_label(preset: &str, host: &str) -> String {
    match preset {
        "gmail" => "Gmail".into(),
        "titan" => "Titan".into(),
        _ => host.to_string(),
    }
}

/// Forgets a directly connected account: its entry, its password and what was cached.
#[tauri::command]
pub async fn mail_imap_remove(app: tauri::AppHandle, account: String) -> Result<(), String> {
    off_main(move || {
        let Some(id) = account.strip_prefix(direct::PREFIX).map(str::to_string) else { return Ok(()) };
        let shared = app.state::<crate::Shared>();
        let snapshot = {
            let mut s = shared.settings.lock().unwrap();
            s.mail_imap_accounts.retain(|a| a.id != id);
            s.mail_watched_accounts.retain(|a| *a != account);
            s.clone()
        };
        let _ = crate::secrets::clear(&direct::secret_key(&id));
        direct::forget(&account);
        crate::settings::save(&snapshot).map_err(|e| e.to_string())
    })
    .await
}
