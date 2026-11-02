// GOWA install/update: downloads the latest release from GitHub, verifies its SHA-256
// against GOWA's own published checksums.txt, extracts the binary. Ported from
// WhatsAppGOWAInstaller.swift. GOWA repo: aldinokemal/go-whatsapp-web-multidevice.

use super::archive;
use std::time::Duration;

const RELEASES_API: &str = "https://api.github.com/repos/aldinokemal/go-whatsapp-web-multidevice/releases/latest";

#[derive(Debug, Clone, PartialEq)]
pub enum InstallError {
    NoBuildForThisPlatform,
    NoChecksum,
    DownloadFailed,
    BadChecksum,
    UnpackFailed,
    Network(String),
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InstallError::NoBuildForThisPlatform => write!(f, "no build for this platform"),
            InstallError::NoChecksum => write!(f, "no checksum published"),
            InstallError::DownloadFailed => write!(f, "download failed"),
            InstallError::BadChecksum => write!(f, "checksum mismatch"),
            InstallError::UnpackFailed => write!(f, "could not unpack the archive"),
            InstallError::Network(d) => write!(f, "network error: {d}"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ReleaseAsset {
    pub name: String,
    pub download_url: String,
    pub size: u64,
}

/// Only GitHub's own hosts: the releases API, github.com itself, and its release-asset CDN
/// (`objects.githubusercontent.com` and friends). Mirrors the Mac's `GitHubOnly`
/// `URLSessionTaskDelegate` (WhatsAppGOWAInstaller.swift) — same intent, enforced here via
/// reqwest's redirect policy instead of a URLSession delegate: a redirect anywhere else during
/// install is refused rather than followed.
fn allowed_redirect_host(host: &str) -> bool {
    host == "github.com" || host == "api.github.com" || host.ends_with(".githubusercontent.com")
}

fn github_only_client() -> Result<reqwest::Client, InstallError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let host = attempt.url().host_str().unwrap_or("");
            if allowed_redirect_host(host) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| InstallError::Network(e.to_string()))
}

/// `whatsapp_<version>_<os>_<arch>.zip` — windows/amd64 or linux/amd64 only (the platforms
/// this app ships for; see Cargo.toml's `[target.'cfg(...)'.dependencies]` sections).
pub fn platform_suffix() -> &'static str {
    #[cfg(windows)]
    { "windows_amd64.zip" }
    #[cfg(all(unix, not(target_os = "macos")))]
    { "linux_amd64.zip" }
    #[cfg(target_os = "macos")]
    { "darwin_amd64.zip" } // not shipped on this platform, kept for completeness
}

pub fn pick_asset(assets: &[ReleaseAsset]) -> Option<&ReleaseAsset> {
    assets.iter().find(|a| a.name.ends_with(platform_suffix()))
}

/// `checksums.txt` is one `<sha256>  <filename>` line per asset (sha256sum format).
pub fn expected_sha256(asset_name: &str, checksums_txt: &str) -> Option<String> {
    checksums_txt.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == asset_name).then(|| hash.to_string())
    })
}

/// Extracts the version from a release name like "whatsapp_9.8.0_windows_amd64.zip" → "9.8.0".
pub fn version_from_asset_name(name: &str) -> Option<String> {
    name.strip_prefix("whatsapp_")?.split('_').next().map(|s| s.to_string())
}

