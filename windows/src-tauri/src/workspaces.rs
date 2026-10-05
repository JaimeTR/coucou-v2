// The projects behind the Claude Code and VS Code pills.
//
//   Claude Code  ~/.claude/projects/<encoded path>/ (one folder per project, so its
//                modification time is "last used") plus ~/.claude.json, whose
//                `projects` keys are the real paths those folder names encode.
//   VS Code      %APPDATA%\Code\User\globalStorage\storage.json: the workspace of
//                the last active window and every workspace it has opened.
//
// Read-only and local: only project paths are taken from those files, nothing
// else is read out of them, and nothing is written or sent anywhere.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;

use crate::platform;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    /// The folder's own name, which is what a person calls the project.
    pub name: String,
    pub path: String,
    /// Unix seconds; 0 when unknown.
    pub last_active: u64,
}

fn project_of(path: &Path, last_active: u64) -> Option<Project> {
    let name = path.file_name()?.to_string_lossy().to_string();
    (!name.is_empty()).then(|| Project { name, path: path.to_string_lossy().to_string(), last_active })
}

fn modified_secs(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// How Claude Code names a project's folder: every character that is not an
/// ASCII letter or digit becomes `-` (`C:\Users\me\app` → `C--Users-me-app`).
pub fn encode_claude_dir(path: &str) -> String {
    path.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// `file:///c%3A/Users/me/app` → `c:/Users/me/app`. Only `file:` URIs count.
pub fn decode_file_uri(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file:///")?;
    let mut bytes = Vec::with_capacity(rest.len());
    let raw = rest.as_bytes();
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' {
            // Two hex digits must follow; a truncated escape is not a path.
            if i + 2 >= raw.len() {
                return None;
            }
            let hex = std::str::from_utf8(&raw[i + 1..i + 3]).ok()?;
            bytes.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            bytes.push(raw[i]);
            i += 1;
        }
    }
    let path = String::from_utf8(bytes).ok()?;
    // A drive path keeps no leading slash; a Unix one needs it back.
    let is_drive = path.len() >= 2 && path.as_bytes()[1] == b':';
    Some(if is_drive { path } else { format!("/{path}") })
}

/// Same project, different capitalisation (Windows): keep one.
fn dedupe(mut projects: Vec<Project>) -> Vec<Project> {
    let mut seen = std::collections::HashSet::new();
    projects.retain(|p| seen.insert(p.path.replace('\\', "/").to_lowercase()));
    projects
}

/// Claude Code's recent projects, newest first.
pub fn claude_projects(limit: usize) -> Vec<Project> {
    let home = platform::home_dir();
    // encoded folder name → the real path, from the keys of ~/.claude.json
    let mut known: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Ok(bytes) = std::fs::read(home.join(".claude.json")) {
        if let Ok(Value::Object(root)) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(Value::Object(projects)) = root.get("projects") {
                for path in projects.keys() {
                    known.insert(encode_claude_dir(path).to_lowercase(), path.clone());
                }
            }
        }
    }

    let mut found: Vec<Project> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(home.join(".claude").join("projects")) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let encoded = entry.file_name().to_string_lossy().to_lowercase();
            // A folder whose real path we cannot recover is skipped: guessing it
            // back from the dashes would be wrong as often as right.
            let Some(real) = known.get(&encoded) else { continue };
            let real = PathBuf::from(real);
            if !real.is_dir() {
                continue; // the project was moved or deleted
            }
            if let Some(p) = project_of(&real, modified_secs(&entry.path())) {
                found.push(p);
            }
        }
    }
    found.sort_by(|a, b| b.last_active.cmp(&a.last_active));
    let mut found = dedupe(found);
    found.truncate(limit);
    found
}

/// The workspace folders VS Code has open or has opened, most recent first.
pub fn vscode_projects(limit: usize) -> Vec<Project> {
    let storage = platform::vscode_storage_path();
    let Ok(bytes) = std::fs::read(&storage) else { return Vec::new() };
    let Ok(root) = serde_json::from_slice::<Value>(&bytes) else { return Vec::new() };

    let mut uris: Vec<String> = Vec::new();
    // The window you used last comes first.
    if let Some(folder) = root
        .pointer("/windowsState/lastActiveWindow/folder")
        .and_then(Value::as_str)
    {
        uris.push(folder.to_string());
    }
    if let Some(Value::Array(windows)) = root.pointer("/windowsState/openedWindows") {
        uris.extend(windows.iter().filter_map(|w| w.get("folder").and_then(Value::as_str)).map(str::to_string));
    }
    if let Some(Value::Object(workspaces)) = root.pointer("/profileAssociations/workspaces") {
        uris.extend(workspaces.keys().cloned());
    }

    let mut projects: Vec<Project> = Vec::new();
    for (rank, uri) in uris.iter().enumerate() {
        let Some(path) = decode_file_uri(uri) else { continue };
        let path = PathBuf::from(path);
        // Folders only: a .code-workspace file or a remote workspace is not one.
        if !path.is_dir() {
            continue;
        }
        // The first entries are the ones VS Code itself marked as active.
        let recency = if rank == 0 { u64::MAX } else { modified_secs(&path) };
        if let Some(p) = project_of(&path, recency) {
            projects.push(p);
        }
    }
    projects.sort_by(|a, b| b.last_active.cmp(&a.last_active));
    let mut projects = dedupe(projects);
    projects.truncate(limit);
    // `u64::MAX` was only for ordering; show the folder's real time.
    for p in &mut projects {
        if p.last_active == u64::MAX {
            p.last_active = modified_secs(Path::new(&p.path));
        }
    }
    projects
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_folder_names_follow_the_documented_encoding() {
        assert_eq!(
            encode_claude_dir(r"C:\Users\jaime\OneDrive\Documentos\GitHub\coucou"),
            "C--Users-jaime-OneDrive-Documentos-GitHub-coucou"
        );
        assert_eq!(encode_claude_dir("/home/me/my app"), "-home-me-my-app");
    }

    #[test]
    fn vscode_uris_become_paths() {
        assert_eq!(
            decode_file_uri("file:///c%3A/Users/jaime/OneDrive/Documentos/GitHub/breezelingo").unwrap(),
            "c:/Users/jaime/OneDrive/Documentos/GitHub/breezelingo"
        );
        assert_eq!(decode_file_uri("file:///home/me/my%20app").unwrap(), "/home/me/my app");
        assert!(decode_file_uri("vscode-remote://ssh-remote+x/home/me").is_none());
        // A truncated escape is refused, not misread.
        assert!(decode_file_uri("file:///c%3").is_none());
        assert!(decode_file_uri("file:///c%ZZ/x").is_none());
    }

    /// Not run by default: lists the projects found on THIS computer.
    /// `cargo test -p coucou show_real_projects -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn show_real_projects() {
        for (title, list) in [("Claude Code", claude_projects(8)), ("VS Code", vscode_projects(8))] {
            println!("=== {title}");
            for p in list {
                println!("  {:<28} {}  (last active {})", p.name, p.path, p.last_active);
            }
        }
    }

    #[test]
    fn the_same_project_in_two_spellings_is_listed_once() {
        let a = Project { name: "app".into(), path: r"C:\Users\me\app".into(), last_active: 5 };
        let b = Project { name: "app".into(), path: "c:/users/me/app".into(), last_active: 3 };
        let c = Project { name: "other".into(), path: "c:/users/me/other".into(), last_active: 1 };
        let list = dedupe(vec![a.clone(), b, c.clone()]);
        assert_eq!(list, vec![a, c]);
    }
}
