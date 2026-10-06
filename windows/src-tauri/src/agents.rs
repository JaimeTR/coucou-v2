// Other agents next to Claude Code: Gemini CLI, OpenCode and VS Code's terminal.
//
// Each one reports through the same relay (`coucou-hook --agent <name>`), which
// is how its pill learns what it is doing. What differs is how each tool is told
// to call it:
//
//   Gemini CLI   hooks merged into ~/.gemini/settings.json
//   OpenCode     a plugin of ours, ~/.config/opencode/plugins/coucou.js
//   VS Code      a marked block in the PowerShell profile(s) that, inside VS Code's
//                integrated terminal only, reports commands that took a while
//
// The rule is the one for ~/.claude/settings.json, to the letter: read the file,
// show the exact diff, take a dated backup, write only after a click, and refuse
// to write over a file that changed since the diff was shown. Uninstalling removes
// Coucou's part and nothing else.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::{json, Value};

use crate::hooks::{self, HookPreview};
use crate::{platform, settings};

pub const GEMINI: &str = "gemini";
pub const OPENCODE: &str = "opencode";
pub const VSCODE: &str = "vscode";

/// Markers for the files and blocks that are ours. (Gemini's hook entries are
/// recognised the same way as Claude's: by the relay's name in the command.)
const PROFILE_START: &str = "# >>> coucou >>>";
const PROFILE_END: &str = "# <<< coucou <<<";
const PLUGIN_MARKER: &str = "// coucou-managed";

/// Gemini CLI's hook events (the relay renames them for the island). Timeout is
/// in milliseconds there, and the relay answers well inside it.
const GEMINI_EVENTS: &[&str] = &[
    "SessionStart", "SessionEnd", "BeforeAgent", "AfterAgent", "BeforeTool", "AfterTool", "Notification",
];
const GEMINI_TIMEOUT_MS: u64 = 3000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub id: &'static str,
    pub name: &'static str,
    /// The tool is on this computer (so connecting it makes sense).
    pub detected: bool,
    /// Coucou's part is in place.
    pub installed: bool,
    /// What gets changed, for the person to read.
    pub target: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    GeminiSettings,
    OpenCodePlugin,
    PowerShellProfile,
}

struct Target {
    path: PathBuf,
    kind: Kind,
}

/// What a file holds. `None` text means the file is not there.
#[derive(Clone, PartialEq)]
struct Content {
    text: Option<String>,
    bom: bool,
}

fn exe() -> String {
    settings::hook_exe_path().to_string_lossy().replace('\\', "/")
}

fn home() -> PathBuf {
    platform::home_dir()
}

// ── Where each agent keeps its settings ───────────────────────────────────────

/// `$PROFILE.CurrentUserCurrentHost` of one PowerShell, asked of the shell itself:
/// Documents is often redirected (OneDrive), so guessing the path would be wrong.
fn profile_of(shell: &Path) -> Option<PathBuf> {
    let mut cmd = Command::new(shell);
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", "$PROFILE.CurrentUserCurrentHost"]);
    let out = platform::no_console(&mut cmd).output().ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !path.is_empty()).then(|| PathBuf::from(path))
}

fn powershell_profiles() -> Vec<PathBuf> {
    let mut shells: Vec<PathBuf> = Vec::new();
    if let Some(pwsh) = platform::find_on_path("pwsh") {
        shells.push(pwsh);
    }
    #[cfg(windows)]
    {
        let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| "C:\\Windows".into());
        let legacy = system.join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe");
        if legacy.is_file() {
            shells.push(legacy);
        }
    }
    let mut paths: Vec<PathBuf> = Vec::new();
    for shell in shells {
        if let Some(p) = profile_of(&shell) {
            if !paths.contains(&p) {
                paths.push(p);
            }
        }
    }
    paths
}

fn targets(id: &str) -> Result<Vec<Target>, String> {
    match id {
        GEMINI => Ok(vec![Target { path: home().join(".gemini").join("settings.json"), kind: Kind::GeminiSettings }]),
        OPENCODE => Ok(vec![Target {
            path: home().join(".config").join("opencode").join("plugins").join("coucou.js"),
            kind: Kind::OpenCodePlugin,
        }]),
        VSCODE => {
            let profiles = powershell_profiles();
            if profiles.is_empty() {
                return Err("No se encontró PowerShell, así que no hay perfil al que añadir Coucou.".into());
            }
            Ok(profiles.into_iter().map(|path| Target { path, kind: Kind::PowerShellProfile }).collect())
        }
        other => Err(format!("agente desconocido {other}")),
    }
}

