/// Starts the window. The folder dialog adds the picked folder to the file plugin's scope at
/// runtime and persisted-scope restores it after a restart (docs/rules/disco-app.md); it is
/// registered after the file plugin, whose scope it reads at setup. The updater checks for a new
/// version (the app's only network call) and the process plugin restarts after installing it.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
