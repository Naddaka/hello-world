//! Import from Milanote: a window where the user signs in to Milanote
//! themselves, and a channel through which the export script running in that
//! page hands the collected boards back to Zadum. Zadum never sees the password;
//! the page only reads the user's own data, as the Milanote client does.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub const WINDOW: &str = "milanote";
const START_URL: &str = "https://app.milanote.com/";

/// The export being received, written to disk chunk by chunk.
#[derive(Default)]
pub struct ExportState {
    file: Mutex<Option<std::fs::File>>,
}

#[derive(Serialize, Clone)]
struct ExportEvent {
    kind: String,
    data: String,
}

fn export_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("milanote-export.json"))
}

fn start_url() -> String {
    // Tests point the window at a local stand-in for Milanote.
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("ZADUM_MILANOTE_URL") {
        return url;
    }
    START_URL.to_string()
}

/// Opens (or brings forward) the Milanote window.
#[tauri::command]
pub async fn milanote_open(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let url = start_url().parse().map_err(|e| format!("{e}"))?;
    let window = WebviewWindowBuilder::new(&app, WINDOW, WebviewUrl::External(url))
        .title("Milanote — войдите, затем вернитесь в Zadum")
        .inner_size(1180.0, 820.0)
        .build()
        .map_err(|e| e.to_string())?;
    // Tell the import dialog when the user closes the window, so it does not offer to start an export.
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = handle.emit_to("main", "milanote-export", ExportEvent { kind: "closed".into(), data: String::new() });
        }
    });
    Ok(())
}

/// Runs the export script inside the signed-in Milanote page.
#[tauri::command]
pub fn milanote_run(app: AppHandle, script: String) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW)
        .ok_or("Окно Milanote закрыто. Откройте его и войдите.")?;
    window
        .eval(format!("({script})({{ tauri: true }}).catch(function () {{}});"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn milanote_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Called by the export script in the Milanote page (the only command that page may call).
#[tauri::command]
pub fn milanote_deliver(
    app: AppHandle,
    webview: tauri::Webview,
    state: State<'_, ExportState>,
    kind: String,
    data: String,
) -> Result<(), String> {
    if webview.label() != WINDOW {
        return Err("not allowed".into());
    }
    let mut file = state.file.lock().map_err(|e| e.to_string())?;
    match kind.as_str() {
        "begin" => {
            *file = Some(std::fs::File::create(export_path(&app)?).map_err(|e| e.to_string())?);
        }
        "chunk" => {
            let f = file.as_mut().ok_or("экспорт не начат")?;
            f.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        }
        "done" => {
            if let Some(mut f) = file.take() {
                f.flush().map_err(|e| e.to_string())?;
            }
        }
        "error" => {
            file.take();
        }
        "progress" => {}
        _ => return Err("unknown message".into()),
    }
    if kind != "chunk" {
        app.emit_to("main", "milanote-export", ExportEvent { kind, data })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The last export received from the Milanote window.
#[tauri::command]
pub fn milanote_read_export(app: AppHandle) -> Result<String, String> {
    std::fs::read_to_string(export_path(&app)?).map_err(|e| format!("Файл экспорта не найден: {e}"))
}