fn read(path: &Path) -> Result<Content, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            let (bytes, bom) = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
                Some(rest) => (rest.to_vec(), true),
                None => (bytes, false),
            };
            // Anything that is not UTF-8 (a profile saved as ANSI, say) is left
            // alone: converting it could silently change what is in there.
            let text = String::from_utf8(bytes)
                .map_err(|_| format!("{} no es texto UTF-8: Coucou no lo tocará.", path.display()))?;
            Ok(Content { text: Some(text), bom })
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Content { text: None, bom: false }),
        Err(err) => Err(format!("No se puede leer {}: {err}", path.display())),
    }
}

// ── What goes in ──────────────────────────────────────────────────────────────

fn gemini_command(event: &str) -> String {
    format!("\"{}\" --agent gemini --stdout-json {event}", exe())
}

fn gemini_merged(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut hooks = root.get("hooks").and_then(Value::as_object).cloned().unwrap_or_default();
    for event in GEMINI_EVENTS {
        let mut list = hooks.get(*event).and_then(Value::as_array).cloned().unwrap_or_default();
        list.retain(|entry| !hooks::entry_is_ours(entry));
        list.push(json!({
            "hooks": [{
                "name": "coucou",
                "type": "command",
                "command": gemini_command(event),
                "timeout": GEMINI_TIMEOUT_MS,
            }]
        }));
        hooks.insert((*event).to_string(), Value::Array(list));
    }
    root.insert("hooks".into(), Value::Object(hooks));
    Value::Object(root)
}

/// The OpenCode plugin. It renames OpenCode's events and tools to the ones the
/// island knows, and hands each to the relay without waiting: Coucou must never
/// slow OpenCode down or break it, so every failure is swallowed.
fn plugin_source() -> String {
    format!(
        r#"{PLUGIN_MARKER} — escrito por Coucou (Ajustes → Agentes). Usa Desconectar allí, o borra este archivo, para quitarlo.
const HOOK = {hook};

const TOOLS = {{
  bash: "Bash", edit: "Edit", write: "Write", read: "Read", glob: "Glob",
  grep: "Grep", list: "LS", webfetch: "WebFetch", task: "Task", todowrite: "TodoWrite", patch: "Edit",
}};

function send(event, body) {{
  try {{
    const payload = JSON.stringify({{ hook_event_name: event, ...body }});
    const child = Bun.spawn([HOOK, "--agent", "opencode", event], {{
      stdin: new Blob([payload]),
      stdout: "ignore",
      stderr: "ignore",
    }});
    child.unref?.();
  }} catch (_) {{
    /* Coucou closed, or not installed any more: nothing to tell */
  }}
}}

function toolInput(tool, args) {{
  const a = args ?? {{}};
  switch (tool) {{
    case "bash": return {{ command: a.command }};
    case "edit": return {{ file_path: a.filePath, old_string: a.oldString, new_string: a.newString }};
    case "write": return {{ file_path: a.filePath, content: a.content }};
    case "read": return {{ file_path: a.filePath }};
    case "glob": return {{ pattern: a.pattern, path: a.path }};
    case "grep": return {{ pattern: a.pattern, path: a.path }};
    case "webfetch": return {{ url: a.url }};
    default: return a;
  }}
}}

export const CoucouPlugin = async ({{ directory }}) => {{
  const cwd = directory;
  return {{
    event: async ({{ event }}) => {{
      const p = event.properties ?? {{}};
      const session_id = p.sessionID ?? p.info?.id ?? "opencode";
      switch (event.type) {{
        case "session.created": send("SessionStart", {{ session_id, cwd }}); break;
        case "session.idle": send("Stop", {{ session_id, cwd }}); break;
        case "session.error": send("StopFailure", {{ session_id, cwd }}); break;
        case "session.deleted": send("SessionEnd", {{ session_id, cwd }}); break;
        case "permission.asked":
        case "permission.updated":
          send("Notification", {{ session_id, cwd, message: `¿Permiso para ${{p.title ?? p.type ?? "una herramienta"}}?` }});
          break;
      }}
    }},
    "chat.message": async (input, output) => {{
      const prompt = (output?.parts ?? []).filter((x) => x.type === "text").map((x) => x.text).join(" ");
      send("UserPromptSubmit", {{ session_id: input.sessionID, cwd, prompt }});
    }},
    "tool.execute.before": async (input, output) => {{
      send("PreToolUse", {{
        session_id: input.sessionID, cwd,
        tool_name: TOOLS[input.tool] ?? input.tool,
        tool_input: toolInput(input.tool, output?.args),
      }});
    }},
    "tool.execute.after": async (input) => {{
      send("PostToolUse", {{
        session_id: input.sessionID, cwd,
        tool_name: TOOLS[input.tool] ?? input.tool,
        tool_input: toolInput(input.tool, input.args),
      }});
    }},
  }};
}};
"#,
        hook = serde_json::to_string(&exe()).unwrap_or_else(|_| "\"\"".into()),
    )
}

