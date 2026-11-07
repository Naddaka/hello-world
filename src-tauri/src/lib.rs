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
        .run(tauri::generate_context!())
        .expect("error while running Zadum");
}
