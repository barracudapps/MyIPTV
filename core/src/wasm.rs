//! Liaisons WebAssembly pour la version web / smart TV.

use std::cell::RefCell;

use wasm_bindgen::prelude::*;

use crate::model::Channel;
use crate::xmltv::{parse_xmltv, Epg, EpgFilter};
use crate::xtream::{live_channels, XtreamAccount};

thread_local! {
    static EPG: RefCell<Epg> = RefCell::new(Epg::default());
}

fn to_js<T: serde::Serialize>(v: &T) -> Result<JsValue, JsValue> {
    v.serialize(&serde_wasm_bindgen::Serializer::json_compatible()).map_err(|e| JsValue::from_str(&e.to_string()))
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