/// The PowerShell profile block. ASCII only, so Windows PowerShell 5.1 reads it
/// the same as PowerShell 7 whatever the file's encoding. It wraps the prompt
/// function: when a command that took `CoucouMinSeconds` or more has finished,
/// the relay is told, and the VS Code pill (and a toast) says so. It only wraps
/// the prompt inside VS Code's own terminal (`TERM_PROGRAM=vscode`): every other
/// terminal keeps its prompt exactly as it was.
fn profile_block(eol: &str) -> String {
    let hook = exe().replace('\'', "''");
    let body = format!(
        r#"{PROFILE_START}
# Gestionado por Coucou (Ajustes > Agentes). Solo en la terminal de VS Code: avisa a Coucou cuando termina un comando largo.
# Usa Desconectar, o borra este bloque, para deshacerlo.
$global:CoucouHook = '{hook}'
$global:CoucouMinSeconds = 10
if ($env:TERM_PROGRAM -eq 'vscode' -and (Test-Path -LiteralPath $global:CoucouHook) -and -not $global:CoucouWrapped) {{
  $global:CoucouWrapped = $true
  $global:CoucouLastId = -1
  $global:CoucouPrompt = $function:prompt
  function global:prompt {{
    $coucouOk = $global:?
    try {{
      $h = Get-History -Count 1
      if ($h -and $h.Id -ne $global:CoucouLastId) {{
        $global:CoucouLastId = $h.Id
        $secs = ($h.EndExecutionTime - $h.StartExecutionTime).TotalSeconds
        if ($secs -ge $global:CoucouMinSeconds) {{
          $name = if ($coucouOk) {{ 'Stop' }} else {{ 'StopFailure' }}
          $state = if ($coucouOk) {{ 'bien' }} else {{ 'fallo' }}
          $text = ($h.CommandLine -replace '\s+', ' ')
          if ($text.Length -gt 60) {{ $text = $text.Substring(0, 60) + '...' }}
          @{{ hook_event_name = $name; session_id = "pwsh-$PID"; cwd = (Get-Location).Path
             message = "$text - $state ($([int]$secs)s)" }} | ConvertTo-Json -Compress |
            & $global:CoucouHook --agent vscode $name | Out-Null
        }}
      }}
    }} catch {{ }}
    & $global:CoucouPrompt
  }}
}}
{PROFILE_END}"#
    );
    body.replace("\r\n", "\n").replace('\n', eol)
}

// ── Putting it in, and taking it out ──────────────────────────────────────────

/// Profile text with Coucou's block taken out (everything else byte for byte).
fn without_block(text: &str) -> String {
    let (Some(start), Some(end)) = (text.find(PROFILE_START), text.find(PROFILE_END)) else {
        return text.to_string();
    };
    if end < start {
        return text.to_string();
    }
    let mut after = &text[end + PROFILE_END.len()..];
    // The line break that ended the block goes with it.
    after = after.strip_prefix("\r\n").or_else(|| after.strip_prefix('\n')).unwrap_or(after);
    let before = text[..start].trim_end_matches([' ', '\t']);
    format!("{before}{after}")
}

