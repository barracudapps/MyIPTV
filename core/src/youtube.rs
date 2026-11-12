//! Directs officiels publiés par les chaînes sur YouTube et Dailymotion : lus avec les
//! lecteurs intégrés officiels de ces plateformes, jamais téléchargés.

pub const EMBED: &str = "https://www.youtube-nocookie.com/embed";

pub fn is_youtube(url: &str) -> bool {
    let u = url.to_lowercase();
    u.contains("youtube.com/") || u.contains("youtu.be/")
}

pub fn is_dailymotion(url: &str) -> bool {
    let u = url.to_lowercase();
    u.contains("dailymotion.com/") || u.contains("dai.ly/")
}

/// Lecteur intégré officiel Dailymotion (`/video/<id>` ou `dai.ly/<id>`).
pub fn dailymotion_embed(url: &str) -> Option<String> {
    let id = url.split("/video/").nth(1).or_else(|| url.split("dai.ly/").nth(1))?;
    let id: String = id.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    (id.len() >= 5).then(|| format!("https://www.dailymotion.com/embed/video/{id}?autoplay=1"))
}

/// Lecteur intégré, quelle que soit la plateforme, quand l'adresse suffit.
pub fn embed_for(url: &str) -> Option<String> {
    if is_dailymotion(url) {
        dailymotion_embed(url)
    } else {
        embed_from_url(url)
    }
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

/// Lecteur intégré à partir de la page publique d'un direct ou d'une chaîne (`/c/…/live`, `/@…`) :
/// la vidéo du direct en cours (lien canonique) en priorité, sinon le direct de la chaîne.
pub fn embed_from_page(html: &str) -> Option<String> {
    if let Some(rest) = html.split(r#"<link rel="canonical" href="https://www.youtube.com/watch?v="#).nth(1) {
        let id: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        if valid_id(&id, 11) {
            return Some(format!("{EMBED}/{id}?autoplay=1"));
        }
    }
    channel_id_from_page(html).map(|c| format!("{EMBED}/live_stream?channel={c}&autoplay=1"))
}

/// Identifiant de chaîne trouvé dans la page publique d'une chaîne (`/c/…`, `/@…`, `/user/…`).
pub fn channel_id_from_page(html: &str) -> Option<String> {
    for marker in ["\"externalId\":\"", "\"channelId\":\"", "\"browseId\":\"", "youtube.com/channel/"] {
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
        let live = r#"<link rel="canonical" href="https://www.youtube.com/watch?v=lxUYRSdmSQw">"channelId":"UCO6K_kkdP-lnSCiO3tPx7WA""#;
        assert_eq!(embed_from_page(live).unwrap(), format!("{EMBED}/lxUYRSdmSQw?autoplay=1"));
        assert_eq!(embed_for("https://www.dailymotion.com/video/x3b68jn").unwrap(), "https://www.dailymotion.com/embed/video/x3b68jn?autoplay=1");
        assert!(is_dailymotion("https://www.dailymotion.com/video/x2lefik"));
    }
}
