//! AI providers. API keys live in the system keychain and never reach the web
//! view: the UI sends a request without credentials, and this module adds the
//! key and forwards it to the provider's own host, streaming the answer back.
//! Only the provider's API paths the app needs are allowed.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::sync::Notify;

const KEYCHAIN_SERVICE: &str = "io.zadum.app";
const ANTHROPIC_BASE: &str = "https://api.anthropic.com";
const OPENAI_BASE: &str = "https://api.openai.com";

/// Keys read from the keychain once per run (each read may ask the user), and requests that can be cancelled.
#[derive(Default)]
pub struct AiState {
    keys: Mutex<HashMap<String, Option<String>>>,
    running: Mutex<HashMap<String, Arc<Notify>>>,
}

fn provider_account(provider: &str) -> Result<&'static str, String> {
    match provider {
        "anthropic" => Ok("anthropic-api-key"),
        "openai" => Ok("openai-api-key"),
        _ => Err(format!("неизвестный провайдер: {provider}")),
    }
}

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, provider_account(provider)?).map_err(|e| format!("Связка ключей недоступна: {e}"))
}

fn read_key(state: &AiState, provider: &str) -> Result<Option<String>, String> {
    if let Some(cached) = state.keys.lock().unwrap().get(provider) {
        return Ok(cached.clone());
    }
    let key = match entry(provider)?.get_password() {
        Ok(k) if !k.trim().is_empty() => Some(k.trim().to_string()),
        Ok(_) | Err(keyring::Error::NoEntry) => None,
        Err(e) => return Err(format!("Не удалось прочитать ключ из связки ключей: {e}")),
    };
    state.keys.lock().unwrap().insert(provider.to_string(), key.clone());
    Ok(key)
}

fn require_key(state: &AiState, provider: &str) -> Result<String, String> {
    read_key(state, provider)?.ok_or_else(|| "NO_KEY".to_string())
}

#[derive(Serialize)]
pub struct KeyStatus {
    anthropic: bool,
    openai: bool,
}

/// Which providers have a key saved (the keys themselves are never returned).
#[tauri::command]
pub fn ai_key_status(state: State<'_, AiState>) -> Result<KeyStatus, String> {
    Ok(KeyStatus { anthropic: read_key(&state, "anthropic")?.is_some(), openai: read_key(&state, "openai")?.is_some() })
}

/// Saves a provider's key in the keychain; an empty key removes it.
#[tauri::command]
pub fn ai_set_key(state: State<'_, AiState>, provider: String, key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    let entry = entry(&provider)?;
    if key.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(format!("Не удалось удалить ключ: {e}")),
        }
        state.keys.lock().unwrap().insert(provider, None);
    } else {
        if key.len() > 400 || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err("Это не похоже на ключ API".into());
        }
        entry.set_password(&key).map_err(|e| format!("Не удалось сохранить ключ в связке ключей: {e}"))?;
        state.keys.lock().unwrap().insert(provider, Some(key));
    }
    Ok(())
}

/// What the UI receives for one proxied request, in order: head, chunks, end (or error).
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiEvent {
    Head { status: u16, headers: HashMap<String, String> },
    Chunk { text: String },
    End,
    Error { message: String },
}

/// Only the Messages, token counting and Models endpoints; no path tricks.
fn allowed_anthropic_path(method: &str, path: &str) -> bool {
    let clean = !path.contains("..") && !path.contains("//") && !path.contains('\\') && !path.contains('@') && path.is_ascii();
    let (route, _query) = path.split_once('?').unwrap_or((path, ""));
    clean
        && match method {
            "POST" => route == "/v1/messages" || route == "/v1/messages/count_tokens",
            "GET" => route == "/v1/models" || route.starts_with("/v1/models/"),
            _ => false,
        }
}