pub async fn install(
    progress: impl Fn(crate::whatsapp::InstallStep) + Send + 'static,
) -> Result<String, InstallError> {
    progress(crate::whatsapp::InstallStep::Checking);
    let client = github_only_client()?;

    let release: serde_json::Value = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "coucou")
        .send()
        .await
        .map_err(|e| InstallError::Network(e.to_string()))?
        .json()
        .await
        .map_err(|e| InstallError::Network(e.to_string()))?;

    let assets: Vec<ReleaseAsset> = release
        .get("assets")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    Some(ReleaseAsset {
                        name: a.get("name")?.as_str()?.to_string(),
                        download_url: a.get("browser_download_url")?.as_str()?.to_string(),
                        size: a.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let picked = pick_asset(&assets).ok_or(InstallError::NoBuildForThisPlatform)?.clone();
    let checksums_asset = assets.iter().find(|a| a.name == "checksums.txt").ok_or(InstallError::NoChecksum)?;
    let checksums_txt = client
        .get(&checksums_asset.download_url)
        .header("User-Agent", "coucou")
        .send()
        .await
        .map_err(|e| InstallError::Network(e.to_string()))?
        .text()
        .await
        .map_err(|e| InstallError::Network(e.to_string()))?;
    let expected = expected_sha256(&picked.name, &checksums_txt).ok_or(InstallError::NoChecksum)?;

    progress(crate::whatsapp::InstallStep::Downloading { megabytes: (picked.size / 1_000_000).max(1) });
    let zip_bytes = client
        .get(&picked.download_url)
        .header("User-Agent", "coucou")
        .send()
        .await
        .map_err(|_| InstallError::DownloadFailed)?
        .bytes()
        .await
        .map_err(|_| InstallError::DownloadFailed)?;

    progress(crate::whatsapp::InstallStep::Verifying);
    let digest = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&zip_bytes);
        // Manual hex fold, matching the existing pattern in sync.rs (`fn hex`): no new
        // dependency for this.
        hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>()
    };
    if digest != expected {
        return Err(InstallError::BadChecksum);
    }

    progress(crate::whatsapp::InstallStep::Installing);
    let binary_bytes = archive::extract(&zip_bytes, super::process::binary_name())
        .ok_or(InstallError::UnpackFailed)?;
    let dir = super::process::working_dir();
    std::fs::create_dir_all(&dir).map_err(|_| InstallError::UnpackFailed)?;
    let dest = dir.join(super::process::binary_name());
    std::fs::write(&dest, &binary_bytes).map_err(|_| InstallError::UnpackFailed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    }

    let version = version_from_asset_name(&picked.name).unwrap_or_else(|| "unknown".to_string());
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> ReleaseAsset {
        ReleaseAsset { name: name.to_string(), download_url: format!("https://example.com/{name}"), size: 12_000_000 }
    }

    #[test]
    fn picks_the_asset_for_this_platform() {
        let assets = vec![
            asset("whatsapp_9.8.0_darwin_amd64.zip"),
            asset("whatsapp_9.8.0_linux_amd64.zip"),
            asset("whatsapp_9.8.0_windows_amd64.zip"),
            asset("checksums.txt"),
        ];
        let picked = pick_asset(&assets).unwrap();
        assert!(picked.name.ends_with(platform_suffix()));
    }

    #[test]
    fn returns_none_when_no_asset_matches() {
        let assets = vec![asset("whatsapp_9.8.0_darwin_arm64.zip")];
        assert!(pick_asset(&assets).is_none());
    }

    #[test]
    fn finds_the_matching_checksum_line() {
        let checksums = "aabbcc  whatsapp_9.8.0_windows_amd64.zip\nddeeff  whatsapp_9.8.0_linux_amd64.zip\n";
        assert_eq!(expected_sha256("whatsapp_9.8.0_windows_amd64.zip", checksums), Some("aabbcc".to_string()));
        assert_eq!(expected_sha256("whatsapp_9.8.0_linux_amd64.zip", checksums), Some("ddeeff".to_string()));
        assert_eq!(expected_sha256("whatsapp_9.8.0_darwin_amd64.zip", checksums), None);
    }

    #[test]
    fn checksum_lines_may_have_a_leading_binary_marker_asterisk() {
        let checksums = "aabbcc *whatsapp_9.8.0_windows_amd64.zip\n";
        assert_eq!(expected_sha256("whatsapp_9.8.0_windows_amd64.zip", checksums), Some("aabbcc".to_string()));
    }

    #[test]
    fn extracts_the_version_from_the_asset_name() {
        assert_eq!(version_from_asset_name("whatsapp_9.8.0_windows_amd64.zip"), Some("9.8.0".to_string()));
        assert_eq!(version_from_asset_name("garbage.zip"), None);
    }

    #[test]
    fn redirect_host_allowlist_accepts_only_github_hosts() {
        assert!(allowed_redirect_host("github.com"));
        assert!(allowed_redirect_host("api.github.com"));
        assert!(allowed_redirect_host("objects.githubusercontent.com"));
        assert!(allowed_redirect_host("release-assets.githubusercontent.com"));
        assert!(!allowed_redirect_host("evil.com"));
        assert!(!allowed_redirect_host("githubusercontent.com.evil.com"));
        assert!(!allowed_redirect_host(""));
    }
}
