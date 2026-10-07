// Claude Code hook installation.
//
// The rule from CLAUDE.md is strict and is followed to the letter:
// read %USERPROFILE%\.claude\settings.json, take a dated backup, merge without
// touching anybody else's hooks, show the diff, and write only after an explicit
// click. Uninstall removes Coucou's entries and nothing else.
//
// The command is only the quoted exe path in forward slashes plus the event name:
// on Windows Claude Code runs hook commands through Git Bash, and anything with
// PowerShell or cmd in it breaks.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};
use crate::{platform, settings};

/// Every event the island reacts to, with the hook timeout written to settings.json.
/// PermissionRequest waits for a human, so it gets the decision timeout + 10 s.
pub const HOOK_EVENTS: &[(&str, u64)] = &[
    ("SessionStart", 10),
    ("SessionEnd", 10),
    ("UserPromptSubmit", 10),
    ("PreToolUse", 10),
    ("PostToolUse", 10),
    ("PostToolUseFailure", 10),
    ("PermissionRequest", 120),
    ("Notification", 10),
    ("Stop", 10),
    ("StopFailure", 10),
    ("SubagentStart", 10),
    ("SubagentStop", 10),
];

/// Marker that identifies a Coucou entry inside settings.json.
pub(crate) const MARKER: &str = "coucou-hook";

/// Claude Code 2.1.85+ delivers AskUserQuestion as a PreToolUse. Answering from
/// the island needs a hook of its own that waits for the person, hence its own
/// timeout: the relay waits 128 s, the app 125 s, Claude Code gives up at 130 s.
const ASK_TIMEOUT: u64 = 130;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub installed: bool,
    /// The hooks are in but the one that answers Claude's questions is missing
    /// (they were installed by an older build): offer the update.
    pub outdated: bool,
    /// Coucou's statusLine relay (the plan usage gauge) is installed.
    pub statusline_installed: bool,
    pub settings_path: String,
    pub hook_path: String,
    pub hook_ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPreview {
    pub diff: String,
    pub backup: String,
    pub settings_path: String,
    /// Identifies the bytes this diff was computed from; handed back to `write`
    /// so we only ever apply what the user actually looked at.
    pub fingerprint: String,
}

pub fn settings_path() -> PathBuf {
    platform::home_dir().join(".claude").join("settings.json")
}

/// Reads `~/.claude/settings.json`.
///
/// The only error that means "start from nothing" is the file not being there.
/// Everything else — a lock held by another process, a permission problem, JSON
/// we cannot parse — is reported, because the alternative is treating somebody's
/// unreadable settings as an empty object and then writing that back over them.
fn read_settings() -> Result<Value, String> {
    let path = settings_path();
    match std::fs::read(&path) {
        Ok(bytes) => parse_settings(&bytes, &path.display().to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        // A lock, a permission problem, a bad drive: all of them mean we do not
        // know what is in there, and not knowing is not the same as empty.
        Err(err) => Err(format!("No se puede leer {}: {err}", path.display())),
    }
}

/// The parsing half of `read_settings`, split out so it can be tested without a
/// home directory.
pub(crate) fn parse_settings(bytes: &[u8], path: &str) -> Result<Value, String> {
    // PowerShell writes a UTF-8 BOM with `Set-Content -Encoding utf8`, and
    // serde_json refuses it. Stripping it is safe and well defined; guessing at
    // anything else is not.
    let text = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({}));
    }
    match serde_json::from_slice::<Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) => Err(format!("{path} no es un objeto JSON: Coucou no lo tocará.")),
        Err(err) => Err(format!(
            "{path} no es un JSON válido ({err}). Corrígelo o muévelo y vuelve a intentarlo: Coucou no lo sobrescribirá."
        )),
    }
}

/// The settings as they are, or an empty object when we cannot tell. Only for
/// read-only paths like `status()`, which must never fail loudly; anything that
/// writes uses `read_settings()` and surfaces the error instead.
fn read_settings_lossy() -> Value {
    read_settings().unwrap_or_else(|_| json!({}))
}

#[cfg(windows)]
fn hook_command(event: &str) -> String {
    let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
    format!("\"{exe}\" {event}")
}

/// `coucou-hook --ask PreToolUse`: the relay that waits for an answer.
fn ask_command() -> String {
    let base = hook_command("");
    format!("{} --ask PreToolUse", base.trim_end())
}

/// `coucou-hook --statusline`: the statusLine relay.
fn statusline_command() -> String {
    let base = hook_command("");
    format!("{} --statusline", base.trim_end())
}