/// Headers of the request the provider needs; credentials and everything else are dropped.
const FORWARDED: [&str; 4] = ["anthropic-version", "anthropic-beta", "content-type", "accept"];
/// Headers of the answer the SDK reads (request id, rate limits, retry hints).
fn returned(name: &str) -> bool {
    matches!(name, "content-type" | "request-id" | "retry-after" | "retry-after-ms" | "x-should-retry") || name.starts_with("anthropic-")
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Zadum/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        // A long silent pause while the model thinks is normal; the stream sends pings.
        .read_timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

/// Splits bytes into the longest valid UTF-8 text and the unfinished tail (a character cut by the network).
fn take_utf8(buffer: &mut Vec<u8>) -> String {
    let valid = match std::str::from_utf8(buffer) {
        Ok(_) => buffer.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        // Really invalid bytes: pass them on lossily rather than stall.
        Err(_) => buffer.len(),
    };
    let text = String::from_utf8_lossy(&buffer[..valid]).into_owned();
    buffer.drain(..valid);
    text
}

async fn forward(
    base: &str,
    key: &str,
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: Option<String>,
    mut emit: impl FnMut(AiEvent) -> bool,
) -> Result<(), String> {
    let client = http_client()?;
    let mut request = match method {
        "POST" => client.post(format!("{base}{path}")),
        _ => client.get(format!("{base}{path}")),
    };
    for (name, value) in headers {
        let name = name.to_ascii_lowercase();
        if FORWARDED.contains(&name.as_str()) {
            request = request.header(name, value);
        }
    }
    request = request.header("x-api-key", key);
    if let Some(body) = body {
        request = request.body(body);
    }
    let mut response = request.send().await.map_err(|e| format!("Нет связи с сервером ИИ: {e}"))?;
    let headers = response
        .headers()
        .iter()
        .filter(|(n, _)| returned(n.as_str()))
        .filter_map(|(n, v)| v.to_str().ok().map(|v| (n.as_str().to_string(), v.to_string())))
        .collect();
    if !emit(AiEvent::Head { status: response.status().as_u16(), headers }) {
        return Ok(());
    }
    let mut pending = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Связь с сервером ИИ оборвалась: {e}"))? {
        pending.extend_from_slice(&chunk);
        let text = take_utf8(&mut pending);
        if !text.is_empty() && !emit(AiEvent::Chunk { text }) {
            return Ok(());
        }
    }
    if !pending.is_empty() {
        emit(AiEvent::Chunk { text: String::from_utf8_lossy(&pending).into_owned() });
    }
    Ok(())
}

/// Sends one request to the Claude API with the saved key and streams the answer to the UI.
#[tauri::command]
pub async fn ai_fetch(
    state: State<'_, AiState>,
    id: String,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    on_event: Channel<AiEvent>,
) -> Result<(), String> {
    let method = method.to_ascii_uppercase();
    if !allowed_anthropic_path(&method, &path) {
        return Err(format!("запрос не разрешён: {method} {path}"));
    }
    let key = require_key(&state, "anthropic")?;
    let cancel = Arc::new(Notify::new());
    state.running.lock().unwrap().insert(id.clone(), cancel.clone());
    let channel = on_event.clone();
    let result = tokio::select! {
        r = forward(ANTHROPIC_BASE, &key, &method, &path, &headers, body, move |event| channel.send(event).is_ok()) => r,
        _ = cancel.notified() => Err("CANCELLED".to_string()),
    };
    state.running.lock().unwrap().remove(&id);
    match &result {
        Ok(()) => {
            let _ = on_event.send(AiEvent::End);
        }
        Err(message) => {
            let _ = on_event.send(AiEvent::Error { message: message.clone() });
        }
    }
    Ok(())
}

/// Stops a running request (the connection is dropped, so the model stops generating).
#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, id: String) {
    if let Some(cancel) = state.running.lock().unwrap().get(&id) {
        // notify_one keeps a permit, so a cancel that arrives before the request starts waiting still counts.
        cancel.notify_one();
    }
}

fn openai_error(status: reqwest::StatusCode, body: &str) -> String {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| body.chars().take(300).collect());
    format!("OpenAI ответил {}: {message}", status.as_u16())
}

fn decode_image(body: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let value: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("непонятный ответ OpenAI: {e}"))?;
    let b64 = value["data"][0]["b64_json"].as_str().ok_or("в ответе OpenAI нет изображения")?;
    base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| format!("изображение повреждено: {e}"))
}

