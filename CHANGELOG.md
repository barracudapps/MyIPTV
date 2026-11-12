# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage [SemVer](https://semver.org/lang/fr/).

## [Non publié]

## [0.4.0] - 2026-11-12

### Ajouté
- Bibliothèque (films, séries, émissions, musique, radio, podcasts, livres audio) dans la version web et TV, avec les mêmes analyseurs que l'application de bureau.
- Synchronisation Trakt par profil : connexion par code, lecture signalée, contenus vus et reprises importés.
- Séries présentes sur plusieurs sources : fiche et épisodes lus depuis une source qui répond, avec bascule automatique d'un épisode en échec.

### Amélioré
- Images chargées seulement après 100 ms d'affichage et libérées loin de l'écran ; caches du guide et des fiches plafonnés.

### Corrigé
- Films pour adultes d'Internet Archive affichés alors que le contenu adulte est désactivé.
- Version originale de certains films d'Internet Archive choisie au lieu de la version H.264 lisible partout.

## [0.3.0] - 2026-11-12

### Ajouté
- Chaînes, films, séries et radios présents plusieurs fois (sources, qualités) regroupés sous une seule entrée ; au lancement, toutes les copies sont testées en parallèle et la plus pertinente est lue (répond, rapide, meilleure qualité), avec bascule automatique si elle échoue et onglet « Sources » dans le lecteur.
- Partage en réseau local : sources, comptes, profils, thèmes et réglages copiés vers un autre appareil avec une adresse et un code (transfert chiffré, valable 10 minutes).
- Ajout de plusieurs liens ou fichiers M3U d'un coup, avec une seule vérification et une seule double confirmation pour tout le lot.
- Glisser-déposer des listes M3U (fichiers ou liens) sur la fenêtre d'ajout ou la page Sources.
- Indicateur d'activité : chargements, guides, vérifications, partages et enregistrements en cours, avec progression.
- Durée de pause du direct réglable, aussi depuis le lecteur.
- Télécommande : touches lecture, pause, avance et retour rapides, stop, CH+/CH−, Retour sur Android TV, Tizen et webOS.
- Thèmes : dix nouveaux thèmes, Studio et Studio clair (menu en icônes), Maison (thème de luxe avec ses propres animations).
- Animations des écrans, fenêtres, menus et panneaux, désactivables.
- Choix entre plusieurs mascottes.
- Lecteurs officiels YouTube et Dailymotion pour les directs diffusés sur ces plateformes.
- Explication quand une chaîne recherchée est absente (chaînes payantes, filtres actifs).
- Intégration continue et paquets pour toutes les plateformes, projet Android.

### Amélioré
- Ajouter une source ne recharge que cette source ; les sources se chargent quelques-unes à la fois.
- Démarrage plus léger : lecteurs vidéo et écrans secondaires chargés à la demande, chaque plateforme n'embarque que son moteur (code principal de 983 à 316 Ko).
- Analyse des grandes listes environ 15 % plus rapide dans la version web et TV.
- Films et épisodes dans un grand lecteur.

### Corrigé
- Sources en double supprimées au démarrage et refusées à l'ajout (même liste, compte ou fichier, quelle que soit l'écriture).
- Réglages qui ne s'enregistraient plus après l'import d'un gros fichier M3U (contenu désormais rangé dans IndexedDB).
- Chargements multiples et bloqués avec un grand nombre de sources.
- Couleur « Éléments » des thèmes jamais appliquée.
- Guides disparus de leur serveur signalés en erreur à chaque chargement.
- Erreurs de lecture obsolètes qui relançaient la lecture.

## [0.2.0] - 2026-11-12

### Ajouté
- Bibliothèque : films, séries, émissions, musique, radio, podcasts et livres audio, avec fiches (bande-annonce, notes IMDb/TMDB, casting cliquable, filmographie), historique, reprise de lecture, notes personnelles et « Ma liste ».
- Sources légales gratuites intégrées par défaut : iptv-org, Free-TV, Internet Archive (domaine public et Creative Commons uniquement), Radio Browser, Apple Podcasts, LibriVox.
- Serveurs multimédias personnels Jellyfin et Emby.
- Langues favorites ordonnées par profil : tri, filtre rapide, drapeaux sur les vignettes, choix automatique de l'audio et des sous-titres.
- Recherche globale par critère (titre, acteur, réalisation, genre, année, catégorie, résumé, chaîne, programme TV), résultats groupés par section.
- Filtre et tri par pays.
- Lecteur : pistes audio, sous-titres, qualité, format d'image, réglages d'image, modes de son, vitesse, mini-lecteur flottant au-dessus de toutes les fenêtres.
- Lecture des MKV, AVI et sons AC3/DTS par conversion à la volée (ffmpeg).
- Enregistrements programmés depuis le guide ou le lecteur.
- Replay : badge sur les chaînes concernées, filtre, navigation jour par jour dans les émissions passées.
- Sélecteur de saison avec progression.
- Contenus pour adultes masqués par défaut, activables par l'administrateur ; code parental par défaut « 0000 », modifiable ou supprimable.
- Mascotte Zapi et options ludiques (sons, confettis, succès, décorations de saison…), toutes réglables.
- Mode test administrateur : liste légale d'exemple et liste suspecte simulée.

### Corrigé
- Détection du format réel des flux (« FormatUnsupported » sur des flux mal annoncés).
- Séries masquées par le filtre de langue par défaut.
- Durée et taille des enregistrements HLS.
- Découpage des segments MPEG-TS du timeshift et horodatage des premiers segments.
- Titres mal découpés (caractères accentués, années, noms de fichiers).

## [0.1.0] - 2026-11-12

### Ajouté
- Cœur Rust partagé (natif et WebAssembly) : M3U, XMLTV, Xtream Codes, replay, classifications d'âge, analyse de risque des sources.
- Application de bureau Tauri : proxy local, timeshift sur disque (HLS et MPEG-TS), cache hors ligne des sources et guides.
- Interface : direct, guide, favoris, recherche, mini-lecteur, sources (catalogue gratuit iptv-org), profils, thèmes et écrans personnalisés, contrôle parental, navigation à la télécommande.
