//! Liaisons WebAssembly pour la version web / smart TV.

use std::cell::RefCell;

use wasm_bindgen::prelude::*;

use crate::model::Channel;
use crate::xmltv::{parse_xmltv, Epg, EpgFilter};
use crate::xtream::{live_channels, XtreamAccount};

thread_local! {
    static EPG: RefCell<Epg> = RefCell::new(Epg::default());
}

/// Passage par une chaîne JSON : le `JSON.parse` du moteur JavaScript construit les
/// gros tableaux (dizaines de milliers de chaînes) plus vite qu'objet par objet.
fn to_js<T: serde::Serialize>(v: &T) -> Result<JsValue, JsValue> {
    let text = serde_json::to_string(v).map_err(err)?;
    js_sys::JSON::parse(&text)
}

fn err(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}

#[wasm_bindgen(js_name = parseM3u)]
pub fn parse_m3u(text: &str, source_id: &str) -> Result<JsValue, JsValue> {
    to_js(&crate::m3u::parse_m3u(text, source_id))
}

#[wasm_bindgen(js_name = xtreamApiUrl)]
pub fn xtream_api_url(server: &str, username: &str, password: &str, action: Option<String>) -> String {
    XtreamAccount { server, username, password, output: "ts" }.api_url(action.as_deref())
}

#[wasm_bindgen(js_name = xtreamXmltvUrl)]
pub fn xtream_xmltv_url(server: &str, username: &str, password: &str) -> String {
    XtreamAccount { server, username, password, output: "ts" }.xmltv_url()
}

#[wasm_bindgen(js_name = xtreamChannels)]
pub fn xtream_channels(server: &str, username: &str, password: &str, output: &str, source_id: &str, categories: &str, streams: &str) -> Result<JsValue, JsValue> {
    let acc = XtreamAccount { server, username, password, output };
    let cats: serde_json::Value = serde_json::from_str(categories).map_err(err)?;
    let st: serde_json::Value = serde_json::from_str(streams).map_err(err)?;
    to_js(&live_channels(&acc, source_id, &cats, &st))
}

/// Analyse un guide (gzip accepté) et le fusionne dans le guide en mémoire.
#[wasm_bindgen(js_name = loadEpg)]
pub fn load_epg(bytes: &[u8], channels: JsValue, from: f64, to: f64) -> Result<usize, JsValue> {
    let channels: Vec<Channel> = serde_wasm_bindgen::from_value(channels)?;
    let xml = crate::util::maybe_gunzip(bytes).map_err(err)?;
    let filter = EpgFilter::for_channels(&channels, from as i64, to as i64);
    let parsed = parse_xmltv(&xml, Some(&filter)).map_err(err)?;
    let n = parsed.programmes.values().map(Vec::len).sum();
    EPG.with(|e| e.borrow_mut().merge(parsed));
    Ok(n)
}

#[wasm_bindgen(js_name = clearEpg)]
pub fn clear_epg() {
    EPG.with(|e| *e.borrow_mut() = Epg::default());
}

/// Programmes d'un lot de chaînes : `{ [channelId]: Programme[] }`.
#[wasm_bindgen(js_name = programmes)]
pub fn programmes(channels: JsValue, from: f64, to: f64) -> Result<JsValue, JsValue> {
    let channels: Vec<Channel> = serde_wasm_bindgen::from_value(channels)?;
    let map: std::collections::HashMap<String, _> =
        EPG.with(|e| channels.iter().map(|c| (c.id.clone(), e.borrow().for_channel(c, from as i64, to as i64))).collect());
    to_js(&map)
}

#[wasm_bindgen(js_name = catchupUrl)]
pub fn catchup_url(channel: JsValue, start: f64, stop: f64, now: f64) -> Result<Option<String>, JsValue> {
    let ch: Channel = serde_wasm_bindgen::from_value(channel)?;
    Ok(crate::catchup::catchup_url(&ch, start as i64, stop as i64, now as i64))
}

#[wasm_bindgen(js_name = youtubeEmbed)]
pub fn youtube_embed(url: &str) -> Option<String> {
    crate::youtube::embed_for(url)
}

#[wasm_bindgen(js_name = isYoutube)]
pub fn is_youtube(url: &str) -> bool {
    crate::youtube::is_youtube(url) || crate::youtube::is_dailymotion(url)
}