/// Claude Code runs the command through `sh`, which still reads `$`, `` ` ``
/// and `\` inside double quotes. Single quotes keep the path a path, whatever
/// the home directory is called.
#[cfg(unix)]
fn hook_command(event: &str) -> String {
    format!("{} {event}", sh_quote(&settings::hook_exe_path().to_string_lossy()))
}

/// `s` as one single-quoted shell word: `'` becomes `'\''`, nothing else is
/// special inside single quotes.
#[cfg(unix)]
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

pub(crate) fn entry_is_ours(entry: &Value) -> bool {
    entry
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .map(|c| c.contains(MARKER))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// Settings with Coucou's hooks added; everything else is left untouched.
fn merged(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut hooks = root
        .get("hooks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(Map::new);

    for (event, timeout) in HOOK_EVENTS {
        let mut list = hooks
            .get(*event)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        list.retain(|entry| !entry_is_ours(entry));
        list.push(json!({
            "hooks": [{
                "type": "command",
                "command": hook_command(event),
                "timeout": timeout,
            }]
        }));
        if *event == "PreToolUse" {
            list.push(json!({
                "matcher": "AskUserQuestion",
                "hooks": [{
                    "type": "command",
                    "command": ask_command(),
                    "timeout": ASK_TIMEOUT,
                }]
            }));
        }
        hooks.insert((*event).to_string(), Value::Array(list));
    }

    root.insert("hooks".into(), Value::Object(hooks));
    Value::Object(root)
}

/// Settings with every Coucou entry removed, and nothing else changed.
pub(crate) fn without_ours(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let Some(hooks) = root.get("hooks").and_then(Value::as_object).cloned() else {
        return Value::Object(root);
    };
    let mut out = Map::new();
    for (event, value) in hooks {
        match value.as_array() {
            Some(list) => {
                let kept: Vec<Value> =
                    list.iter().filter(|e| !entry_is_ours(e)).cloned().collect();
                if !kept.is_empty() {
                    out.insert(event, Value::Array(kept));
                }
            }
            None => {
                out.insert(event, value);
            }
        }
    }
    if out.is_empty() {
        root.remove("hooks");
    } else {
        root.insert("hooks".into(), Value::Object(out));
    }
    Value::Object(root)
}

// ── statusLine (plan usage gauge) ────────────────────────────────────────────
//
// Claude Code allows a single statusLine. If the person already has one, ours
// wraps it: the previous object is kept next to the relay, which runs its
// command after reporting the plan usage, so their status line looks and works
// exactly as before. Uninstalling puts the original object back untouched.

fn previous_statusline_path() -> PathBuf {
    settings::hook_exe_path().with_file_name("statusline-previous.json")
}

fn statusline_is_ours(root: &Value) -> bool {
    root.get("statusLine")
        .and_then(|s| s.get("command"))
        .and_then(Value::as_str)
        .map(|c| c.contains(MARKER))
        .unwrap_or(false)
}

fn ask_is_installed(root: &Value) -> bool {
    root.get("hooks")
        .and_then(|h| h.get("PreToolUse"))
        .and_then(Value::as_array)
        .map(|list| {
            list.iter().any(|entry| {
                entry_is_ours(entry)
                    && serde_json::to_string(entry).map(|s| s.contains("--ask")).unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// Our relay as the statusLine; every other field of an existing one is kept.
fn merged_statusline(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut line = root
        .get("statusLine")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    line.insert("type".into(), json!("command"));
    line.insert("command".into(), json!(statusline_command()));
    root.insert("statusLine".into(), Value::Object(line));
    Value::Object(root)
}

/// The statusLine the person had before us, or none at all. A statusLine that is
/// not ours any more (they changed it since) is left alone.
fn without_statusline(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    if !statusline_is_ours(existing) {
        return Value::Object(root);
    }
    let previous = std::fs::read(previous_statusline_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|v| v.get("statusLine").cloned())
        .filter(|s| s.is_object());
    match previous {
        Some(line) => {
            root.insert("statusLine".into(), line);
        }
        None => {
            root.remove("statusLine");
        }
    }
    Value::Object(root)
}

/// Keeps the person's own statusLine where the relay can find it.
fn remember_previous_statusline(current: &Value) -> Result<(), String> {
    let path = previous_statusline_path();
    if statusline_is_ours(current) {
        return Ok(()); // a reinstall: what we saved the first time is still right
    }
    match current.get("statusLine") {
        Some(line) => {
            let saved = json!({ "statusLine": line });
            std::fs::write(&path, pretty(&saved))
                .map_err(|e| format!("no se pudo guardar tu línea de estado actual: {e}"))
        }
        None => {
            let _ = std::fs::remove_file(&path);
            Ok(())
        }
    }
}

pub(crate) fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

/// Down to the second: installing then uninstalling in the same minute must not
/// quietly overwrite the first backup.
pub(crate) fn stamp() -> String {
    let t = platform::local_time();
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        t.year, t.month, t.day, t.hour, t.minute, t.second
    )
}

fn backup_path() -> PathBuf {
    let p = settings_path();
    p.with_file_name(format!("settings.json.bak-{}", stamp()))
}

/// Identifies the exact bytes a preview was computed from. FNV-1a is plenty:
/// the question is only "is this still the file I showed the user?".
pub(crate) fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}")
}

fn current_fingerprint() -> String {
    match std::fs::read(settings_path()) {
        Ok(bytes) => fingerprint(&bytes),
        Err(_) => fingerprint(b""),
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn status() -> HookStatus {
    let current = read_settings_lossy();
    let installed = current
        .get("hooks")
        .and_then(Value::as_object)
        .map(|hooks| {
            hooks
                .values()
                .filter_map(Value::as_array)
                .flatten()
                .any(entry_is_ours)
        })
        .unwrap_or(false);
    let hook_path = settings::hook_exe_path();
    HookStatus {
        installed,
        outdated: installed && !ask_is_installed(&current),
        statusline_installed: statusline_is_ours(&current),
        settings_path: settings_path().to_string_lossy().to_string(),
        hook_ready: hook_path.exists(),
        hook_path: hook_path.to_string_lossy().to_string(),
    }
}

pub fn preview(install: bool) -> Result<HookPreview, String> {
    preview_with(|current| if install { merged(current) } else { without_ours(current) })
}

/// The same flow for the plan usage relay: its own diff, its own click.
pub fn preview_statusline(install: bool) -> Result<HookPreview, String> {
    preview_with(|current| {
        if install { merged_statusline(current) } else { without_statusline(current) }
    })
}

fn preview_with(change: impl Fn(&Value) -> Value) -> Result<HookPreview, String> {
    let current = read_settings()?;
    let next = change(&current);
    Ok(HookPreview {
        diff: unified_diff(&pretty(&current), &pretty(&next)),
        backup: backup_path().to_string_lossy().to_string(),
        settings_path: settings_path().to_string_lossy().to_string(),
        fingerprint: current_fingerprint(),
    })
}

/// Writes the merged (or cleaned) settings after taking a dated backup.
///
/// `fingerprint` is the one the preview was computed from. If the file changed
/// in between — another tool, another window, the user's own editor — we stop
/// and make them look at a fresh diff, because the only thing worse than not
/// installing the hooks is silently reverting somebody else's edit.
pub fn write(install: bool, fingerprint: &str) -> Result<String, String> {
    write_with(fingerprint, |current| {
        Ok(if install { merged(current) } else { without_ours(current) })
    })
}

/// Writes the plan usage relay in (or the person's own statusLine back).
pub fn write_statusline(install: bool, fingerprint: &str) -> Result<String, String> {
    let backup = write_with(fingerprint, |current| {
        if install {
            // Before the write, so the relay finds the previous command the first
            // time Claude Code runs it.
            remember_previous_statusline(current)?;
            Ok(merged_statusline(current))
        } else {
            Ok(without_statusline(current))
        }
    })?;
    if !install {
        let _ = std::fs::remove_file(previous_statusline_path());
    }
    Ok(backup)
}

fn write_with(
    fingerprint: &str,
    change: impl Fn(&Value) -> Result<Value, String>,
) -> Result<String, String> {
    let path = settings_path();
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    // Read before the backup: an unreadable file must abort before we touch
    // anything at all.
    let current = read_settings()?;
    if current_fingerprint() != fingerprint {
        return Err(format!(
            "{} cambió desde la vista previa. No se escribió nada: revisa los cambios nuevos.",
            path.display()
        ));
    }

    let backup = backup_path();
    if path.exists() {
        std::fs::copy(&path, &backup).map_err(|e| format!("falló la copia de seguridad: {e}"))?;
    }

    let next = change(&current)?;
    let mut text = pretty(&next);
    text.push('\n');

    // A dotfiles setup often makes settings.json a symlink: write to the file it
    // points at, so the link survives the rename below.
    #[cfg(unix)]
    let path = std::fs::canonicalize(&path).unwrap_or(path);

    // Write beside the target and rename over it: a crash or a full disk leaves
    // the original settings.json intact rather than half a file.
    let temp = path.with_extension(format!("json.coucou-{}", std::process::id()));
    if let Err(err) = write_like(&temp, &path, text.as_bytes()) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("falló la escritura: {err}"));
    }
    if let Err(err) = std::fs::rename(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("falló la escritura: {err}"));
    }
    Ok(backup.to_string_lossy().to_string())
}

/// Writes `bytes` to `temp`, which is about to replace `original`.
///
/// On Linux a fresh file would get the umask's 0644, and settings.json can hold
/// API keys in its `env` block: the new file is created readable by us only,
/// then given the original's permissions, so the rename never widens them.
fn write_like(temp: &Path, original: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(temp)?;
    file.write_all(bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(original)
            .map(|m| m.permissions().mode() & 0o777)
            .unwrap_or(0o600);
        file.set_permissions(std::fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = original;
    Ok(())
}

/// Copies the relay (coucou-hook.exe / coucou-hook) into the local data dir's
/// bin/ on launch. In a bundled install it comes from the app resources; in
/// `tauri dev` it sits next to the app binary in the workspace target directory.
///
/// Every candidate is tried rather than just the first, because getting this
/// wrong is silent and fatal: `resources` used to be a glob, which made NSIS
/// mirror the source path into `_up_\target\release\`, no candidate matched, and
/// the relay was simply never installed. It only looked healthy on a developer
/// machine, where a leftover copy from `tauri dev` was already sitting in bin/.
pub fn ensure_hook_exe(app: &AppHandle) {
    let dest = settings::hook_exe_path();
    let Some(dir) = dest.parent() else { return };
    // Nobody else may swap the relay Claude Code runs: its folder is ours only.
    if platform::ensure_private_dir(&settings::local_dir()).is_err()
        || std::fs::create_dir_all(dir).is_err()
    {
        return;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().resolve(platform::HOOK_EXE, tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            // Installed build, then `tauri dev` (target/debug) next to the
            // release hook the pre-build step produces.
            candidates.push(parent.join(platform::HOOK_EXE));
            candidates.push(parent.join("../release").join(platform::HOOK_EXE));
            // Belt and braces: where the old glob form used to land it.
            candidates.push(parent.join("_up_/target/release").join(platform::HOOK_EXE));
        }
    }

    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    let Some(src) = candidates.into_iter().find(|p| p.exists()) else {
        crate::log::line(format!(
            "{} not found — Claude Code hooks cannot work. Looked in: {}",
            platform::HOOK_EXE,
            tried.join(", ")
        ));
        return;
    };
    install_relay(&src, &dest);
}

#[cfg(windows)]
fn install_relay(src: &Path, dest: &Path) {
    let same = match (std::fs::metadata(src), std::fs::metadata(dest)) {
        (Ok(a), Ok(b)) => a.len() == b.len() && a.modified().ok() == b.modified().ok(),
        _ => false,
    };
    if same {
        return;
    }
    // A hook may be running right now and hold the file open; keeping the old
    // copy is fine, it is the same relay.
    if let Err(err) = std::fs::copy(src, dest) {
        if !dest.exists() {
            crate::log::line(format!("could not install {}: {err}", platform::HOOK_EXE));
        }
    }
}

/// Linux does not keep the modification time on copy, so the contents decide.
/// The new relay is written beside the old one and renamed over it: a hook
/// starting at that moment runs either the old relay or the new one, never half
/// of one, and a relay that is running right now does not block the update.
#[cfg(unix)]
fn install_relay(src: &Path, dest: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if matches!((std::fs::read(src), std::fs::read(dest)), (Ok(a), Ok(b)) if a == b) {
        return;
    }
    let temp = dest.with_extension(format!("new-{}", std::process::id()));
    let result = std::fs::copy(src, &temp)
        .and_then(|_| std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o755)))
        .and_then(|_| std::fs::rename(&temp, dest));
    if let Err(err) = result {
        let _ = std::fs::remove_file(&temp);
        crate::log::line(format!("could not install {}: {err}", platform::HOOK_EXE));
    }
}

// ── Minimal unified diff (LCS) ────────────────────────────────────────────────

/// settings.json is short, so a plain O(n·m) LCS is the simplest honest diff.
pub(crate) fn unified_diff(before: &str, after: &str) -> String {
    let a: Vec<&str> = before.lines().collect();
    let b: Vec<&str> = after.lines().collect();
    let (n, m) = (a.len(), b.len());

    let mut lcs = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }

    let mut out: Vec<String> = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);
    while i < n && j < m {
        if a[i] == b[j] {
            out.push(format!("  {}", a[i]));
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            out.push(format!("- {}", a[i]));
            i += 1;
        } else {
            out.push(format!("+ {}", b[j]));
            j += 1;
        }
    }
    while i < n {
        out.push(format!("- {}", a[i]));
        i += 1;
    }
    while j < m {
        out.push(format!("+ {}", b[j]));
        j += 1;
    }

    // Keep three lines of context around each change so the panel stays readable.
    let changed: Vec<usize> = out
        .iter()
        .enumerate()
        .filter(|(_, l)| l.starts_with('+') || l.starts_with('-'))
        .map(|(i, _)| i)
        .collect();
    if changed.is_empty() {
        return "Sin cambios.".into();
    }
    let mut keep = vec![false; out.len()];
    for idx in changed {
        let lo = idx.saturating_sub(3);
        let hi = (idx + 4).min(out.len());
        for k in lo..hi {
            keep[k] = true;
        }
    }
    let mut result = String::new();
    let mut gap = false;
    for (idx, line) in out.iter().enumerate() {
        if keep[idx] {
            result.push_str(line);
            result.push('\n');
            gap = false;
        } else if !gap {
            result.push_str("  …\n");
            gap = true;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const WHERE: &str = "settings.json";

    #[test]
    fn a_utf8_bom_is_stripped_not_treated_as_corruption() {
        // PowerShell 5's `Set-Content -Encoding utf8` produces exactly this.
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(br#"{"model":"opus","hooks":{}}"#);
        let parsed = parse_settings(&bytes, WHERE).expect("a BOM must not defeat the parser");
        assert_eq!(parsed["model"], "opus");
    }

    #[test]
    fn unreadable_content_is_an_error_never_an_empty_object() {
        // This is the whole bug: returning {} here meant `merged()` produced a
        // file containing nothing but Coucou's hooks, and the write replaced
        // everything the user had.
        for bad in [&b"{ not json"[..], &b"[1,2,3]"[..], &b"\"a string\""[..]] {
            assert!(
                parse_settings(bad, WHERE).is_err(),
                "content we cannot use must refuse, not come back empty"
            );
        }
    }

    #[test]
    fn empty_and_whitespace_files_start_from_nothing() {
        assert_eq!(parse_settings(b"", WHERE).unwrap(), json!({}));
        assert_eq!(parse_settings(b"  
	 ", WHERE).unwrap(), json!({}));
    }

    #[test]
    fn merging_keeps_every_other_setting_and_every_foreign_hook() {
        let existing = serde_json::json!({
            "model": "claude-opus-5",
            "theme": "dark",
            "enabledPlugins": ["a", "b"],
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "someone-elses-tool.exe" }] }
                ],
                "SomeEventWeDoNotTouch": [
                    { "hooks": [{ "type": "command", "command": "keep-me.exe" }] }
                ]
            }
        });

        let after = merged(&existing);
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["enabledPlugins"], serde_json::json!(["a", "b"]));

        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(
            pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("someone-elses-tool.exe")),
            "another tool's hook was dropped"
        );
        assert!(pre.iter().any(entry_is_ours), "our own hook was not added");
        assert!(after["hooks"]["SomeEventWeDoNotTouch"].is_array());

        // And removing ours puts it back exactly as it was.
        let cleaned = without_ours(&after);
        assert_eq!(cleaned, existing);
    }

    #[test]
    fn the_question_hook_has_its_own_matcher_and_goes_with_the_rest() {
        let after = merged(&json!({}));
        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        let ask = pre
            .iter()
            .find(|e| e["matcher"] == "AskUserQuestion")
            .expect("the AskUserQuestion hook was not added");
        assert_eq!(ask["hooks"][0]["timeout"], ASK_TIMEOUT);
        assert!(ask["hooks"][0]["command"].as_str().unwrap().contains("--ask PreToolUse"));
        assert!(ask_is_installed(&after));
        // Hooks installed by the previous build have no such entry.
        assert!(!ask_is_installed(&json!({ "hooks": { "PreToolUse": [
            { "hooks": [{ "type": "command", "command": "\"x/coucou-hook.exe\" PreToolUse" }] }
        ] } })));
        assert_eq!(without_ours(&after), json!({}));
    }

    #[test]
    fn the_statusline_keeps_its_other_fields_and_never_touches_a_foreign_one() {
        let existing = json!({ "statusLine": { "type": "command", "command": "my-line.sh", "padding": 2 } });
        let after = merged_statusline(&existing);
        assert_eq!(after["statusLine"]["padding"], 2);
        assert!(after["statusLine"]["command"].as_str().unwrap().contains("--statusline"));
        assert!(statusline_is_ours(&after));
        assert!(!statusline_is_ours(&existing));
        // The person's own status line is left alone by an uninstall.
        assert_eq!(without_statusline(&existing), existing);
        // Hooks and statusLine are independent: removing the hooks keeps the gauge.
        assert!(statusline_is_ours(&without_ours(&merged(&after))));
    }

    #[test]
    fn a_fingerprint_notices_any_change() {
        assert_eq!(fingerprint(b"{}"), fingerprint(b"{}"));
        assert_ne!(fingerprint(b"{}"), fingerprint(b"{ }"));
        assert_ne!(fingerprint(b""), fingerprint(b"{}"));
    }

    #[cfg(unix)]
    #[test]
    fn the_hook_path_is_one_shell_word_whatever_it_contains() {
        assert_eq!(sh_quote("/home/a b/x"), "'/home/a b/x'");
        // $, backticks, backslashes and double quotes stay literal in single quotes.
        assert_eq!(sh_quote(r#"/h/$(id)`x`\"y"#), r#"'/h/$(id)`x`\"y'"#);
        // A single quote closes, escapes and reopens.
        assert_eq!(sh_quote("/h/it's"), r"'/h/it'\''s'");
    }

    /// settings.json can carry API keys in its `env` block: rewriting it must
    /// never make it readable by more people than before.
    #[cfg(unix)]
    #[test]
    fn rewriting_settings_never_widens_its_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("coucou-perm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let original = dir.join("settings.json");
        let temp = dir.join("settings.json.new");
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;

        for wanted in [0o600, 0o640, 0o644] {
            std::fs::write(&original, b"{}").unwrap();
            std::fs::set_permissions(&original, std::fs::Permissions::from_mode(wanted)).unwrap();
            let _ = std::fs::remove_file(&temp);
            write_like(&temp, &original, b"{\"a\":1}").unwrap();
            assert_eq!(mode(&temp), wanted, "the rewrite must keep {wanted:o}");
        }

        // No original: ours only.
        std::fs::remove_file(&original).unwrap();
        let _ = std::fs::remove_file(&temp);
        write_like(&temp, &original, b"{}").unwrap();
        assert_eq!(mode(&temp), 0o600);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Everything filesystem-shaped lives in one test on purpose: it points
    /// the home directory at a temp directory, and that is process-wide.
    #[test]
    fn writing_backs_up_preserves_and_refuses_a_changed_file() {
        let tmp = std::env::temp_dir().join(format!("coucou-hooks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join(".claude")).unwrap();
        std::env::set_var(platform::HOME_VAR, &tmp);

        let path = settings_path();
        assert!(path.starts_with(&tmp), "the test must not touch the real home");

        // A real-shaped file, written the way PowerShell 5 would: UTF-8 with BOM.
        let original = r#"{"model":"claude-opus-5","theme":"dark","tui":{"x":1},"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"other-tool.exe"}]}]}}"#;
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(original.as_bytes());
        std::fs::write(&path, &bytes).unwrap();

        // Install.
        let plan = preview(true).expect("a BOM must not stop the preview");
        assert!(plan.diff.contains("coucou-hook"), "the diff must show what changes");
        let backup = write(true, &plan.fingerprint).expect("install should succeed");

        // The backup holds the original bytes, BOM and all.
        assert_eq!(std::fs::read(&backup).unwrap(), bytes);

        // Everything else survived, and so did the other tool's hook.
        let after: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["tui"]["x"], 1);
        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("other-tool.exe")));
        assert!(status().installed);

        // A file that moved since the preview is refused, and left alone.
        let stale = preview(false).unwrap();
        std::fs::write(&path, br#"{"model":"someone-else-edited-this"}"#).unwrap();
        let err = write(false, &stale.fingerprint).unwrap_err();
        assert!(err.contains("cambió desde la vista previa"), "got: {err}");
        let untouched: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(untouched["model"], "someone-else-edited-this");

        // Content we cannot parse is refused before anything is written.
        std::fs::write(&path, b"{ broken").unwrap();
        assert!(preview(true).is_err());
        assert!(write(true, "whatever").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{ broken");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
