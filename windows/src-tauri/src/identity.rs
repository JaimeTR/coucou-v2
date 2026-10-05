// Who you are and what you use, so Coucou can greet you by name and help set
// itself up for the programs that are really on this computer.
//
// Nothing here leaves the machine: it reads the account's display name, the git
// identity and which tools are installed, and hands them to the settings window
// to be shown and edited. The name you type always wins over what was detected.

use std::process::Command;

use serde::Serialize;

use crate::platform;

/// Keeps what reads as a name — letters of any alphabet, spaces, hyphens and
/// apostrophes — and drops the rest. Git names often carry a flourish
/// ("Jaime Tarazona ✅"), and a name in a greeting should not.
pub fn clean_name(raw: &str) -> String {
    let kept: String = raw
        .chars()
        .filter(|c| c.is_alphabetic() || c.is_whitespace() || matches!(c, '-' | '\'' | '’' | '.'))
        .collect();
    kept.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The name to greet: the account's display name, else the git identity, else
/// the sign-in name made presentable. Empty only if all three are.
pub fn detect_user_name() -> String {
    if let Some(name) = platform::display_name() {
        let name = clean_name(&name);
        if !name.is_empty() {
            return name;
        }
    }
    let mut git = Command::new("git");
    git.args(["config", "--global", "user.name"]);
    if let Ok(out) = platform::no_console(&mut git).output() {
        let name = clean_name(&String::from_utf8_lossy(&out.stdout));
        if !name.is_empty() {
            return name;
        }
    }
    let login = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default();
    let login = clean_name(&login.replace(['.', '_'], " "));
    capitalise(&login)
}

fn capitalise(s: &str) -> String {
    s.split_whitespace()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub id: &'static str,
    pub name: &'static str,
    pub found: bool,
}

/// Which of the tools Coucou knows about are on this computer. A tool counts if
/// its command is on the PATH or it has left its settings folder in your profile.
pub fn detect_tools() -> Vec<Tool> {
    let home = platform::home_dir();
    let on_path = |cmd: &str| platform::find_on_path(cmd).is_some();
    let has_dir = |dir: &str| home.join(dir).is_dir();
    vec![
        Tool { id: "vscode", name: "VS Code", found: on_path("code") },
        Tool { id: "claude", name: "Claude Code", found: has_dir(".claude") || on_path("claude") },
        Tool { id: "git", name: "Git", found: on_path("git") },
        Tool { id: "docker", name: "Docker", found: on_path("docker") },
        Tool { id: "node", name: "Node.js", found: on_path("node") },
        Tool { id: "gemini", name: "Gemini CLI", found: has_dir(".gemini") || on_path("gemini") },
        Tool { id: "codex", name: "Codex", found: has_dir(".codex") || on_path("codex") },
        Tool { id: "cursor", name: "Cursor", found: has_dir(".cursor") || on_path("cursor") },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_git_flourish_does_not_end_up_in_the_greeting() {
        assert_eq!(clean_name("Jaime Tarazona ✅"), "Jaime Tarazona");
        assert_eq!(clean_name("  Jaime   Tarazona \r\n"), "Jaime Tarazona");
        assert_eq!(clean_name("María-José O'Brien"), "María-José O'Brien");
        assert_eq!(clean_name("🚀🚀"), "");
        assert_eq!(clean_name("jtarazona42"), "jtarazona");
    }

    #[test]
    fn a_sign_in_name_is_made_presentable() {
        assert_eq!(capitalise("jaime tarazona"), "Jaime Tarazona");
        assert_eq!(capitalise(""), "");
    }

    #[test]
    fn the_tool_list_is_stable() {
        let ids: Vec<_> = detect_tools().iter().map(|t| t.id).collect();
        assert_eq!(ids, ["vscode", "claude", "git", "docker", "node", "gemini", "codex", "cursor"]);
    }
}