#[wasm_bindgen(js_name = analyzeRisk)]
pub fn analyze_risk(channels: JsValue) -> Result<JsValue, JsValue> {
    let channels: Vec<Channel> = serde_wasm_bindgen::from_value(channels)?;
    to_js(&crate::risk::analyze(&channels))
}

#[wasm_bindgen(js_name = shareId)]
pub fn share_id(code: &str) -> String {
    crate::share::share_id(code)
}

#[wasm_bindgen(js_name = shareOpen)]
pub fn share_open(code: &str, data: &[u8]) -> Result<String, JsValue> {
    let plain = crate::share::open(code, data).map_err(err)?;
    String::from_utf8(plain).map_err(err)
}


// ------------------------------------------------------------------ Bibliothèque (films, séries…)
//
// Mêmes analyseurs que l'application native : la version web télécharge, le cœur
// analyse. Les réponses des API sont passées en texte JSON, sans conversion d'objets.

use crate::catalogs as cat;
use crate::vod::{self, SearchField, VodDetail, VodItem, VodKind, VodQuery};

thread_local! {
    /// Contenus par source, et vue regroupée pour les requêtes.
    static VOD: RefCell<(std::collections::BTreeMap<String, Vec<VodItem>>, Vec<VodItem>)> = RefCell::new(Default::default());
}

fn json(text: &str) -> Result<serde_json::Value, JsValue> {
    serde_json::from_str(text).map_err(err)
}

fn from_js<T: serde::de::DeserializeOwned>(v: JsValue) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(v).map_err(err)
}

fn kind_of(k: &str) -> Result<VodKind, JsValue> {
    serde_json::from_value(serde_json::Value::String(k.into())).map_err(err)
}

#[wasm_bindgen(js_name = setVod)]
pub fn set_vod(source_id: &str, items: JsValue) -> Result<(), JsValue> {
    let items: Vec<VodItem> = from_js(items)?;
    VOD.with(|v| {
        let mut v = v.borrow_mut();
        if items.is_empty() {
            v.0.remove(source_id);
        } else {
            v.0.insert(source_id.to_string(), items);
        }
        v.1 = vod::group_copies(v.0.values().flatten().cloned().collect());
    });
    Ok(())
}

#[wasm_bindgen(js_name = vodQuery)]
pub fn vod_query(query: JsValue) -> Result<JsValue, JsValue> {
    let q: VodQuery = from_js(query)?;
    VOD.with(|v| to_js(&vod::query(&v.borrow().1, &q)))
}

#[wasm_bindgen(js_name = vodFacets)]
pub fn vod_facets(kind: Option<String>, prefer_languages: JsValue, include_adult: bool) -> Result<JsValue, JsValue> {
    let kind = kind.as_deref().map(kind_of).transpose()?;
    let prefs: Vec<String> = from_js(prefer_languages)?;
    VOD.with(|v| to_js(&vod::facets(&v.borrow().1, kind, &prefs, include_adult)))
}

#[wasm_bindgen(js_name = vodSearch)]
pub fn vod_search(text: &str, field: JsValue, prefer_languages: JsValue, include_adult: bool, per_kind: usize) -> Result<JsValue, JsValue> {
    let field: SearchField = from_js(field)?;
    let prefs: Vec<String> = from_js(prefer_languages)?;
    let kinds = [VodKind::Movie, VodKind::Series, VodKind::Show, VodKind::Music, VodKind::Radio, VodKind::Podcast, VodKind::Audiobook];
    VOD.with(|v| {
        let all = &v.borrow().1;
        let out: std::collections::HashMap<String, vod::VodPage> = kinds
            .into_iter()
            .filter_map(|k| {
                let q = VodQuery { kind: Some(k), text: Some(text.to_string()), field, prefer_languages: prefs.clone(), include_adult, limit: Some(per_kind), ..Default::default() };
                let page = vod::query(all, &q);
                let name = serde_json::to_value(k).ok()?.as_str()?.to_string();
                (page.total > 0).then_some((name, page))
            })
            .collect();
        to_js(&out)
    })
}

/// Contenu complet (copies comprises) par identifiant, y compris une copie regroupée.
#[wasm_bindgen(js_name = vodItem)]
pub fn vod_item(id: &str) -> Result<JsValue, JsValue> {
    VOD.with(|v| match vod::find_copy(&v.borrow().1, id) {
        Some(i) => to_js(i),
        None => Ok(JsValue::NULL),
    })
}

