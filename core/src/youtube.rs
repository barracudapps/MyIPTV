//! Directs officiels publiés sur YouTube par les chaînes : lus avec le lecteur intégré
//! officiel (youtube-nocookie.com), jamais téléchargés.

pub const EMBED: &str = "https://www.youtube-nocookie.com/embed";

pub fn is_youtube(url: &str) -> bool {
    let u = url.to_lowercase();
    u.contains("youtube.com/") || u.contains("youtu.be/")
}

fn valid_id(id: &str, len: usize) -> bool {
    id.len() == len && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// URL du lecteur intégré quand l'adresse contient déjà l'identifiant (vidéo ou chaîne).
pub fn embed_from_url(url: &str) -> Option<String> {
    let after = |key: &str| url.split(key).nth(1).map(|r| r.split(['&', '?', '/', '#']).next().unwrap_or("").to_string());
    if let Some(id) = after("v=").or_else(|| after("youtu.be/")).or_else(|| after("/live/")).or_else(|| after("/embed/")).filter(|i| valid_id(i, 11)) {
        return Some(format!("{EMBED}/{id}?autoplay=1"));
    }
    after("/channel/").filter(|i| i.starts_with("UC") && valid_id(i, 24)).map(|c| format!("{EMBED}/live_stream?channel={c}&autoplay=1"))
}

/// Identifiant de chaîne trouvé dans la page publique d'une chaîne (`/c/…`, `/@…`, `/user/…`).
pub fn channel_id_from_page(html: &str) -> Option<String> {
    for marker in ["\"externalId\":\"", "\"channelId\":\"", "youtube.com/channel/"] {
        for part in html.split(marker).skip(1) {
            let id: String = part.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
            if id.starts_with("UC") && id.len() == 24 {
                return Some(id);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_embeds() {
        assert!(is_youtube("https://www.youtube.com/c/FRANCE24/live"));
        assert_eq!(embed_from_url("https://www.youtube.com/watch?v=abcdefghijk&t=1").unwrap(), format!("{EMBED}/abcdefghijk?autoplay=1"));
        assert_eq!(embed_from_url("https://youtu.be/abcdefghijk").unwrap(), format!("{EMBED}/abcdefghijk?autoplay=1"));
        assert_eq!(
            embed_from_url("https://www.youtube.com/channel/UCQfwfsi5VrQ8yKZ-UWmAEFg/live").unwrap(),
            format!("{EMBED}/live_stream?channel=UCQfwfsi5VrQ8yKZ-UWmAEFg&autoplay=1")
        );
        assert_eq!(embed_from_url("https://www.youtube.com/c/FRANCE24/live"), None);
        let page = r#"<meta itemprop="identifier"><script>var x = {"externalId":"UCQfwfsi5VrQ8yKZ-UWmAEFg","other":1}</script>"#;
        assert_eq!(channel_id_from_page(page).as_deref(), Some("UCQfwfsi5VrQ8yKZ-UWmAEFg"));
    }
}
