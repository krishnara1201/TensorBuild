use std::io;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Either the dev-mode engine (spawned straight out of the repo's `.venv`,
/// see `spawn_engine`) or the packaged sidecar binary (see
/// `spawn_sidecar_engine`) — unified so callers have one thing to hold onto
/// and kill at exit regardless of which mode is running.
pub enum EngineChild {
    Dev(Child),
    Sidecar(CommandChild),
}

impl EngineChild {
    pub fn kill(self) {
        match self {
            EngineChild::Dev(mut c) => kill_engine(&mut c),
            EngineChild::Sidecar(c) => {
                let _ = c.kill();
            }
        }
    }
}

pub fn pick_free_port() -> io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.local_addr().map(|addr| addr.port())
}

fn venv_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR is apps/shell/src-tauri; the repo's .venv is three
    // levels up (src-tauri -> shell -> apps -> repo root). This only ever
    // resolves correctly in this dev checkout, not in a packaged build.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.venv")
}

pub fn spawn_engine(port: u16) -> io::Result<Child> {
    let uvicorn = venv_dir().join("bin").join("uvicorn");
    Command::new(uvicorn)
        .args(["vmb_engine.api:app", "--port", &port.to_string()])
        .spawn()
}

/// Spawns the packaged `tensorbuild-engine` sidecar binary (see
/// `bundle.externalBin` in tauri.conf.json), used for release/bundled
/// builds in place of `spawn_engine`'s repo-`.venv` dev path. Stderr lines
/// are forwarded to this process's stderr for debugging; stdout/other
/// events are drained but discarded so the sidecar's output channel never
/// backs up.
pub fn spawn_sidecar_engine(
    app: &tauri::AppHandle,
    port: u16,
) -> Result<CommandChild, tauri_plugin_shell::Error> {
    let sidecar = app.shell().sidecar("tensorbuild-engine")?;
    let (mut rx, child) = sidecar.args(["--port", &port.to_string()]).spawn()?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stderr(line) = event {
                eprintln!("[engine] {}", String::from_utf8_lossy(&line));
            }
        }
    });

    Ok(child)
}

pub fn wait_for_ready(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub fn kill_engine(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_free_port_returns_a_port_that_is_free_again_immediately() {
        let port = pick_free_port().expect("should find a free port");
        assert!(port > 0);
        TcpListener::bind(("127.0.0.1", port)).expect("port should be free to rebind");
    }

    #[test]
    fn wait_for_ready_returns_true_when_something_is_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(wait_for_ready(port, Duration::from_secs(1)));
    }

    #[test]
    fn wait_for_ready_times_out_when_nothing_is_listening() {
        let port = pick_free_port().unwrap();
        assert!(!wait_for_ready(port, Duration::from_millis(300)));
    }

    #[test]
    fn kill_engine_terminates_the_child_process() {
        let mut child = Command::new("sleep")
            .arg("30")
            .spawn()
            .expect("should spawn sleep");
        kill_engine(&mut child);
        let status = child.try_wait().expect("try_wait should not error");
        assert!(status.is_some(), "child should have exited after kill_engine");
    }
}
