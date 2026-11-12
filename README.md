# MyIPTV

Lecteur IPTV multiplateforme : direct, guide des programmes, pause du direct, replay,
profils et contrôle parental. MyIPTV **ne fournit aucun contenu** : il lit les chaînes
gratuites du catalogue communautaire [iptv-org](https://github.com/iptv-org/iptv) et les
sources que l'utilisateur ajoute (M3U, Xtream Codes, XMLTV). Chaque utilisateur est
responsable de la légalité de ses sources.

## Architecture

```
core/            Cœur Rust sans réseau : M3U, XMLTV, Xtream, catch-up, âges, analyse de risque
                 → compilé en natif (app) et en WebAssembly (smart TV, navigateur)
app/src-tauri/   Application native Tauri 2 (macOS, Windows, Linux, Android)
                 → proxy HTTP local (CORS, en-têtes), timeshift sur disque, cache
app/src/         Interface React + TypeScript commune à toutes les plateformes
```

| Plateforme | Build | Timeshift |
|---|---|---|
| macOS, Windows, Linux | `npm run tauri build` | sur disque (jusqu'à 6 h) |
| Android, Android TV | `npm run tauri android build` | sur disque |
| Samsung Tizen, LG webOS, navigateur | `npm run build:web` puis empaquetage TV | mémoire du lecteur |

## Développement

Prérequis : Rust (rustup), Node 20+, et pour la version web/TV `wasm-pack`.

```bash
cd app
npm install
npm run tauri dev          # application de bureau
npm run build:web          # version web / TV (compile le cœur en WASM)
```

Tests :

```bash
cargo test --workspace                                   # tests unitaires
STREAM_URL=<flux HLS> cargo test -p myiptv live_ -- --ignored   # timeshift sur un vrai flux
cd app && npm run typecheck
```

## Fonctionnalités

- Sources : catalogue gratuit iptv-org (par pays, langue, thème), M3U (lien ou fichier), Xtream Codes, guides XMLTV (gzip accepté).
- Analyse de chaque source importée : avertissement et double confirmation si elle présente les signes d'une offre illégale.
- Direct : liste ou mosaïque virtualisées (dizaines de milliers de chaînes), catégories, favoris, récents, zapping.
- Pause du direct, retour arrière, reprise au début du programme, retour au direct.
- Replay (catch-up) : Xtream, modèles M3U `catchup-source`, Flussonic.
- Guide des programmes en grille, sur 7 jours en arrière et 3 jours en avant.
- Recherche globale dans les chaînes et les programmes, avec mini-lecteur flottant.
- Profils (administrateur, standard, enfant), thèmes prédéfinis et écrans personnalisables (couleurs, police, disposition, densité), import/export.
- Contrôle parental : code PIN, chaînes adultes verrouillées, profils enfants filtrés par âge avec tolérance réglable, listes blanche et noire, catégories bloquées.
- Navigation à la télécommande (flèches, Retour, CH+/CH−).

## Versionnage

[SemVer](https://semver.org/lang/fr/). Voir [CONTRIBUTING.md](CONTRIBUTING.md) et [CHANGELOG.md](CHANGELOG.md).
