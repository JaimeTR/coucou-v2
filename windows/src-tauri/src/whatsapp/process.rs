// GOWA process management: start, stop, locate the binary.

use std::path::PathBuf;

pub fn working_dir() -> PathBuf {
    PathBuf::from(".")
}

pub fn installed_binary() -> PathBuf {
    PathBuf::from("gowa")
}

pub fn stop_now() {
    // No-op stub.
}

pub fn start_gowa() {
    // No-op stub: GOWA start logic is implemented in install.rs / process.rs of the upstream.
}