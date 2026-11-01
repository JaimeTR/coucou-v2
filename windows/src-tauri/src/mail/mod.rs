// Mail (Thunderbird): a read-only pill over the user's local Thunderbird
// profile. Nothing is read until an account is in Settings' watched list
// (mail_watched_accounts); no network call is made for this feature at all.

pub mod index;
pub mod mbox;
pub mod otp;
pub mod profile;

use serde::Serialize;
use std::sync::Mutex;

use profile::Account;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: String,
    pub label: String,
    pub folders: Vec<String>,
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
    AccountInfo { id: a.id.clone(), label: a.label.clone(), folders: a.folders.iter().map(|f| f.name.clone()).collect() }
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
}

/// One `FolderIndex` per (account id, folder name), kept for the life of the
/// app. Rebuilt from nothing at launch — see the privacy section of the spec.
#[derive(Default)]
pub struct MailState {
    indexes: Mutex<std::collections::HashMap<(String, String), index::FolderIndex>>,
}

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

#[tauri::command]
pub fn mail_accounts() -> Result<Vec<AccountInfo>, String> {
    let dir = profile_dir()?;
    Ok(profile::accounts(&dir).iter().map(to_account_info).collect())
}

#[tauri::command]
pub fn mail_list(
    state: tauri::State<MailState>,
    shared: tauri::State<crate::Shared>,
    account: String,
    folder: String,
) -> Result<Vec<MessageInfo>, String> {
    let watched = shared.settings.lock().unwrap().mail_watched_accounts.clone();
    require_watched(&watched, &account)?;
    let f = find_folder(&account, &folder)?;
    let bytes = std::fs::read(&f.mbox_path).map_err(|e| e.to_string())?;
    let mut indexes = state.indexes.lock().unwrap();
    let idx = indexes.entry((account.clone(), folder.clone())).or_insert_with(index::FolderIndex::new);
    index::rescan(idx, &bytes);
    Ok(idx
        .messages()
        .iter()
        .map(|h| MessageInfo {
            account: account.clone(),
            folder: folder.clone(),
            offset: h.offset,
            len: h.len,
            subject: h.subject.clone(),
            from: h.from.clone(),
            date_rfc3339: h.date_rfc3339.clone(),
        })
        .collect())
}

#[tauri::command]
pub fn mail_search(state: tauri::State<MailState>, settings: tauri::State<crate::Shared>, query: String) -> Result<Vec<MessageInfo>, String> {
    let watched = settings.settings.lock().unwrap().mail_watched_accounts.clone();
    let dir = profile_dir()?;
    let mut out = Vec::new();
    let mut indexes = state.indexes.lock().unwrap();
    for account in profile::accounts(&dir).into_iter().filter(|a| watched.contains(&a.id)) {
        for folder in &account.folders {
            let Ok(bytes) = std::fs::read(&folder.mbox_path) else { continue };
            let idx = indexes.entry((account.id.clone(), folder.name.clone())).or_insert_with(index::FolderIndex::new);
            index::rescan(idx, &bytes);
            for h in idx.search(&query) {
                out.push(MessageInfo {
                    account: account.id.clone(),
                    folder: folder.name.clone(),
                    offset: h.offset,
                    len: h.len,
                    subject: h.subject.clone(),
                    from: h.from.clone(),
                    date_rfc3339: h.date_rfc3339.clone(),
                });
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn mail_read(account: String, folder: String, offset: usize, len: usize) -> Result<String, String> {
    let f = find_folder(&account, &folder)?;
    let bytes = std::fs::read(&f.mbox_path).map_err(|e| e.to_string())?;
    let raw = bytes.get(offset..offset + len).ok_or("Ese mensaje ya no está donde se esperaba.")?;
    mbox::parse_body(raw).ok_or_else(|| "No se pudo leer este mensaje.".to_string())
}

#[tauri::command]
pub fn mail_set_watched(shared: tauri::State<crate::Shared>, accounts: Vec<String>) -> Result<(), String> {
    let mut s = shared.settings.lock().unwrap();
    s.mail_watched_accounts = accounts;
    crate::settings::save(&s).map_err(|e| e.to_string())
}