/// The file as it should be after installing or uninstalling, or None when it
/// should not exist at all.
fn render(kind: Kind, install: bool, path: &Path, current: &Content) -> Result<Option<String>, String> {
    match kind {
        Kind::GeminiSettings => {
            let existing = hooks::parse_settings(
                current.text.as_deref().unwrap_or("").as_bytes(),
                &path.display().to_string(),
            )?;
            if !install && current.text.is_none() {
                return Ok(None);
            }
            let next = if install { gemini_merged(&existing) } else { hooks::without_ours(&existing) };
            let mut text = hooks::pretty(&next);
            text.push('\n');
            Ok(Some(text))
        }
        Kind::OpenCodePlugin => match (&current.text, install) {
            // A file of that name that is not ours stays untouched.
            (Some(text), _) if !text.contains(PLUGIN_MARKER) => Err(format!(
                "{} ya existe y no es de Coucou. Renómbralo o quítalo primero.",
                path.display()
            )),
            (_, true) => Ok(Some(plugin_source())),
            (_, false) => Ok(None),
        },
        Kind::PowerShellProfile => {
            let text = current.text.clone().unwrap_or_default();
            let clean = without_block(&text);
            if !install {
                return Ok(Some(clean));
            }
            let eol = if text.contains("\r\n") { "\r\n" } else if text.is_empty() { "\r\n" } else { "\n" };
            let mut out = clean;
            if !out.is_empty() && !out.ends_with('\n') {
                out.push_str(eol);
            }
            if !out.is_empty() {
                out.push_str(eol);
            }
            out.push_str(&profile_block(eol));
            out.push_str(eol);
            Ok(Some(out))
        }
    }
}

fn is_installed(kind: Kind, text: &str) -> bool {
    match kind {
        Kind::GeminiSettings => serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|v| v.get("hooks").cloned())
            .and_then(|h| h.as_object().cloned())
            .map(|h| h.values().filter_map(Value::as_array).flatten().any(|e| hooks::entry_is_ours(e)))
            .unwrap_or(false),
        Kind::OpenCodePlugin => text.contains(PLUGIN_MARKER),
        Kind::PowerShellProfile => text.contains(PROFILE_START) && text.contains(PROFILE_END),
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn status() -> Vec<AgentStatus> {
    let home = home();
    let on_path = |c: &str| platform::find_on_path(c).is_some();
    let installed = |id: &str| -> bool {
        targets(id)
            .map(|ts| {
                ts.iter().any(|t| {
                    read(&t.path).ok().and_then(|c| c.text).map(|text| is_installed(t.kind, &text)).unwrap_or(false)
                })
            })
            .unwrap_or(false)
    };
    vec![
        AgentStatus {
            id: GEMINI,
            name: "Gemini CLI",
            detected: home.join(".gemini").is_dir() || on_path("gemini"),
            installed: installed(GEMINI),
            target: home.join(".gemini").join("settings.json").to_string_lossy().to_string(),
        },
        AgentStatus {
            id: OPENCODE,
            name: "OpenCode",
            detected: home.join(".config").join("opencode").is_dir() || on_path("opencode"),
            installed: installed(OPENCODE),
            target: home.join(".config").join("opencode").join("plugins").join("coucou.js").to_string_lossy().to_string(),
        },
        AgentStatus {
            id: VSCODE,
            name: "VS Code",
            detected: on_path("code") || platform::vscode_storage_path().exists(),
            installed: installed(VSCODE),
            target: "tu perfil de PowerShell (solo la terminal de VS Code)".into(),
        },
    ]
}

/// The state of every target, which is what the preview was computed from.
fn snapshot(ts: &[Target]) -> Result<Vec<Content>, String> {
    ts.iter().map(|t| read(&t.path)).collect()
}

fn fingerprint_of(ts: &[Target], contents: &[Content]) -> String {
    let mut all = Vec::new();
    for (t, c) in ts.iter().zip(contents) {
        all.extend_from_slice(t.path.to_string_lossy().as_bytes());
        all.push(0);
        all.extend_from_slice(c.text.as_deref().unwrap_or("\u{0}missing").as_bytes());
        all.push(0);
    }
    hooks::fingerprint(&all)
}

fn backup_of(path: &Path) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    path.with_file_name(format!("{name}.bak-{}", hooks::stamp()))
}

