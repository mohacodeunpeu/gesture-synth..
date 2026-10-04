# MOHA MOTION

**Fais des sons, des mèmes et des beats avec tes mains** — un soundboard / sampler à gestes qui tourne
entièrement dans ton navigateur (ordi et téléphone). Caméra analysée **localement**, aucun compte,
aucun serveur, aucune donnée envoyée.

> 🇬🇧 *Hand-gesture soundboard, sampler and instrument that runs 100 % locally in the browser
> (desktop + phone). React + TypeScript + Vite, MediaPipe Hand Landmarker, Web Audio.*

## Ce que fait la V0.1

- **START** → active le son (bip de confirmation) et la caméra en un clic.
- **TEST AUDIO** toujours disponible, indépendant de la caméra + bandeau impossible à rater si le
  navigateur met l'audio en pause.
- **16 pads** façon sampler, 6 banques : MEMES, DRUMS, FX, VOICES (64 sons **générés par le code**,
  aucun fichier audio protégé) + CUSTOM 1 / CUSTOM 2 pour tes sons.
- Jouer avec la **souris / le doigt** (déclenché à l'appui, sans délai), le **clavier**
  (`1 2 3 4 / Q W E R / A S D F / Z X C V` par position physique, AZERTY détecté) ou les **gestes**.
- **12 gestes** reconnus par main (✋ ✊ ☝️ ✌️ 3️⃣ 4️⃣ 👍 👎 🤘 🤙 🤏 👌), main gauche et droite
  séparées, anti-rafale (temps de maintien, hystérésis, anti-répétition).
- **Apprendre un geste** : ouvre un pad → « Apprendre un geste » → fais ton geste 1 s → c'est assigné.
- **Importer tes sons** (MP3, WAV, OGG, M4A…) : bouton, glisser-déposer sur un pad, ou clic sur un
  pad vide. Le silence du début est coupé automatiquement. Stockés dans ton navigateur (IndexedDB).
- Éditeur de pad : nom, emoji, mode (one shot / gate / boucle / retrigger), volume, hauteur, pan,
  découpe avec forme d'onde, fondus, à l'envers, groupe de coupure, polyphonie, touche clavier.
- **Diagnostic** : état audio, latence, niveau, caméra, FPS, temps d'inférence, GPU/CPU, gestes en
  direct + boutons TEST / RESET.
- Interface FR / EN, thème sombre, animations (squelette néon, bulles, explosions d'emojis).

## Lancer

Prérequis : **Node 20+** et npm.

```bash
npm install
npm run dev          # http://localhost:5173
```

Ouvre l'URL dans **Chrome** (recommandé sur Mac M1/M2), clique **START**, autorise la caméra.

### Sur ton téléphone (même Wi-Fi)

La caméra du navigateur exige HTTPS hors `localhost` :

```bash
npm run dev:phone    # HTTPS auto-signé + accessible sur le réseau local
```

Ouvre l'adresse `https://192.168.x.x:5173` affichée, accepte l'avertissement de certificat, START.

### Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | serveur de dev |
| `npm run build` | build de production dans `dist/` (typecheck inclus) |
| `npm run preview` | sert le build |
| `npm run lint` | ESLint |
| `npm run test` | tests unitaires (Vitest) |
| `npm run test:e2e` | tests de bout en bout dans Chromium avec fausse caméra + vraie photo de main |

`npm run dev` / `build` copient automatiquement le moteur MediaPipe (WASM) depuis `node_modules` et
téléchargent le modèle de main (~7,5 Mo) dans `public/mediapipe/` (non versionné). Sans internet au
moment du build, l'app chargera le modèle depuis le CDN de Google au démarrage.

## Navigateurs

- ✅ Chrome / Edge / Brave récents (Mac, Windows, Android) — cible principale.
- ✅ Safari macOS / iOS récents (iPhone en mode silencieux : le son passe quand même).
- ⚠️ Firefox : fonctionne, suivi des mains en CPU (un peu plus lent).
- Si le GPU est indisponible (accélération matérielle désactivée), le suivi passe automatiquement
  sur le CPU — visible dans **Diagnostic**.

## Tes sons & droits d'auteur

Les sons intégrés sont **synthétisés par le code** (`src/audio/sfx`) : aucun enregistrement copié.
Tes propres sons importés restent **dans ton navigateur** et ne sont jamais ajoutés au repo.
Voir [`public/sounds/README.md`](public/sounds/README.md).

## Vie privée

Le flux caméra est analysé **sur ton appareil** par MediaPipe. Aucune image, aucun son, aucune
statistique ne quitte ta machine. Pas de compte, pas d'analytics.

## Architecture

Voir [`ARCHITECTURE.md`](ARCHITECTURE.md). En bref : les moteurs temps réel (audio, caméra, gestes)
sont en TypeScript pur, React ne fait qu'afficher l'état.

## Licence

Aucune licence choisie pour l'instant (tous droits réservés) — voir [`LICENSE`](LICENSE).
