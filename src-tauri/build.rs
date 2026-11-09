// Every app command is listed so it gets an `allow-…` permission. Once the app
// has such a manifest, Tauri checks all commands against the capabilities:
// the main window is granted all of them (capabilities/default.json), the
// Milanote sign-in window only the one it needs (capabilities/milanote.json).
const COMMANDS: &[&str] = &[
    "media_location",
    "import_media_file",
    "save_media_bytes",
    "import_media_url",
    "download_media",
    "read_text_file",
    "delete_media",
    "prune_media",
    "media_frame_rate",
    "write_file",
    "print_window",
    "link_preview",
    "milanote_open",
    "milanote_run",
    "milanote_close",
    "milanote_deliver",
    "milanote_read_export",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run the Tauri build script");
}
