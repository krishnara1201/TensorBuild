mod engine;

use std::sync::Mutex;
use std::time::Duration;

struct EnginePort(u16);
struct EngineProcess(Mutex<Option<std::process::Child>>);

#[tauri::command]
fn engine_base_url(port: tauri::State<EnginePort>) -> String {
    format!("http://127.0.0.1:{}", port.0)
}

fn main() {
    let port = engine::pick_free_port().expect("failed to find a free port for the engine");

    let child = engine::spawn_engine(port).expect("failed to spawn the engine process");

    if !engine::wait_for_ready(port, Duration::from_secs(10)) {
        panic!("engine did not become ready on port {port} within 10s");
    }

    tauri::Builder::default()
        .manage(EnginePort(port))
        .manage(EngineProcess(Mutex::new(Some(child))))
        .invoke_handler(tauri::generate_handler![engine_base_url])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                use tauri::Manager;
                let state = app_handle.state::<EngineProcess>();
                let mut guard = state.0.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    engine::kill_engine(&mut child);
                }
            }
        });
}
