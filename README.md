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

| Plateforme | Build | Remarques |
|---|---|---|
| macOS | `cd app && npx tauri build` | `.app` et `.dmg` dans `target/release/bundle/` |
| Windows, Linux | intégration continue (tag `vX.Y.Z`) | `.msi`/`.exe`, `.deb`/`.AppImage`/`.rpm` |
| Android, Android TV | `cd app && npx tauri android build --apk` | variables `ANDROID_HOME`, `NDK_HOME`, Java 17+ |
| Navigateur | `cd app && npm run build:web` | sortie `app/dist-web/` ; lecture limitée par CORS |
| LG webOS, Samsung Tizen | `npm run build:web && npm run package:tv` | dossiers prêts dans `tv/build/`, puis `ares-package` / `tizen package` |

Fonctions selon la plateforme :

| | Bureau | Android | Web / TV |
|---|---|---|---|
| Direct, guide, replay | oui | oui | oui (si le serveur autorise CORS ; toujours sur TV empaquetée) |
| Pause du direct (timeshift) | sur disque, jusqu'à 6 h | sur disque | mémoire du lecteur |
| Bibliothèque (films, séries, radio…) | oui | oui | oui (sources autorisant l'accès depuis le navigateur ; toutes sur TV empaquetée) |
| MKV / AC3 / DTS, enregistrements | oui (ffmpeg installé) | MPEG-TS seulement | non |

## Développement

Prérequis : Rust (rustup), Node 20+, ffmpeg (recommandé : conversion des MKV/AC3 et enregistrements) ; pour la version web/TV, la cible `wasm32-unknown-unknown` et `wasm-bindgen-cli` à la version du `Cargo.lock`.

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
- Ajout de plusieurs liens ou fichiers d'un coup, par glisser-déposer ; sources en double reconnues et refusées ; seules les sources nouvelles sont chargées.
- Analyse de chaque source importée : avertissement et double confirmation (une seule pour tout un lot) si elle présente les signes d'une offre illégale.
- Copies multiples d'une chaîne ou d'un film regroupées ; la meilleure connexion est choisie au lancement, avec bascule automatique.
- Direct : liste ou mosaïque virtualisées (dizaines de milliers de chaînes), catégories, favoris, récents, zapping.
- Pause du direct, retour arrière, reprise au début du programme, retour au direct.
- Replay (catch-up) : Xtream, modèles M3U `catchup-source`, Flussonic.
- Guide des programmes en grille, sur 7 jours en arrière et 3 jours en avant.
- Recherche globale dans les chaînes et les programmes, avec mini-lecteur flottant.
- Profils (administrateur, standard, enfant), thèmes prédéfinis et écrans personnalisables (couleurs, police, disposition, densité), import/export, animations désactivables.
- Partage en réseau local de la configuration et des comptes vers un autre appareil (chiffré par un code).
- Indicateur des traitements en cours.
- Synchronisation Trakt par profil : lecture signalée en direct, contenus vus et reprise de lecture importés (application Trakt de l'utilisateur, connexion par code).
- Contrôle parental : code PIN, chaînes adultes verrouillées, profils enfants filtrés par âge avec tolérance réglable, listes blanche et noire, catégories bloquées.
- Partage en réseau local : sources, comptes, profils, thèmes et réglages copiés d'un appareil à l'autre avec une adresse et un code (chiffré, valable 10 minutes) ; envoi depuis le bureau ou Android, réception partout.
- Navigation à la télécommande : flèches et OK, Retour (ferme l'élément ouvert, puis quitte l'application sur Android TV), CH+/CH−, lecture/pause, avance et retour rapides (30 s), stop. Touches multimédia déclarées sur Tizen, Retour webOS et Android pris en charge.

## Versionnage

[SemVer](https://semver.org/lang/fr/). Voir [CONTRIBUTING.md](CONTRIBUTING.md) et [CHANGELOG.md](CHANGELOG.md).
