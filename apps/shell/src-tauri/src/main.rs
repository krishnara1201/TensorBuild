mod engine;

use std::sync::{Arc, Mutex};
use std::time::Duration;

struct EnginePort(u16);
struct EngineProcess(Arc<Mutex<Option<std::process::Child>>>);

#[tauri::command]
fn engine_base_url(port: tauri::State<EnginePort>) -> String {
    format!("http://127.0.0.1:{}", port.0)
}

fn main() {
    let port = engine::pick_free_port().expect("failed to find a free port for the engine");

    let child = engine::spawn_engine(port).expect("failed to spawn the engine process");
    let child = Arc::new(Mutex::new(Some(child)));

    if !engine::wait_for_ready(port, Duration::from_secs(10)) {
        if let Some(mut c) = child.lock().unwrap().take() {
            engine::kill_engine(&mut c);
        }
        panic!("engine did not become ready on port {port} within 10s");
    }

    let build_result = tauri::Builder::default()
        .manage(EnginePort(port))
        .manage(EngineProcess(child.clone()))
        .invoke_handler(tauri::generate_handler![engine_base_url])
        .build(tauri::generate_context!());

    let app = match build_result {
        Ok(app) => app,
        Err(err) => {
            if let Some(mut c) = child.lock().unwrap().take() {
                engine::kill_engine(&mut c);
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
            if let Some(mut c) = taken {
                engine::kill_engine(&mut c);
            }
        }
    });
}