async fn request_image(base: &str, key: &str, model: &str, prompt: &str, size: &str, quality: Option<&str>) -> Result<Vec<u8>, String> {
    let mut body = serde_json::json!({ "model": model, "prompt": prompt, "size": size, "n": 1 });
    if let Some(q) = quality.filter(|q| !q.is_empty()) {
        body["quality"] = serde_json::Value::String(q.to_string());
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("Zadum/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        // Complex pictures take minutes.
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(format!("{base}/v1/images/generations"))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Нет связи с OpenAI: {e}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(openai_error(status, &text));
    }
    decode_image(&text)
}

/// Generates a picture with OpenAI's image model and stores it in the media library.
#[tauri::command]
pub async fn ai_generate_image(
    app: AppHandle,
    state: State<'_, AiState>,
    prompt: String,
    size: String,
    model: String,
    quality: Option<String>,
) -> Result<crate::media::MediaInfo, String> {
    let sizes = ["1024x1024", "1536x1024", "1024x1536", "auto"];
    if !sizes.contains(&size.as_str()) {
        return Err(format!("размер не поддерживается: {size}"));
    }
    if prompt.trim().is_empty() {
        return Err("нет описания кадра".into());
    }
    if model.is_empty() || !model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_')) {
        return Err("неверное название модели".into());
    }
    let key = require_key(&state, "openai")?;
    let bytes = request_image(OPENAI_BASE, &key, &model, prompt.trim(), &size, quality.as_deref()).await?;
    crate::media::store_bytes(&app, &bytes, "кадр.png", "image/png")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn only_the_needed_api_paths_are_allowed() {
        assert!(allowed_anthropic_path("POST", "/v1/messages"));
        assert!(allowed_anthropic_path("POST", "/v1/messages?beta=true"));
        assert!(allowed_anthropic_path("POST", "/v1/messages/count_tokens"));
        assert!(allowed_anthropic_path("GET", "/v1/models?limit=1"));
        assert!(allowed_anthropic_path("GET", "/v1/models/claude-opus-5-5"));
        assert!(!allowed_anthropic_path("POST", "/v1/files"));
        assert!(!allowed_anthropic_path("DELETE", "/v1/messages"));
        assert!(!allowed_anthropic_path("GET", "/v1/models/../organizations"));
        assert!(!allowed_anthropic_path("POST", "/v1/messages@evil.example"));
        assert!(!allowed_anthropic_path("POST", "//evil.example/v1/messages"));
    }

    #[test]
    fn text_is_never_cut_in_the_middle_of_a_character() {
        let all = "Привет, мир".as_bytes();
        let mut buffer = all[..5].to_vec(); // "Пр" and half of "и"
        assert_eq!(take_utf8(&mut buffer), "Пр");
        buffer.extend_from_slice(&all[5..]);
        assert_eq!(take_utf8(&mut buffer), "ивет, мир");
        assert!(buffer.is_empty());
    }

    #[test]
    fn reads_the_picture_and_the_error_of_openai() {
        assert_eq!(decode_image(r#"{"data":[{"b64_json":"aGk="}]}"#).unwrap(), b"hi");
        assert!(decode_image(r#"{"data":[]}"#).is_err());
        let message = openai_error(reqwest::StatusCode::UNAUTHORIZED, r#"{"error":{"message":"Incorrect API key"}}"#);
        assert_eq!(message, "OpenAI ответил 401: Incorrect API key");
    }

    /// A one-request HTTP server: returns what it received and answers with `response`.
    fn serve_once(response: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut received = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = socket.read(&mut buf).unwrap();
                received.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&received).to_string();
                if let Some((head, body)) = text.split_once("\r\n\r\n") {
                    let length = head
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                        .unwrap_or(0);
                    if body.len() >= length {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            socket.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&received).to_string()
        });
        (base, handle)
    }

    #[tokio::test]
    async fn the_proxy_adds_the_key_and_drops_other_credentials() {
        let (base, server) = serve_once("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nrequest-id: req_1\r\nset-cookie: a=b\r\nconnection: close\r\n\r\nevent: ping\ndata: {\"type\":\"ping\"}\n\n");
        let headers = HashMap::from([
            ("anthropic-version".to_string(), "2023-06-01".to_string()),
            ("X-Api-Key".to_string(), "from-the-page".to_string()),
            ("Authorization".to_string(), "Bearer from-the-page".to_string()),
            ("Cookie".to_string(), "x=y".to_string()),
        ]);
        let mut events = Vec::new();
        forward(&base, "sk-real", "POST", "/v1/messages", &headers, Some("{\"a\":1}".into()), |e| {
            events.push(e);
            true
        })
        .await
        .unwrap();
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.starts_with("post /v1/messages http/1.1"));
        assert!(request.contains("x-api-key: sk-real"));
        assert!(request.contains("anthropic-version: 2023-06-01"));
        assert!(!request.contains("from-the-page"));
        assert!(!request.contains("cookie"));
        assert!(request.ends_with("{\"a\":1}"));
        match &events[0] {
            AiEvent::Head { status, headers } => {
                assert_eq!(*status, 200);
                assert_eq!(headers.get("request-id").map(String::as_str), Some("req_1"));
                assert!(!headers.contains_key("set-cookie"));
            }
            _ => panic!("the head comes first"),
        }
        let text: String = events.iter().filter_map(|e| if let AiEvent::Chunk { text } = e { Some(text.as_str()) } else { None }).collect();
        assert!(text.contains("\"type\":\"ping\""));
    }

    #[tokio::test]
    async fn an_image_request_carries_the_key_and_returns_the_bytes() {
        let (base, server) = serve_once("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 30\r\nconnection: close\r\n\r\n{\"data\":[{\"b64_json\":\"aGk=\"}]}");
        let bytes = request_image(&base, "sk-openai", "gpt-image-test", "кот на крыше", "1536x1024", Some("medium")).await.unwrap();
        assert_eq!(bytes, b"hi");
        let request = server.join().unwrap();
        assert!(request.to_ascii_lowercase().contains("authorization: bearer sk-openai"));
        assert!(request.contains("\"size\":\"1536x1024\""));
        assert!(request.contains("\"quality\":\"medium\""));
        assert!(request.contains("кот на крыше"));
    }
}
