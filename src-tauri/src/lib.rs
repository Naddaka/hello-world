mod links;
mod media;
mod milanote;

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
        .invoke_handler(tauri::generate_handler![
            media::media_location,
            media::import_media_file,
            media::save_media_bytes,
            media::import_media_url,
            media::download_media,
            media::read_text_file,
            media::delete_media,
            media::write_file,
            media::print_window,
            links::link_preview,
            milanote::milanote_open,
            milanote::milanote_run,
            milanote::milanote_close,
            milanote::milanote_deliver,
            milanote::milanote_read_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zadum");
}