/// Données enrichies d'une fiche (casting, genres…) reportées pour la recherche.
#[wasm_bindgen(js_name = vodEnrich)]
pub fn vod_enrich(id: &str, detail: JsValue) -> Result<(), JsValue> {
    let d: VodDetail = from_js(detail)?;
    VOD.with(|v| {
        if let Some(i) = v.borrow_mut().1.iter_mut().find(|i| i.id == id) {
            i.cast = d.item.cast.clone();
            i.directors = d.item.directors.clone();
            i.genres = d.item.genres.clone();
            i.tmdb_id = d.item.tmdb_id;
            i.plot = d.item.plot.clone();
            i.rating = d.imdb_rating.or(d.tmdb_rating).or(i.rating);
        }
    });
    Ok(())
}

#[wasm_bindgen(js_name = vodWithPerson)]
pub fn vod_with_person(name: &str) -> Result<JsValue, JsValue> {
    VOD.with(|v| {
        let items: Vec<VodItem> = vod::with_person(&v.borrow().1, name).into_iter().map(|i| VodItem { episodes: vec![], ..i.clone() }).collect();
        to_js(&items)
    })
}

/// Contenu disponible correspondant à un titre de filmographie (titre, année, identifiant TMDB).
#[wasm_bindgen(js_name = vodMatchCredit)]
pub fn vod_match_credit(title: &str, year: Option<u16>, tmdb_id: Option<f64>, kind: &str) -> Result<JsValue, JsValue> {
    let kind = kind_of(kind)?;
    VOD.with(|v| {
        let all = &v.borrow().1;
        let matched = vod::match_filmography(all, &[(title.to_string(), year, tmdb_id.map(|t| t as u64))]);
        let hit = matched.iter().find(|i| i.kind == Some(kind) || kind == VodKind::Movie).or(matched.first());
        match hit {
            Some(i) => to_js(&VodItem { episodes: vec![], ..(*i).clone() }),
            None => Ok(JsValue::NULL),
        }
    })
}

// Sources : adresses à télécharger et analyse des réponses.

#[wasm_bindgen(js_name = m3uVod)]
pub fn m3u_vod(text: &str, source_id: &str) -> Result<JsValue, JsValue> {
    to_js(&crate::m3u::parse_m3u(text, source_id).vod)
}

#[wasm_bindgen(js_name = xtreamVodItems)]
pub fn xtream_vod_items(server: &str, username: &str, password: &str, output: &str, source_id: &str, vod_categories: &str, vod_streams: &str, series_categories: &str, series: &str) -> Result<JsValue, JsValue> {
    let acc = XtreamAccount { server, username, password, output };
    let parse = |t: &str| serde_json::from_str::<serde_json::Value>(t).unwrap_or_default();
    let mut items = crate::xtream::vod_items(&acc, source_id, &parse(vod_categories), &parse(vod_streams));
    items.extend(crate::xtream::series_items(&acc, source_id, &parse(series_categories), &parse(series)));
    to_js(&items)
}

#[wasm_bindgen(js_name = archiveSearchUrl)]
pub fn archive_search_url(collection: &str, mediatype: &str, rows: usize) -> String {
    cat::archive_search_url(collection, mediatype, rows)
}

#[wasm_bindgen(js_name = archiveItems)]
pub fn archive_items(json_text: &str, kind: &str, source_id: &str, group_shows: bool) -> Result<JsValue, JsValue> {
    let kind = kind_of(kind)?;
    let mut items = cat::archive_items(&json(json_text)?, kind, source_id);
    if group_shows && kind == VodKind::Show {
        items = cat::group_series(items, source_id);
    }
    to_js(&items)
}

#[wasm_bindgen(js_name = librivoxUrl)]
pub fn librivox_url(language: Option<String>, rows: usize) -> String {
    cat::librivox_archive_url(language.as_deref(), rows)
}

#[wasm_bindgen(js_name = radioSearchUrl)]
pub fn radio_search_url(country: Option<String>, limit: usize) -> String {
    cat::radio_search_url(country.as_deref(), limit)
}

#[wasm_bindgen(js_name = radioItems)]
pub fn radio_items(json_text: &str, source_id: &str) -> Result<JsValue, JsValue> {
    to_js(&cat::radio_items(&json(json_text)?, source_id))
}

#[wasm_bindgen(js_name = podcastChartUrl)]
pub fn podcast_chart_url(country: &str, limit: usize) -> String {
    cat::podcast_chart_url(country, limit)
}

