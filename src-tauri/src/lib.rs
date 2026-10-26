#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            use tauri::image::Image;
            use tauri::Manager;

            if let Some(window) = app.get_webview_window("main") {
                // include_bytes is relative to this source file (src/lib.rs)
                let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))
                    .expect("decode window icon");
                let _ = window.set_icon(icon);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
