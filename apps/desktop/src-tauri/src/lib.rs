mod python_reader;

use python_reader::ReadError;
use std::path::Path;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// Reads one PDF with the bundled reader (plan 23): the PDF and the profiles folder must be in
/// the file scope, that is in the folder the user picked, as for every command of the file
/// plugin. In a debug build `PYTHON` may name another interpreter (the dev convention of the
/// tests and scripts/estratti.mjs); a release build only runs the `python/` resource.
fn read_bill(
    app: &tauri::AppHandle,
    pdf: &str,
    profiles: &str,
    at: &str,
    pages: Option<&str>,
) -> Result<String, ReadError> {
    let scope = app.try_fs_scope().ok_or(ReadError::Internal)?;
    let allowed = |path: &Path| scope.is_allowed(path);
    let pdf = python_reader::checked_path(pdf, false, &allowed)?;
    let profiles = python_reader::checked_path(profiles, true, &allowed)?;
    let resources = app
        .path()
        .resource_dir()
        .map_err(|_| ReadError::PythonMissing)?;
    let dev_override = if cfg!(debug_assertions) {
        std::env::var_os("PYTHON")
    } else {
        None
    };
    let interpreter = python_reader::choose_interpreter(
        python_reader::bundled_interpreter(&resources, cfg!(windows)),
        dev_override,
    );
    let ocr_data = python_reader::ocr_data(&resources);
    let args = python_reader::extract_args(&pdf, &profiles, at, pages, ocr_data.as_deref());
    python_reader::run(
        &interpreter,
        &args,
        python_reader::TIMEOUT,
        python_reader::MAX_STDOUT_BYTES,
    )
}

/// The stdout of `python -I -m bollette_pdf extract`, or `{ code, message }` in Italian. Off the
/// main thread: the window stays responsive while Python reads.
#[tauri::command]
async fn read_bill_pdf(
    app: tauri::AppHandle,
    pdf: String,
    profiles: String,
    at: String,
    pages: Option<String>,
) -> Result<String, serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || {
        read_bill(&app, &pdf, &profiles, &at, pages.as_deref())
    })
    .await
    .unwrap_or(Err(ReadError::Internal))
    .map_err(|error| error.to_value())
}

/// Starts the window. The folder dialog adds the picked folder to the file plugin's scope at
/// runtime and persisted-scope restores it after a restart (docs/rules/disco-app.md); it is
/// registered after the file plugin, whose scope it reads at setup. The updater checks for a new
/// version (the app's only network call) and the process plugin restarts after installing it.
/// `read_bill_pdf` is the app's only own command (plan 23).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![read_bill_pdf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