#[wasm_bindgen(js_name = podcastChartIds)]
pub fn podcast_chart_ids(json_text: &str) -> Result<JsValue, JsValue> {
    to_js(&cat::podcast_chart_ids(&json(json_text)?))
}

#[wasm_bindgen(js_name = podcastLookupUrl)]
pub fn podcast_lookup_url(ids: JsValue, country: &str) -> Result<String, JsValue> {
    let ids: Vec<String> = from_js(ids)?;
    Ok(cat::podcast_lookup_url(&ids, country))
}

#[wasm_bindgen(js_name = podcastItems)]
pub fn podcast_items(json_text: &str, source_id: &str, country: &str) -> Result<JsValue, JsValue> {
    to_js(&cat::podcast_items(&json(json_text)?, source_id, crate::lang::lang_from_country(country)))
}

#[wasm_bindgen(js_name = jellyfinItemsUrl)]
pub fn jellyfin_items_url(server: &str, user_id: &str) -> String {
    crate::jellyfin::items_url(server, user_id, "Movie,Series")
}

#[wasm_bindgen(js_name = jellyfinAuthHeader)]
pub fn jellyfin_auth_header(token: Option<String>) -> String {
    crate::jellyfin::auth_header("myiptv-web", token.as_deref())
}

#[wasm_bindgen(js_name = jellyfinItems)]
pub fn jellyfin_items(json_text: &str, source_id: &str, server: &str, token: &str) -> Result<JsValue, JsValue> {
    to_js(&crate::jellyfin::items(&json(json_text)?, source_id, server, token))
}

// Fiches détaillées.

/// Ce que la fiche doit télécharger, selon l'origine du contenu.
#[wasm_bindgen(js_name = detailPlan)]
pub fn detail_plan(item: JsValue, jellyfin_user: Option<String>) -> Result<JsValue, JsValue> {
    use crate::vod::VodRef;
    let item: VodItem = from_js(item)?;
    let plan = match &item.source_ref {
        VodRef::Xtream { server, username, password, id, .. } => {
            let acc = XtreamAccount { server, username, password, output: "ts" };
            if item.kind == Some(VodKind::Series) {
                serde_json::json!({ "kind": "xtream-series", "url": format!("{}&series_id={id}", acc.api_url(Some("get_series_info"))) })
            } else {
                serde_json::json!({ "kind": "xtream-movie", "url": format!("{}&vod_id={id}", acc.api_url(Some("get_vod_info"))) })
            }
        }
        VodRef::Archive { identifier } => serde_json::json!({ "kind": "archive", "url": format!("https://archive.org/metadata/{identifier}") }),
        VodRef::Jellyfin { server, id, .. } => match jellyfin_user {
            Some(u) => serde_json::json!({
                "kind": "jellyfin",
                "url": crate::jellyfin::item_url(server, &u, id),
                "episodesUrl": (item.kind == Some(VodKind::Series)).then(|| crate::jellyfin::episodes_url(server, &u, id)),
            }),
            None => serde_json::json!({ "kind": "none" }),
        },
        VodRef::None => match item.kind {
            Some(VodKind::Podcast) => serde_json::json!({ "kind": "rss", "url": item.url }),
            _ => serde_json::json!({ "kind": "none" }),
        },
    };
    to_js(&plan)
}

