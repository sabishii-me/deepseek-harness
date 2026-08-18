mod backend;
mod terminal_server;

use tauri::{Manager, RunEvent, WindowEvent};

fn main() {
    let app = tauri::Builder::default()
        .manage(backend::BackendState::new())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "main WebView window was not created".to_owned())?;
            backend::start(app.handle().clone(), window);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build DeepSeek Harness desktop application");

    app.run(|handle, event| match event {
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { .. },
            ..
        }
        | RunEvent::ExitRequested { .. }
        | RunEvent::Exit => handle.state::<backend::BackendState>().terminate(),
        _ => {}
    });
}
