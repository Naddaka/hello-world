mod links;
mod media;
mod milanote;
mod video;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Database file inside the app's data directory.
pub const DB_URL: &str = "sqlite:zadum.db";

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create elements table",
        sql: "CREATE TABLE IF NOT EXISTS elements (
                id TEXT PRIMARY KEY NOT NULL,
                parent_id TEXT,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
              );
              CREATE INDEX IF NOT EXISTS idx_elements_parent ON elements(parent_id);",
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Reopen the main window where and as big as it was left.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[milanote::WINDOW])
                .build(),
        )
        .manage(milanote::ExportState::default())
        // Closing the main window quits the app (with the Milanote sign-in window, if open),
        // as on Cmd+Q; the page saves its data before it lets the window close.
        .on_window_event(|window, event| {
            use tauri::Manager;
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            media::media_location,
            media::import_media_file,
            media::save_media_bytes,
            media::import_media_url,
            media::download_media,
            media::read_text_file,
            media::delete_media,
            media::prune_media,
            media::media_frame_rate,
            media::write_file,
            media::print_window,
            links::link_preview,
            milanote::milanote_open,
            milanote::milanote_run,
            milanote::milanote_close,
            milanote::milanote_deliver,
            milanote::milanote_read_export,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Zadum")
        .run(|app, event| {
            // Cmd+Q and other quits from the system: close the main window instead, so the
            // page saves what was just typed; closing it then quits (see on_window_event).
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event {
                use tauri::Manager;
                if let Some(main) = app.get_webview_window("main") {
                    api.prevent_exit();
                    let _ = main.close();
                    // Never let a stuck page keep the app from quitting.
                    let handle = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        handle.exit(0);
                    });
                }
            }
        });
}
