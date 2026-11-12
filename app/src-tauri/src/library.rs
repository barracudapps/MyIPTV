//! Commandes de la bibliothèque : films, séries, émissions, musique, radio, podcasts, livres audio.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use iptv_core::catalogs as cat;
use iptv_core::tmdb;
use iptv_core::util::stable_key;
use iptv_core::vod::{self, Person, Season, SearchField, VodDetail, VodFacets, VodItem, VodKind, VodPage, VodQuery, VodRef};
use iptv_core::xtream::XtreamAccount;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::get_json;
use crate::state::AppState;

type Res<T> = Result<T, String>;

/// Fiches détaillées gardées en mémoire avant de repartir de zéro.
const MAX_DETAILS: usize = 300;
type St<'a> = State<'a, Arc<AppState>>;

const META_TTL: u64 = 7 * 86_400;

/// Clés des services de métadonnées saisies par l'utilisateur (facultatives).
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetaKeys {
    pub tmdb: Option<String>,
    pub omdb: Option<String>,
    /// Langue des fiches, ex. « fr-FR ».
    pub language: Option<String>,
}

/// JSON d'une API, mis en cache sur disque (les fiches changent rarement).
async fn cached_json(st: &AppState, url: &str, bearer: Option<&str>) -> Res<serde_json::Value> {
    let path = st.cache_dir.join("meta").join(stable_key(&[url]));
    let fresh = std::fs::metadata(&path).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|a| a.as_secs() < META_TTL);
    if fresh {
        if let Some(v) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
            return Ok(v);
        }
    }
    let headers = bearer.map(|b| {
        let mut h = reqwest::header::HeaderMap::new();
        if let Ok(v) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", b.trim())) {
            h.insert(reqwest::header::AUTHORIZATION, v);
        }
        h
    });
    let v = get_json(st, url, headers).await?;
    let _ = std::fs::write(&path, serde_json::to_vec(&v).unwrap_or_default());
    Ok(v)
}

/// Identifiant utilisateur Jellyfin d'une source (conservé avec la source chargée).
async fn jellyfin_user(st: &AppState, source_id: &str) -> Option<String> {
    st.jellyfin_users.lock().await.get(source_id).cloned()
}

#[tauri::command]
pub async fn vod_query(st: St<'_>, query: VodQuery) -> Res<VodPage> {
    let all = st.vod_all.read().await;
    Ok(vod::query(&all, &query))
}

#[tauri::command]
pub async fn vod_facets(st: St<'_>, kind: Option<VodKind>, prefer_languages: Vec<String>, include_adult: bool) -> Res<VodFacets> {
    let all = st.vod_all.read().await;
    Ok(vod::facets(&all, kind, &prefer_languages, include_adult))
}

/// Contenus par identifiant TMDB (synchronisation de l'historique avec Trakt).
#[tauri::command]
pub async fn vod_by_tmdb(st: St<'_>, ids: Vec<u64>) -> Res<Vec<VodItem>> {
    Ok(vod::by_tmdb(&st.vod_all.read().await, &ids))
}

/// Recherche dans toutes les sections ; résultats groupés par section.
#[tauri::command]
pub async fn vod_search(st: St<'_>, text: String, field: SearchField, prefer_languages: Vec<String>, include_adult: bool, per_kind: usize) -> Res<HashMap<String, VodPage>> {
    let all = st.vod_all.read().await;
    let kinds = [VodKind::Movie, VodKind::Series, VodKind::Show, VodKind::Music, VodKind::Radio, VodKind::Podcast, VodKind::Audiobook];
    Ok(kinds
        .into_iter()
        .filter_map(|k| {
            let q = VodQuery { kind: Some(k), text: Some(text.clone()), field, prefer_languages: prefer_languages.clone(), include_adult, limit: Some(per_kind), ..Default::default() };
            let page = vod::query(&all, &q);
            let name = serde_json::to_value(k).ok()?.as_str()?.to_string();
            (page.total > 0).then_some((name, page))
        })
        .collect())
}

fn seasons_from(item: &VodItem, label: &str) -> Vec<Season> {
    let mut by: std::collections::BTreeMap<u32, Vec<_>> = Default::default();
    for e in &item.episodes {
        by.entry(e.season).or_default().push(e.clone());
    }
    by.into_iter().map(|(n, episodes)| Season { number: n, name: if label.is_empty() { format!("Saison {n}") } else { label.to_string() }, episodes }).collect()
}

