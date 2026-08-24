mod engine;

use std::sync::{Arc, Mutex};
use std::time::Duration;

struct EnginePort(u16);
struct EngineProcess(Arc<Mutex<Option<engine::EngineChild>>>);

#[tauri::command]
fn engine_base_url(port: tauri::State<EnginePort>) -> String {
    format!("http://127.0.0.1:{}", port.0)
}

fn main() {
    let port = engine::pick_free_port().expect("failed to find a free port for the engine");
    let child: Arc<Mutex<Option<engine::EngineChild>>> = Arc::new(Mutex::new(None));
    let child_for_setup = child.clone();

    // `cargo tauri dev` builds in debug mode, so it keeps spawning the
    // engine straight out of the repo's `.venv` (spawn_engine); a release
    // build spawns the packaged tensorbuild-engine sidecar instead. Both
    // need to happen inside `.setup()`, since the sidecar path needs an
    // AppHandle to resolve the bundled binary.
    let build_result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(EnginePort(port))
        .manage(EngineProcess(child.clone()))
        .invoke_handler(tauri::generate_handler![engine_base_url])
        .setup(move |app| {
            // The sidecar is a PyInstaller onefile binary, which re-extracts
            // its ~2GB payload to a temp directory on every launch (not just
            // the first) before Python even starts — much slower than the
            // dev path's plain `uvicorn`, which needs no extraction step.
            let (spawned, ready_timeout) = if cfg!(debug_assertions) {
                let child = engine::spawn_engine(port)
                    .map(engine::EngineChild::Dev)
                    .expect("failed to spawn the dev engine process");
                (child, Duration::from_secs(10))
            } else {
                let child = engine::spawn_sidecar_engine(app.handle(), port)
                    .map(engine::EngineChild::Sidecar)
                    .expect("failed to spawn the engine sidecar");
                (child, Duration::from_secs(60))
            };
            *child_for_setup.lock().unwrap() = Some(spawned);

            if !engine::wait_for_ready(port, ready_timeout) {
                if let Some(c) = child_for_setup.lock().unwrap().take() {
                    c.kill();
                }
                panic!(
                    "engine did not become ready on port {port} within {}s",
                    ready_timeout.as_secs()
                );
            }

            Ok(())
        })
        .build(tauri::generate_context!());

    let app = match build_result {
        Ok(app) => app,
        Err(err) => {
            if let Some(c) = child.lock().unwrap().take() {
                c.kill();
            }
            panic!("error while building tauri application: {err}");
        }
    };

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            use tauri::Manager;
            let state = app_handle.state::<EngineProcess>();
            let taken = state.0.lock().unwrap().take();
            if let Some(c) = taken {
                c.kill();
            }
        }
    });
}