/// Assemble la fiche à partir des réponses téléchargées selon `detailPlan`.
#[wasm_bindgen(js_name = detailBuild)]
pub fn detail_build(item: JsValue, body: Option<String>, episodes_body: Option<String>, rss: Option<Vec<u8>>) -> Result<JsValue, JsValue> {
    use crate::vod::{Person, Season, VodRef};
    let item: VodItem = from_js(item)?;
    let kind = item.kind;
    let mut d = VodDetail {
        cast: item.cast.iter().map(|n| Person { name: n.clone(), ..Default::default() }).collect(),
        crew: item.directors.iter().map(|n| Person { name: n.clone(), role: Some(if kind == Some(VodKind::Audiobook) { "Auteur" } else { "Réalisation" }.into()), ..Default::default() }).collect(),
        item: item.clone(),
        ..Default::default()
    };
    let parsed = body.as_deref().map(json).transpose()?;
    match (&item.source_ref, parsed) {
        (VodRef::Xtream { server, username, password, .. }, Some(j)) => {
            let acc = XtreamAccount { server, username, password, output: "ts" };
            d = if kind == Some(VodKind::Series) { crate::xtream::series_detail(&acc, item.clone(), &j) } else { crate::xtream::movie_detail(item.clone(), &j) };
        }
        (VodRef::Archive { .. }, Some(meta)) => {
            let video = matches!(kind, Some(VodKind::Movie) | Some(VodKind::Show));
            let files = cat::archive_files(&meta, video);
            if video {
                d.item.url = files.first().map(|f| f.url.clone());
                d.item.duration = d.item.duration.or(files.first().and_then(|f| f.duration));
                if d.item.url.is_none() {
                    return Err(JsValue::from_str("Aucune version lisible de ce contenu n'est disponible."));
                }
            } else {
                let label = if kind == Some(VodKind::Audiobook) { "Chapitres" } else { "Pistes" };
                d.seasons = vec![Season { number: 1, name: label.into(), episodes: files }];
            }
        }
        (VodRef::Jellyfin { server, token, .. }, Some(full)) => {
            let eps = episodes_body.as_deref().map(json).transpose()?;
            d = crate::jellyfin::detail(item.clone(), &full, eps.as_ref(), server, token);
        }
        _ => {}
    }
    if let Some(bytes) = rss {
        let (episodes, desc) = cat::rss_episodes(&bytes, &item.id);
        d.item.plot = d.item.plot.or(desc);
        d.seasons = vec![Season { number: 1, name: "Épisodes".into(), episodes }];
    } else if kind == Some(VodKind::Series) && d.seasons.is_empty() && matches!(item.source_ref, VodRef::None) {
        let mut by: std::collections::BTreeMap<u32, Vec<_>> = Default::default();
        for e in &item.episodes {
            by.entry(e.season).or_default().push(e.clone());
        }
        d.seasons = by.into_iter().map(|(n, episodes)| Season { number: n, name: format!("Saison {n}"), episodes }).collect();
    }
    to_js(&d)
}

// Métadonnées TMDB / OMDb.

#[wasm_bindgen(js_name = tmdbIsBearer)]
pub fn tmdb_is_bearer(key: &str) -> bool {
    crate::tmdb::is_bearer(key)
}

#[wasm_bindgen(js_name = tmdbSearchUrl)]
pub fn tmdb_search_url(kind: &str, title: &str, year: Option<u16>, key: &str, lang: &str) -> Result<String, JsValue> {
    Ok(crate::tmdb::search_url(Some(kind_of(kind)?), title, year, key, lang))
}

#[wasm_bindgen(js_name = tmdbPick)]
pub fn tmdb_pick(json_text: &str, title: &str) -> Result<Option<f64>, JsValue> {
    Ok(crate::tmdb::pick_search_result(&json(json_text)?, title).map(|i| i as f64))
}

#[wasm_bindgen(js_name = tmdbDetailsUrl)]
pub fn tmdb_details_url(kind: &str, id: f64, key: &str, lang: &str) -> Result<String, JsValue> {
    Ok(crate::tmdb::details_url(Some(kind_of(kind)?), id as u64, key, lang))
}

#[wasm_bindgen(js_name = tmdbApply)]
pub fn tmdb_apply(detail: JsValue, json_text: &str) -> Result<JsValue, JsValue> {
    let mut d: VodDetail = from_js(detail)?;
    crate::tmdb::apply_details(&mut d, &json(json_text)?);
    to_js(&d)
}

#[wasm_bindgen(js_name = omdbUrl)]
pub fn omdb_url(imdb_id: &str, key: &str) -> String {
    crate::tmdb::omdb_url(imdb_id, key)
}

#[wasm_bindgen(js_name = omdbApply)]
pub fn omdb_apply(detail: JsValue, json_text: &str) -> Result<JsValue, JsValue> {
    let mut d: VodDetail = from_js(detail)?;
    crate::tmdb::apply_omdb(&mut d, &json(json_text)?);
    to_js(&d)
}

#[wasm_bindgen(js_name = tmdbPersonSearchUrl)]
pub fn tmdb_person_search_url(name: &str, key: &str, lang: &str) -> String {
    crate::tmdb::person_search_url(name, key, lang)
}

#[wasm_bindgen(js_name = tmdbPersonUrl)]
pub fn tmdb_person_url(id: f64, key: &str, lang: &str) -> String {
    crate::tmdb::person_url(id as u64, key, lang)
}

#[wasm_bindgen(js_name = tmdbPersonInfo)]
pub fn tmdb_person_info(json_text: &str) -> Result<JsValue, JsValue> {
    to_js(&crate::tmdb::person_info(&json(json_text)?))
}
