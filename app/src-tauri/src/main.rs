// Empêche l'ouverture d'une console sous Windows en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    myiptv_lib::run()
}
