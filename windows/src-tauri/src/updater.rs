// Updates: Coucou looks for a newer version on the project's GitHub releases
// (the `latest.json` the release workflow publishes) and, when the person
// chose "automatic", installs it while nothing is going on — the island picks
// that moment, Rust only checks, downloads and installs.
//
// Every update is signed with the project's updater key; the plugin refuses one
// whose signature does not match the public key in tauri.conf.json.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::{log, Shared};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: String,
}

/// The newer version, if there is one.
pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| format!("No se pudo buscar actualizaciones: {e}"))?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().unwrap_or_default(),
    }))
}

/// Downloads the update, installs it and starts the new version. On Windows the
/// installer closes Coucou and opens it again; on macOS the app is replaced and
/// restarted here.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("Ya tienes la última versión.".into());
    };
    log::line(format!("update: installing {}", update.version));
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("No se pudo instalar la actualización: {e}"))?;
    app.restart();
}

fn mode(app: &AppHandle) -> String {
    app.try_state::<Shared>()
        .map(|s| s.settings.lock().unwrap().updates.clone())
        .unwrap_or_else(|| "auto".into())
}

/// Looks 30 s after launch, then every 6 hours. Tells both windows when there
/// is something new (once per version); "off" means not even looking.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let mut announced = String::new();
        loop {
            if mode(&app) != "off" {
                match check(&app).await {
                    Ok(Some(info)) if info.version != announced => {
                        log::line(format!("update: {} available (this is {})", info.version, info.current));
                        announced = info.version.clone();
                        let _ = app.emit("update-available", info);
                    }
                    Ok(_) => {}
                    Err(err) => log::line(format!("update: {err}")),
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
        }
    });
}
