// GOWA process management: start Coucou's own copy of GOWA as a child process, stop it, and
// decide whether it's even safe to start (loopback URL only). Ported from
// WhatsAppGOWAProcess.swift.

use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::process::{Child, Command};

pub fn working_dir() -> PathBuf {
    crate::platform::local_dir().join("GOWA")
}

#[cfg(windows)]
pub fn binary_name() -> &'static str {
    "gowa.exe"
}
#[cfg(not(windows))]
pub fn binary_name() -> &'static str {
    "gowa"
}

/// `rest --host=127.0.0.1 --port=<url's port, default 3000> --auto-download-media=false` —
/// ground truth: `WhatsAppGateway.launchArguments(for:)` (WhatsAppGateway.swift:186-188).
/// Without these, GOWA starts with no subcommand and never serves the REST API at all.
pub fn launch_arguments(url: &str) -> Vec<String> {
    let port = url::Url::parse(url).ok().and_then(|u| u.port()).unwrap_or(3000);
    vec![
        "rest".to_string(),
        "--host=127.0.0.1".to_string(),
        format!("--port={port}"),
        "--auto-download-media=false".to_string(),
    ]
}

/// Only ever start a process pointed at this machine: an address elsewhere is someone
/// else's gateway, never something Coucou should spawn a process to reach.
pub fn is_loopback_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else { return false };
    // url's host_str() keeps the brackets around an IPv6 literal (e.g. "[::1]").
    matches!(parsed.host_str(), Some("127.0.0.1") | Some("localhost") | Some("::1") | Some("[::1]"))
}

pub struct Process {
    child: Option<Child>,
    launched_with: Option<String>,
    last_start: Instant,
}

impl Process {
    pub fn new() -> Self {
        Self { child: None, launched_with: None, last_start: Instant::now() - Duration::from_secs(3600) }
    }

    pub fn is_running(&mut self) -> bool {
        match &mut self.child {
            Some(c) => matches!(c.try_wait(), Ok(None)),
            None => false,
        }
    }

    fn signature(binary_path: &str, url: &str, credential: Option<&str>) -> String {
        format!("{binary_path}\u{1F}{url}\u{1F}{}", credential.unwrap_or(""))
    }

    /// Starts (or restarts, if the signature changed) GOWA. Returns false when it can't run
    /// (binary missing, URL not loopback, or the process failed to spawn).
    pub fn sync(&mut self, binary_path: &str, url: &str, credential: Option<&str>) -> bool {
        if binary_path.is_empty() || !is_loopback_url(url) {
            self.stop_now();
            return false;
        }
        if !std::path::Path::new(binary_path).is_file() {
            self.stop_now();
            return false;
        }
        let sig = Self::signature(binary_path, url, credential);
        if self.is_running() {
            if self.launched_with.as_deref() == Some(sig.as_str()) {
                return true;
            }
            self.stop_now();
        } else if self.launched_with.as_deref() == Some(sig.as_str()) && self.last_start.elapsed() < Duration::from_secs(60) {
            return true; // retried too recently; wait out the minute like the Mac does
        }

        let dir = working_dir();
        if std::fs::create_dir_all(&dir).is_err() {
            return false;
        }
        let mut cmd = Command::new(binary_path);
        cmd.args(launch_arguments(url)).current_dir(&dir).env("APP_UI_ENABLED", "false");
        if let Some(cred) = credential {
            if cred.contains(':') {
                cmd.env("APP_BASIC_AUTH", cred);
            }
        }
        cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        match cmd.spawn() {
            Ok(child) => {
                self.child = Some(child);
                self.launched_with = Some(sig);
                self.last_start = Instant::now();
                true
            }
            Err(_) => false,
        }
    }

    /// Stops GOWA if Coucou started it. On Unix, mirrors the Mac's stopNow(): SIGTERM first,
    /// then up to 1s for it to let go of the port and its session database, SIGKILL only as a
    /// fallback — an abrupt kill risks corrupting GOWA's own sqlite store. tokio's
    /// `start_kill()` alone is always a hard kill, so that step is done by hand here.
    pub fn stop_now(&mut self) {
        self.launched_with = None;
        let Some(mut child) = self.child.take() else { return };

        #[cfg(unix)]
        {
            if let Some(pid) = child.id() {
                unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
            }
            let deadline = Instant::now() + Duration::from_millis(1000);
            while Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    _ => std::thread::sleep(Duration::from_millis(50)),
                }
            }
        }
        // ponytail: Windows has no cheap SIGTERM equivalent for a non-console child (would need
        // CTRL_BREAK_EVENT + a shared console group); terminate outright. Add a graceful path
        // if GOWA on Windows ever needs a clean-shutdown hook to protect its session store.
        let _ = child.start_kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_hosts_are_recognized() {
        assert!(is_loopback_url("http://127.0.0.1:3000"));
        assert!(is_loopback_url("http://localhost:3000"));
        assert!(is_loopback_url("http://[::1]:3000"));
    }

    #[test]
    fn a_remote_host_is_not_loopback() {
        assert!(!is_loopback_url("http://example.com:3000"));
        assert!(!is_loopback_url("http://192.168.1.5:3000"));
        assert!(!is_loopback_url("not a url"));
    }

    #[test]
    fn sync_refuses_a_non_loopback_url_without_spawning() {
        let mut p = Process::new();
        assert!(!p.sync("/bin/true", "http://example.com:3000", None));
        assert!(!p.is_running());
    }

    #[test]
    fn sync_refuses_a_missing_binary() {
        let mut p = Process::new();
        assert!(!p.sync("/nonexistent/gowa", "http://127.0.0.1:3000", None));
    }

    #[test]
    fn launch_arguments_builds_the_gowa_rest_command() {
        assert_eq!(
            launch_arguments("http://127.0.0.1:4000"),
            vec!["rest", "--host=127.0.0.1", "--port=4000", "--auto-download-media=false"],
        );
    }

    #[test]
    fn launch_arguments_defaults_the_port_when_the_url_has_none() {
        assert_eq!(launch_arguments("http://127.0.0.1")[2], "--port=3000");
    }

    #[test]
    fn binary_name_matches_the_platform() {
        #[cfg(windows)]
        assert_eq!(binary_name(), "gowa.exe");
        #[cfg(not(windows))]
        assert_eq!(binary_name(), "gowa");
    }
}
