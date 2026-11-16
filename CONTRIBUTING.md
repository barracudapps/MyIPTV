# Contribuer

## Messages de commit

L'historique Git sert de justification technique : chaque commit explique **pourquoi**
le changement existe. Format (conventions Odoo) :

```
[TAG] module: short imperative summary in English

Body wrapped at 72 characters explaining WHY the change is needed:
the problem, the constraint, the choices made and the alternatives
rejected. The diff already says what changed.
```

- Résumé en anglais, à l'impératif, 72 caractères maximum, sans point final.
- Un commit = un sujet cohérent, testé, qui laisse la suite de tests au vert.

### Tags

| Tag | Usage |
|---|---|
| `[ADD]` | nouveau module |
| `[IMP]` | ajout ou amélioration dans un module existant |
| `[FIX]` | correctif |
| `[REF]` | refactoring sans changement de comportement |
| `[REM]` | suppression |
| `[REV]` | revert |
| `[MOV]` | déplacement de fichiers |
| `[I18N]` | traductions |
| `[PERF]` | performance |
| `[REL]` | release (montée de version + tag) |

### Modules

| Module | Dossier |
|---|---|
| `core` | `core/` |
| `desktop` | `app/src-tauri/` |
| `ui` | `app/src/` |
| `build` | configuration, CI, empaquetage |

Plusieurs modules : `[IMP] core, ui: …` ; transverse : `[IMP] various: …`.

## Versionnage (SemVer)

`MAJEUR.MINEUR.CORRECTIF`, identique dans `core/Cargo.toml`, `app/src-tauri/Cargo.toml`,
`app/package.json` et `app/src-tauri/tauri.conf.json`.

- **MAJEUR** : rupture de compatibilité (format des réglages, des sources ou du cache non migré).
- **MINEUR** : nouvelle fonctionnalité compatible.
- **CORRECTIF** : correction sans nouvelle fonctionnalité.
- Avant 1.0.0, une rupture incrémente le MINEUR.

Release :

```bash
# 1. mettre à jour les quatre fichiers de version et CHANGELOG.md
git commit -am "[REL] various: release X.Y.Z"
git tag -a vX.Y.Z -m "MyIPTV X.Y.Z"
```

Mises à jour automatiques : les applications de bureau lisent `latest.json` dans la
dernière release publiée de GitHub et n'installent qu'un paquet signé par la clé dont
la partie publique est dans `tauri.conf.json` (`plugins.updater.pubkey`).

- La clé privée reste hors du dépôt (`~/.tauri/myiptv.key`) ; `npm run build:mac` la
  lit pour signer. Sans elle, l'application est construite sans fichiers de mise à jour.
- En intégration continue, elle est fournie par les secrets `TAURI_SIGNING_PRIVATE_KEY`
  (contenu du fichier) et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (vide ici).
- La release créée par le tag est un brouillon : la publier rend la mise à jour visible.
- Perdre la clé privée empêche toute mise à jour automatique des versions installées.

Signature macOS (évite l'avertissement de Gatekeeper au premier lancement) : nécessite
un compte Apple Developer. Ajouter en secrets du dépôt `APPLE_CERTIFICATE` (certificat
« Developer ID Application » exporté en .p12, encodé en base64), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY` (« Developer ID Application: Nom (TEAMID) »), `APPLE_ID`,
`APPLE_PASSWORD` (mot de passe d'application) et `APPLE_TEAM_ID`. Sans eux, l'intégration
continue produit une application non signée, comme aujourd'hui.

## Branches

`main` contient les releases ; développement sur `dev`, sujets sur
`dev-<module>_<sujet>-<initiales>`.