/// Fiche telle que la source la fournit (épisodes, pistes, fichiers), sans métadonnées externes.
async fn source_detail(st: &AppState, item: &VodItem) -> Res<VodDetail> {
    let st = st;
    let item = item.clone();
    let kind = item.kind;
    let mut d = VodDetail {
        cast: item.cast.iter().map(|n| Person { name: n.clone(), ..Default::default() }).collect(),
        crew: item.directors.iter().map(|n| Person { name: n.clone(), role: Some(if matches!(kind, Some(VodKind::Audiobook)) { "Auteur" } else { "Réalisation" }.into()), ..Default::default() }).collect(),
        item: item.clone(),
        ..Default::default()
    };

    match &item.source_ref {
        VodRef::Xtream { server, username, password, id: xid, .. } => {
            let acc = XtreamAccount { server, username, password, output: "ts" };
            if kind == Some(VodKind::Series) {
                let j = get_json(&st, &format!("{}&series_id={xid}", acc.api_url(Some("get_series_info"))), None).await?;
                d = iptv_core::xtream::series_detail(&acc, item.clone(), &j);
            } else if let Ok(j) = get_json(&st, &format!("{}&vod_id={xid}", acc.api_url(Some("get_vod_info"))), None).await {
                d = iptv_core::xtream::movie_detail(item.clone(), &j);
            }
        }
        VodRef::Archive { identifier } => {
            let meta = cached_json(&st, &format!("https://archive.org/metadata/{identifier}"), None).await?;
            let video = matches!(kind, Some(VodKind::Movie) | Some(VodKind::Show));
            let files = cat::archive_files(&meta, video);
            if video {
                d.item.url = files.first().map(|f| f.url.clone());
                d.item.duration = d.item.duration.or(files.first().and_then(|f| f.duration));
                if d.item.url.is_none() {
                    return Err("Aucune version lisible de ce contenu n'est disponible.".into());
                }
            } else {
                let label = if kind == Some(VodKind::Audiobook) { "Chapitres" } else { "Pistes" };
                d.seasons = vec![Season { number: 1, name: label.into(), episodes: files }];
            }
        }
        VodRef::Jellyfin { server, token, id: jid } => {
            let user_id = jellyfin_user(&st, &item.source_id).await.ok_or("Source Jellyfin introuvable")?;
            let headers = crate::commands::jellyfin_headers(token);
            let full = get_json(&st, &iptv_core::jellyfin::item_url(server, &user_id, jid), Some(headers.clone())).await.unwrap_or_default();
            let eps = if kind == Some(VodKind::Series) { get_json(&st, &iptv_core::jellyfin::episodes_url(server, &user_id, jid), Some(headers)).await.ok() } else { None };
            d = iptv_core::jellyfin::detail(item.clone(), &full, eps.as_ref(), server, token);
        }
        VodRef::None => match kind {
            Some(VodKind::Podcast) => {
                let feed = item.url.clone().ok_or("Flux du podcast inconnu")?;
                let r = st.http.get(&feed).header(reqwest::header::USER_AGENT, "MyIPTV/0.1").timeout(Duration::from_secs(30)).send().await.map_err(|e| e.to_string())?;
                let bytes = r.bytes().await.map_err(|e| e.to_string())?;
                let (episodes, desc) = cat::rss_episodes(&bytes, &item.id);
                d.item.plot = d.item.plot.or(desc);
                d.seasons = vec![Season { number: 1, name: "Épisodes".into(), episodes }];
            }
            Some(VodKind::Series) => d.seasons = seasons_from(&item, ""),
            _ => {}
        },
    }

    Ok(d)
}

