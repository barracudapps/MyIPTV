mod commands;
mod library;
mod recorder;
mod server;
mod state;
mod timeshift;
mod transcode;

use std::sync::Arc;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let cache_dir = app.path().app_cache_dir()?;
            // Enregistrements dans le dossier Vidéos de l'utilisateur, faciles à retrouver.
            let recordings_dir = app.path().video_dir().map(|d| d.join("MyIPTV")).or_else(|_| app.path().app_local_data_dir().map(|d| d.join("recordings")))?;
            // Port choisi par l'OS, réservé avant la création de la fenêtre.
            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            listener.set_nonblocking(true)?;
            let port = listener.local_addr()?.port();
            let state = Arc::new(state::AppState::new(cache_dir, recordings_dir, port));
            state.recorder.start_loop();
            let router = server::router(state.clone());
            tauri::async_runtime::spawn(async move {
                match tokio::net::TcpListener::from_std(listener) {
                    Ok(l) => {
                        if let Err(e) = axum::serve(l, router).await {
                            log::error!("serveur local arrêté : {e}");
                        }
                    }
                    Err(e) => log::error!("serveur local : {e}"),
                }
            });
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_source,
            commands::preview_source,
            commands::remove_source,
            commands::load_epg,
            commands::programmes,
            commands::search_programmes,
            commands::catchup_url,
            commands::play,
            commands::stop_playback,
            commands::timeshift_status,
            library::vod_query,
            library::vod_facets,
            library::vod_search,
            library::vod_detail,
            library::person,
            commands::jellyfin_login,
            commands::log_frontend,
            commands::rec_list,
            commands::rec_schedule,
            commands::rec_cancel,
            commands::rec_info,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de MyIPTV");
}
