//! Local media library: files dropped, pasted or downloaded into Zadum are
//! copied into `<app data>/media/<id>.<ext>` and referenced by id.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub id: String,
    pub ext: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Absolute path of the stored copy (turned into an asset URL by the UI).
    pub path: String,
}

pub fn media_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("media");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn mime_for(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" | "jpe" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "tif" | "tiff" => "image/tiff",
        "mp4" | "m4v" => "video/mp4",
        "mov" | "qt" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" | "wave" => "audio/wav",
        "aac" => "audio/aac",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "bin".into())
}

fn describe(path: &Path, id: String, ext: String, name: String) -> Result<MediaInfo, String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    let (width, height) = match imagesize::size(path) {
        Ok(dim) => (Some(dim.width as u32), Some(dim.height as u32)),
        Err(_) => (None, None),
    };
    Ok(MediaInfo {
        mime: mime_for(&ext).into(),
        id,
        ext,
        name,
        size,
        width,
        height,
        path: path.to_string_lossy().into_owned(),
    })
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Folder of the media library, so the UI can build asset URLs for stored files.
#[tauri::command]
pub fn media_location(app: AppHandle) -> Result<String, String> {
    Ok(media_dir(&app)?.to_string_lossy().into_owned())
}

/// Copies a file from disk (e.g. dropped from Finder) into the media library.
#[tauri::command]
pub async fn import_media_file(app: AppHandle, path: String) -> Result<MediaInfo, String> {
    let source = PathBuf::from(&path);
    let name = source.file_name().and_then(|n| n.to_str()).unwrap_or("файл").to_string();
    let ext = extension_of(&name);
    let id = new_id();
    let target = media_dir(&app)?.join(format!("{id}.{ext}"));
    tauri::async_runtime::spawn_blocking({
        let target = target.clone();
        move || std::fs::copy(&source, &target)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Не удалось скопировать {name}: {e}"))?;
    describe(&target, id, ext, name)
}

/// Stores bytes sent from the UI (pasted images, files picked in the browser view).
/// The request body is the raw file; its name comes in the `x-name` header.
#[tauri::command]
pub async fn save_media_bytes(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<MediaInfo, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("ожидались байты файла".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_decode(v))
        .unwrap_or_else(|| "вставка.png".into());
    // The type the UI knows (from the clipboard or the file itself) wins over a misleading name.
    let content_type = request.headers().get("x-type").and_then(|v| v.to_str().ok()).unwrap_or("");
    let ext = choose_extension(&name, content_type);
    let id = new_id();
    let target = media_dir(&app)?.join(format!("{id}.{ext}"));
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    describe(&target, id, ext, name)
}

/// Downloads a remote file (a link preview image) into the media library.
#[tauri::command]
pub async fn import_media_url(app: AppHandle, url: String) -> Result<MediaInfo, String> {
    let response = crate::links::client()?.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let ext = choose_extension(url.split(['?', '#']).next().unwrap_or(""), &content_type);
    let id = new_id();
    let target = media_dir(&app)?.join(format!("{id}.{ext}"));
    std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    let name = format!("превью.{ext}");
    describe(&target, id, ext, name)
}

/// Extension of a known media content type.
fn extension_for_type(content_type: &str) -> Option<&'static str> {
    Some(match content_type {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "image/heic" => "heic",
        "image/svg+xml" => "svg",
        "image/tiff" => "tif",
        "application/pdf" => "pdf",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        _ => return None,
    })
}

/// The extension a stored file gets: the one in its name, unless the file's
/// real type says otherwise (an SVG named "picture.jpg" is saved as .svg, so
/// it is served and shown as SVG).
fn choose_extension(name: &str, content_type: &str) -> String {
    let from_name = extension_of(name);
    let ct = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    match extension_for_type(&ct) {
        Some(ext) if from_name == "bin" || mime_for(ext) != mime_for(&from_name) => ext.into(),
        _ => from_name,
    }
}

/// Downloads a file of any size into the media library, streaming it to disk
/// (used by the Milanote import for images, videos and documents).
#[tauri::command]
pub async fn download_media(app: AppHandle, url: String, name: Option<String>) -> Result<MediaInfo, String> {
    use std::io::Write;
    let client = reqwest::Client::builder()
        .user_agent(crate::links::USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let name = name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| percent_decode(url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("файл")));
    let ext = choose_extension(&name, &content_type);
    let id = new_id();
    let target = media_dir(&app)?.join(format!("{id}.{ext}"));
    let partial = target.with_extension(format!("{ext}.part"));
    let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            file.write_all(&chunk).map_err(|e| e.to_string())?;
        }
        file.flush().map_err(|e| e.to_string())
    }
    .await;
    drop(file);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&partial);
        return Err(e);
    }
    std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    describe(&target, id, ext, name)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            // Slice bytes, not the str: a malformed header must not panic on a char boundary.
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_type_beats_a_misleading_name() {
        assert_eq!(choose_extension("изображение.jpg", "image/svg+xml"), "svg");
        assert_eq!(choose_extension("вставка", "image/png"), "png");
        assert_eq!(choose_extension("photo.JPEG", "image/jpeg"), "jpeg");
        assert_eq!(choose_extension("clip.m4v", "video/mp4"), "m4v");
        assert_eq!(choose_extension("take.wav", "audio/x-wav"), "wav");
        assert_eq!(choose_extension("notes.txt", "text/plain"), "txt");
        assert_eq!(choose_extension("raw.cr2", ""), "cr2");
        assert_eq!(choose_extension("a.png", "image/webp; charset=binary"), "webp");
    }

    #[test]
    fn decodes_percent_encoded_names() {
        assert_eq!(percent_decode("%D0%BA%D0%B0%D0%B4%D1%80.png"), "кадр.png");
        assert_eq!(percent_decode("plain.jpg"), "plain.jpg");
    }

    #[test]
    fn extensions_are_sanitised() {
        assert_eq!(extension_of("Clip.MOV"), "mov");
        assert_eq!(extension_of("noext"), "bin");
        assert_eq!(extension_of("weird.e/x"), "bin");
    }
}

/// Writes bytes sent from the UI to a path the user chose in the save dialog.
/// The body is the raw file; the path comes percent-encoded in `x-path`.
#[tauri::command]
pub async fn write_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("ожидались байты файла".into());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or("не указан путь")?;
    std::fs::write(&path, bytes).map_err(|e| format!("Не удалось сохранить {path}: {e}"))
}

/// Opens the system print dialog for the window (macOS offers "Save as PDF").
#[tauri::command]
pub fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Reads a text file the user dropped or picked (screenplays in Fountain or Final Draft format).
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > 20 * 1024 * 1024 {
        return Err("Файл слишком большой для сценария".into());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать файл: {e}"))
}

/// Removes files from the media library that nothing refers to any more
/// (e.g. the pictures of a Milanote import that was replaced).
#[tauri::command]
pub fn delete_media(app: AppHandle, files: Vec<String>) -> Result<usize, String> {
    let dir = media_dir(&app)?;
    let mut removed = 0;
    for file in files {
        // Only plain library names ("<id>.<ext>"), never a path.
        let (id, ext) = file.split_once('.').ok_or("неверное имя файла")?;
        let valid = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric()) && !ext.is_empty() && ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric());
        if !valid {
            return Err(format!("неверное имя файла: {file}"));
        }
        if std::fs::remove_file(dir.join(&file)).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}