/// Fiche complète : données de la source, épisodes/pistes, puis TMDB/OMDb si une clé est fournie.
#[tauri::command]
pub async fn vod_detail(st: St<'_>, id: String, keys: MetaKeys) -> Res<VodDetail> {
    if let Some(d) = st.details.lock().await.get(&id) {
        return Ok(d.clone());
    }
    let item = {
        let all = st.vod_all.read().await;
        iptv_core::vod::find_copy(&all, &id).cloned().ok_or("Contenu introuvable (source désactivée ?)")?
    };
    let kind = item.kind;
    // Plusieurs sources pour ce contenu : si la première ne répond pas, la suivante prend le relais.
    // Une source qui tarde ne bloque pas la fiche quand d'autres copies existent.
    let first = if item.alternates.is_empty() {
        source_detail(&st, &item).await
    } else {
        tokio::time::timeout(Duration::from_secs(8), source_detail(&st, &item)).await.unwrap_or_else(|_| Err("La source ne répond pas.".into()))
    };
    let mut d = match first {
        Ok(d) => d,
        Err(first) => {
            let mut found = None;
            for alt in &item.alternates {
                if let Ok(Ok(mut alt_d)) = tokio::time::timeout(Duration::from_secs(8), source_detail(&st, alt)).await {
                    let alt_url = alt_d.item.url.take();
                    alt_d.item = VodItem { url: alt_url.or(item.url.clone()), ..item.clone() };
                    found = Some(alt_d);
                    break;
                }
            }
            found.ok_or(first)?
        }
    };

    // Métadonnées externes (films, séries, émissions).
    let lang = keys.language.clone().unwrap_or_else(|| "fr-FR".into());
    if let (Some(key), true) = (keys.tmdb.as_deref().filter(|k| !k.trim().is_empty()), matches!(kind, Some(VodKind::Movie) | Some(VodKind::Series) | Some(VodKind::Show))) {
        let bearer = tmdb::is_bearer(key).then_some(key);
        let tmdb_id = match d.item.tmdb_id {
            Some(t) => Some(t),
            None => cached_json(&st, &tmdb::search_url(kind, &d.item.title, d.item.year, key, &lang), bearer).await.ok().and_then(|j| tmdb::pick_search_result(&j, &d.item.title)),
        };
        if let Some(t) = tmdb_id {
            if let Ok(j) = cached_json(&st, &tmdb::details_url(kind, t, key, &lang), bearer).await {
                tmdb::apply_details(&mut d, &j);
            }
        }
    }
    if let (Some(key), Some(imdb)) = (keys.omdb.as_deref().filter(|k| !k.trim().is_empty()), d.item.imdb_id.clone()) {
        if let Ok(j) = cached_json(&st, &tmdb::omdb_url(&imdb, key), None).await {
            tmdb::apply_omdb(&mut d, &j);
        }
    }

    // Les données enrichies (casting, genres) profitent aussi à la recherche.
    {
        let mut all = st.vod_all.write().await;
        if let Some(i) = all.iter_mut().find(|i| i.id == id) {
            i.cast = d.item.cast.clone();
            i.directors = d.item.directors.clone();
            i.genres = d.item.genres.clone();
            i.tmdb_id = d.item.tmdb_id;
            i.plot = d.item.plot.clone();
            i.rating = d.imdb_rating.or(d.tmdb_rating).or(i.rating);
        }
    }
    {
        // Fiches gardées pour la session, dans une limite raisonnable de mémoire.
        let mut details = st.details.lock().await;
        if details.len() >= MAX_DETAILS {
            details.clear();
        }
        details.insert(id, d.clone());
    }
    Ok(d)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditView {
    #[serde(flatten)]
    pub credit: tmdb::Credit,
    /// Identifiant du contenu dans la bibliothèque, s'il est disponible.
    pub available_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonView {
    pub name: String,
    pub photo: Option<String>,
    pub biography: Option<String>,
    pub birthday: Option<String>,
    pub known_for: Option<String>,
    /// Contenus disponibles où la personne apparaît.
    pub items: Vec<VodItem>,
    /// Filmographie complète (TMDB), avec disponibilité.
    pub credits: Vec<CreditView>,
}

/// Tous les contenus d'un acteur / réalisateur, et sa filmographie si TMDB est configuré.
#[tauri::command]
pub async fn person(st: St<'_>, name: String, tmdb_id: Option<u64>, keys: MetaKeys) -> Res<PersonView> {
    let all = st.vod_all.read().await.clone();
    let mut items: Vec<VodItem> = vod::with_person(&all, &name).into_iter().cloned().collect();
    let mut view = PersonView { name: name.clone(), photo: None, biography: None, birthday: None, known_for: None, items: vec![], credits: vec![] };
    let lang = keys.language.clone().unwrap_or_else(|| "fr-FR".into());
    if let Some(key) = keys.tmdb.as_deref().filter(|k| !k.trim().is_empty()) {
        let bearer = tmdb::is_bearer(key).then_some(key);
        let pid = match tmdb_id {
            Some(p) => Some(p),
            None => cached_json(&st, &tmdb::person_search_url(&name, key, &lang), bearer).await.ok().and_then(|j| j["results"].as_array()?.first()?["id"].as_u64()),
        };
        if let Some(p) = pid {
            if let Ok(j) = cached_json(&st, &tmdb::person_url(p, key, &lang), bearer).await {
                let info = tmdb::person_info(&j);
                for c in &info.credits {
                    let matched = vod::match_filmography(&all, &[(c.title.clone(), c.year, Some(c.tmdb_id))]);
                    let available = matched.iter().find(|i| i.kind == Some(c.kind) || c.kind == VodKind::Movie).map(|i| i.id.clone());
                    if let Some(m) = matched.first() {
                        if !items.iter().any(|i| i.id == m.id) {
                            items.push((*m).clone());
                        }
                    }
                    view.credits.push(CreditView { credit: c.clone(), available_id: available });
                }
                view.photo = info.photo;
                view.biography = info.biography;
                view.birthday = info.birthday;
                view.known_for = info.known_for;
            }
        }
    }
    items.iter_mut().for_each(|i| i.episodes.clear());
    view.items = items;
    Ok(view)
}
