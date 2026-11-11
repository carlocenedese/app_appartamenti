/// Starts the window. The page shows the engine version and nothing else yet: there are no
/// commands and no plugins (the real functions arrive with the later plans).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