pub fn preview(id: &str, install: bool) -> Result<HookPreview, String> {
    let ts = targets(id)?;
    let contents = snapshot(&ts)?;
    let mut diff = String::new();
    let mut backups: Vec<String> = Vec::new();
    for (t, current) in ts.iter().zip(&contents) {
        let next = render(t.kind, install, &t.path, current)?;
        let before = current.text.clone().unwrap_or_default();
        let after = next.clone().unwrap_or_default();
        diff.push_str(&format!("── {}\n", t.path.display()));
        if next == current.text {
            diff.push_str("Sin cambios.\n\n");
            continue;
        }
        diff.push_str(&hooks::unified_diff(&before, &after));
        diff.push('\n');
        if current.text.is_some() {
            backups.push(backup_of(&t.path).to_string_lossy().to_string());
        }
    }
    Ok(HookPreview {
        diff,
        backup: if backups.is_empty() { "no hay nada que respaldar (archivo nuevo)".into() } else { backups.join("  ·  ") },
        settings_path: ts.iter().map(|t| t.path.to_string_lossy().to_string()).collect::<Vec<_>>().join("  ·  "),
        fingerprint: fingerprint_of(&ts, &contents),
    })
}

/// Writes (or removes) what the preview showed — only if nothing changed since.
pub fn write(id: &str, install: bool, fingerprint: &str) -> Result<String, String> {
    let ts = targets(id)?;
    let contents = snapshot(&ts)?;
    if fingerprint_of(&ts, &contents) != fingerprint {
        return Err("Un archivo cambió desde la vista previa. No se escribió nada: revisa los cambios nuevos.".into());
    }
    // Work out every result before touching anything: one refusal stops them all.
    let mut plan: Vec<(&Target, &Content, Option<String>)> = Vec::new();
    for (t, current) in ts.iter().zip(&contents) {
        let next = render(t.kind, install, &t.path, current)?;
        if next != current.text {
            plan.push((t, current, next));
        }
    }

    let mut backups: Vec<String> = Vec::new();
    for (t, current, next) in plan {
        if current.text.is_some() {
            let backup = backup_of(&t.path);
            std::fs::copy(&t.path, &backup).map_err(|e| format!("falló la copia de seguridad: {e}"))?;
            backups.push(backup.to_string_lossy().to_string());
        }
        match next {
            Some(text) => {
                if let Some(dir) = t.path.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                }
                let mut bytes = Vec::new();
                if current.bom {
                    bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
                }
                bytes.extend_from_slice(text.as_bytes());
                // Beside the target, then renamed over it: a crash or a full disk
                // leaves the original whole.
                let temp = t.path.with_extension(format!("coucou-{}", std::process::id()));
                std::fs::write(&temp, &bytes).map_err(|e| format!("write failed: {e}"))?;
                std::fs::rename(&temp, &t.path).map_err(|e| {
                    let _ = std::fs::remove_file(&temp);
                    format!("write failed: {e}")
                })?;
            }
            None => {
                let _ = std::fs::remove_file(&t.path);
            }
        }
    }
    Ok(if backups.is_empty() { "no hizo falta copia de seguridad".into() } else { backups.join("  ·  ") })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn existing(text: &str) -> Content {
        Content { text: Some(text.into()), bom: false }
    }

    #[test]
    fn gemini_hooks_merge_without_touching_anything_else() {
        let before = json!({
            "theme": "dark",
            "hooks": { "BeforeTool": [{ "hooks": [{ "type": "command", "command": "other.exe" }] }] }
        });
        let after = gemini_merged(&before);
        assert_eq!(after["theme"], "dark");
        let list = after["hooks"]["BeforeTool"].as_array().unwrap();
        assert!(list.iter().any(|e| e.to_string().contains("other.exe")), "another tool's hook was dropped");
        assert!(list.iter().any(|e| hooks::entry_is_ours(e)));
        let ours = list.iter().find(|e| hooks::entry_is_ours(e)).unwrap();
        assert_eq!(ours["hooks"][0]["timeout"], GEMINI_TIMEOUT_MS);
        assert!(ours["hooks"][0]["command"].as_str().unwrap().contains("--agent gemini --stdout-json BeforeTool"));
        // Uninstalling puts it back exactly.
        assert_eq!(hooks::without_ours(&after), before);
        // Installing twice does not stack entries.
        assert_eq!(gemini_merged(&after), after);
    }

    #[test]
    fn the_profile_block_goes_in_once_and_comes_out_clean() {
        let profile = "Set-Alias g git\r\n\r\nfunction hi { 'hi' }\r\n";
        let path = Path::new("profile.ps1");
        let c = existing(profile);
        let installed = render(Kind::PowerShellProfile, true, path, &c).unwrap().unwrap();
        assert!(installed.starts_with(profile.trim_end()));
        assert!(installed.contains(PROFILE_START) && installed.contains(PROFILE_END));
        assert!(installed.contains("\r\n"), "the file's line endings are kept");
        assert!(installed.is_ascii(), "5.1 must read the block the same as 7");
        // It acts inside VS Code's terminal only, and reports to the VS Code pill.
        assert!(installed.contains("$env:TERM_PROGRAM -eq 'vscode'"));
        assert!(installed.contains("--agent vscode"));
        assert!(!installed.contains("--agent terminal"));

        // Again: still one block.
        let twice = render(Kind::PowerShellProfile, true, path, &existing(&installed)).unwrap().unwrap();
        assert_eq!(twice.matches(PROFILE_START).count(), 1);

        // Out: the person's own lines survive untouched.
        let removed = render(Kind::PowerShellProfile, false, path, &existing(&installed)).unwrap().unwrap();
        assert!(removed.contains("Set-Alias g git") && removed.contains("function hi"));
        assert!(!removed.contains("coucou"), "{removed}");
    }

    #[test]
    fn a_missing_profile_is_created_and_an_unrelated_plugin_is_never_overwritten() {
        let path = Path::new("x");
        let new = render(Kind::PowerShellProfile, true, path, &Content { text: None, bom: false }).unwrap().unwrap();
        assert!(new.starts_with(PROFILE_START));

        let foreign = existing("export const Mine = async () => ({})");
        assert!(render(Kind::OpenCodePlugin, true, path, &foreign).is_err());
        assert!(render(Kind::OpenCodePlugin, false, path, &foreign).is_err());
        let ours = existing(&plugin_source());
        assert_eq!(render(Kind::OpenCodePlugin, false, path, &ours).unwrap(), None, "uninstall deletes our file");
        assert!(render(Kind::OpenCodePlugin, true, path, &Content { text: None, bom: false }).unwrap().unwrap().contains("CoucouPlugin"));
    }

    #[test]
    fn the_opencode_plugin_exports_only_the_plugin() {
        let src = plugin_source();
        assert!(src.starts_with(PLUGIN_MARKER));
        // OpenCode treats every export as a plugin: helpers must stay private.
        assert_eq!(src.matches("export ").count(), 1, "{src}");
        assert!(src.contains("tool.execute.before") && src.contains("session.idle"));
        assert!(src.contains("--agent"));
    }

    /// Not run by default: shows what connecting each agent would change on THIS
    /// computer, reading its real files and writing nothing.
    /// `cargo test -p coucou show_real_previews -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn show_real_previews() {
        for status in status() {
            println!("=== {} (detected: {}, connected: {}) → {}", status.name, status.detected, status.installed, status.target);
            match preview(status.id, true) {
                Ok(p) => println!("{}\nbackup: {}\nfiles: {}\n", p.diff, p.backup, p.settings_path),
                Err(e) => println!("preview refused: {e}\n"),
            }
        }
    }

    #[test]
    fn a_profile_that_is_not_utf8_is_refused() {
        let tmp = std::env::temp_dir().join(format!("coucou-agents-{}.ps1", std::process::id()));
        std::fs::write(&tmp, [0x61, 0xE9, 0x62]).unwrap(); // "a?b" in Latin-1
        let err = read(&tmp).err().expect("must refuse");
        assert!(err.contains("UTF-8"), "{err}");
        let _ = std::fs::remove_file(&tmp);
    }
}
