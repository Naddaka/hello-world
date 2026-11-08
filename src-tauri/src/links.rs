//! Link previews: title, description and image of a web page, fetched natively
//! (no browser CORS limits). Known media sites are asked through oEmbed, which is
//! more reliable than scraping their pages; everything else uses OpenGraph tags.

use std::sync::OnceLock;
use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub url: String,
    pub final_url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
}

#[derive(Deserialize)]
struct OEmbed {
    title: Option<String>,
    author_name: Option<String>,
    provider_name: Option<String>,
    thumbnail_url: Option<String>,
}

pub const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|e| e.to_string())
}

fn oembed_endpoint(url: &str) -> Option<String> {
    let enc = urlencoding(url);
    let host = url.split("//").nth(1)?.split('/').next()?.trim_start_matches("www.").trim_start_matches("m.");
    match host {
        "youtube.com" | "youtu.be" | "music.youtube.com" => Some(format!("https://www.youtube.com/oembed?format=json&url={enc}")),
        "vimeo.com" | "player.vimeo.com" => Some(format!("https://vimeo.com/api/oembed.json?url={enc}")),
        "open.spotify.com" => Some(format!("https://open.spotify.com/oembed?url={enc}")),
        "soundcloud.com" => Some(format!("https://soundcloud.com/oembed?format=json&url={enc}")),
        _ => None,
    }
}

fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .trim()
        .to_string()
}

/// Extracts OpenGraph / Twitter / standard meta values from a page's HTML.
pub fn parse_meta(html: &str, base: &str) -> LinkPreview {
    static META: OnceLock<Regex> = OnceLock::new();
    static ATTR: OnceLock<Regex> = OnceLock::new();
    static TITLE: OnceLock<Regex> = OnceLock::new();
    let meta = META.get_or_init(|| Regex::new(r"(?is)<meta\b[^>]*>").unwrap());
    let attr = ATTR.get_or_init(|| Regex::new(r#"(?is)\b(property|name|content)\s*=\s*("([^"]*)"|'([^']*)')"#).unwrap());
    let title_tag = TITLE.get_or_init(|| Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap());

    let head = &html[..html.len().min(400_000)];
    let mut p = LinkPreview::default();
    let mut description_fallback = None;
    for tag in meta.find_iter(head) {
        let (mut key, mut content) = (None, None);
        for c in attr.captures_iter(tag.as_str()) {
            let value = c.get(3).or_else(|| c.get(4)).map(|m| m.as_str().to_string());
            match c[1].to_ascii_lowercase().as_str() {
                "content" => content = value,
                _ => key = value.map(|v| v.to_ascii_lowercase()),
            }
        }
        let (Some(key), Some(content)) = (key, content) else { continue };
        let content = decode_entities(&content);
        if content.is_empty() {
            continue;
        }
        match key.as_str() {
            "og:title" | "twitter:title" if p.title.is_none() => p.title = Some(content),
            "og:description" | "twitter:description" if p.description.is_none() => p.description = Some(content),
            "description" => description_fallback = Some(content),
            "og:image" | "og:image:url" | "og:image:secure_url" | "twitter:image" | "twitter:image:src" if p.image_url.is_none() => {
                p.image_url = Some(resolve(base, &content))
            }
            "og:site_name" if p.site_name.is_none() => p.site_name = Some(content),
            _ => {}
        }
    }
    if p.description.is_none() {
        p.description = description_fallback;
    }
    if p.title.is_none() {
        p.title = title_tag.captures(head).map(|c| decode_entities(&c[1])).filter(|t| !t.is_empty());
    }
    p
}

/// Resolves a possibly relative URL against the page URL.
fn resolve(base: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    let scheme_end = base.find("://").map(|i| i + 3).unwrap_or(0);
    let origin_end = base[scheme_end..].find('/').map(|i| i + scheme_end).unwrap_or(base.len());
    if let Some(rest) = href.strip_prefix("//") {
        return format!("{}{}", &base[..scheme_end], rest);
    }
    if href.starts_with('/') {
        return format!("{}{}", &base[..origin_end], href);
    }
    let dir_end = base.rfind('/').filter(|&i| i >= origin_end).map(|i| i + 1).unwrap_or(base.len());
    format!("{}{}{}", &base[..dir_end], if dir_end == base.len() { "/" } else { "" }, href)
}

#[tauri::command]
pub async fn link_preview(url: String) -> Result<LinkPreview, String> {
    let http = client()?;
    if let Some(endpoint) = oembed_endpoint(&url) {
        if let Ok(resp) = http.get(&endpoint).send().await {
            if let Ok(o) = resp.json::<OEmbed>().await {
                return Ok(LinkPreview {
                    final_url: url.clone(),
                    url,
                    title: o.title,
                    description: o.author_name,
                    image_url: o.thumbnail_url,
                    site_name: o.provider_name,
                });
            }
        }
    }
    let resp = http.get(&url).send().await.map_err(|e| e.to_string())?;
    let final_url = resp.url().to_string();
    let is_html = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("html"))
        .unwrap_or(true);
    if !is_html {
        return Ok(LinkPreview { url, final_url, ..Default::default() });
    }
    let html = resp.text().await.map_err(|e| e.to_string())?;
    let mut preview = parse_meta(&html, &final_url);
    preview.url = url;
    preview.final_url = final_url;
    Ok(preview)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_opengraph_tags_in_any_attribute_order() {
        let html = r#"<html><head><title>Fallback</title>
            <meta content="Синий час" property="og:title">
            <meta property='og:description' content='Как снимать &amp; когда'>
            <meta property="og:image" content="/img/cover.jpg">
            <meta name="description" content="ignored">
            </head></html>"#;
        let p = parse_meta(html, "https://example.com/blog/post");
        assert_eq!(p.title.as_deref(), Some("Синий час"));
        assert_eq!(p.description.as_deref(), Some("Как снимать & когда"));
        assert_eq!(p.image_url.as_deref(), Some("https://example.com/img/cover.jpg"));
    }

    #[test]
    fn falls_back_to_title_tag_and_meta_description() {
        let p = parse_meta("<title> Страница </title><meta name=\"description\" content=\"Описание\">", "https://a.b/");
        assert_eq!(p.title.as_deref(), Some("Страница"));
        assert_eq!(p.description.as_deref(), Some("Описание"));
    }

    #[test]
    fn resolves_relative_urls() {
        assert_eq!(resolve("https://a.com/x/y", "z.png"), "https://a.com/x/z.png");
        assert_eq!(resolve("https://a.com/x/y", "//cdn.a.com/z.png"), "https://cdn.a.com/z.png");
        assert_eq!(resolve("https://a.com", "/z.png"), "https://a.com/z.png");
    }

    #[test]
    fn picks_oembed_for_known_media_sites() {
        assert!(oembed_endpoint("https://www.youtube.com/watch?v=abc").unwrap().starts_with("https://www.youtube.com/oembed"));
        assert!(oembed_endpoint("https://youtu.be/abc").is_some());
        assert!(oembed_endpoint("https://vimeo.com/123").is_some());
        assert!(oembed_endpoint("https://example.com/").is_none());
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;

    /// Needs internet: `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn fetches_real_previews() {
        for url in ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://vimeo.com/76979871", "https://en.wikipedia.org/wiki/Cinematography", "https://www.rust-lang.org/"] {
            let p = link_preview(url.to_string()).await.expect(url);
            println!("{url} -> {:?} | {:?} | {:?}", p.title, p.site_name, p.image_url);
            assert!(p.title.is_some(), "{url}");
        }
    }
}
