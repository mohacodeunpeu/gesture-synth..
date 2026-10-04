# MOHA MOTION

**Fais des sons et des mèmes avec tes mains** — un soundboard / sampler de 16 pads piloté par gestes,
dans le navigateur. La caméra est analysée **localement** : pas de compte, pas de backend, aucune
donnée personnelle envoyée.

> 🇬🇧 *Hand-gesture soundboard and 16-pad sampler that runs locally in the browser. React + TypeScript +
> Vite, MediaPipe Hand Landmarker, Web Audio. Status: V0.1 — automatically tested in Chromium only.*

## État du projet

- **V0.1** — code de référence : commit `a33363e`.
- Vérifiée automatiquement dans **Chromium uniquement** (voir [Navigateurs](#navigateurs)).
- Ce README décrit uniquement ce qui marche aujourd'hui. Ce qui est prévu est dans la partie
  *ROADMAP* de [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Ce que tu peux faire aujourd'hui

- **START** : un clic active le son (petit bip de confirmation) puis la caméra.
- **TEST AUDIO** : toujours disponible, même sans caméra. Si le navigateur met l'audio en pause, un
  bandeau impossible à rater permet de le relancer en un clic.
- **16 pads, 6 banques** : MEMES, DRUMS, FX, VOICES (64 sons **générés par le code**, aucun fichier
  audio protégé) + CUSTOM 1 et CUSTOM 2, vides, pour tes propres sons.
- **Jouer** :
  - souris ou doigt — le son part dès l'appui ;
  - clavier — `1 2 3 4 / Q W E R / A S D F / Z X C V` par position physique, avec les lettres de ton
    clavier affichées sur les pads (AZERTY compris) ; `Échap` coupe tout, `←` / `→` changent de banque ;
  - gestes de la main devant la caméra.
- **3 modes** :
  - 😂 **Mèmes** — un geste par pad ; main gauche ouverte = stop tout ; balayage rapide main ouverte
    vers la gauche / la droite = banque précédente / suivante ;
  - 🥁 **Batterie** — frappe vers le bas de la main gauche = KICK, de la main droite = SNARE, et des
    gestes pour hi-hat, clap, crash, cowbell… (détection des frappes encore expérimentale) ;
  - ⚙️ **Perso** — démarre comme Mèmes, à personnaliser avec « Apprendre un geste ».
- **12 gestes** reconnus pour chaque main (✋ ✊ ☝️ ✌️ 3️⃣ 4️⃣ 👍 👎 🤘 🤙 🤏 👌), avec anti-rafale : un
  geste tenu ne déclenche qu'une seule fois.
- **Apprendre un geste** : ouvre un pad → « Apprendre un geste » → garde ton geste ~0,75 s → il est
  assigné à ce pad dans le mode actuel.
- **Gauche et droite inversées ?** Bouton « Inverser G/D » sur la scène (ou dans Réglages).
- **Importer tes sons** (formats lus par ton navigateur : WAV, MP3, M4A/AAC, OGG…, 40 Mo max) : bouton
  « Importer un son », glisser-déposer sur un pad, ou clic sur un pad vide. Le silence du début est
  coupé automatiquement et le son est joué une fois pour confirmer.
- **Modifier un pad** — sur ordi : clic droit ou bouton ⋯ ; sur téléphone : bouton ✏️ Éditer puis
  touche un pad. Nom, emoji, choix du son, écoute, forme d'onde avec découpe début / fin, mode
  (one shot / gate / boucle / retrigger), volume, hauteur, pan, fondus, lecture à l'envers, groupe de
  coupure, nombre de voix, touche clavier, son d'origine / vider le pad.
- **Réglages** : langue, choix de la caméra (avant / arrière s'il y en a plusieurs), miroir, inverser
  les mains, squelette, aide des gestes, sensibilité, temps de maintien, anti-répétition,
  réinitialiser les gestes du mode.
- **Diagnostic** : état et latence audio, niveau, sons chargés, caméra, résolution, FPS, temps
  d'inférence, GPU / CPU, mains détectées, geste en direct, boutons TEST / RESET audio et caméra.
- **Sauvegarde automatique locale** (IndexedDB) : pads, sons importés, gestes appris et réglages
  restent après un rechargement.
- Interface FR / EN (détectée automatiquement), thème sombre, animations (squelette néon, bulles,
  explosions d'emojis), respect du réglage système « réduire les animations ».

**Pas encore disponible :** effets contrôlés par les mains, synthé, looper, enregistrement vidéo /
audio, plusieurs projets et export, éditeur complet des gestes, assistant de calibration, mode
hors-ligne et installation comme app — voir la roadmap dans [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Lancer

Prérequis : **Node.js 20.19+ ou 22.12+** (exigence de Vite 8) et npm.

```bash
git clone https://github.com/mohacodeunpeu/gesture-synth.. moha-motion
cd moha-motion
npm install
npm run dev          # http://localhost:5173
```

Ouvre l'URL dans **Google Chrome**, clique **START**, autorise la caméra.

### Sur un téléphone (même Wi-Fi)

Hors `localhost`, la caméra du navigateur exige HTTPS :

```bash
npm run dev:phone    # HTTPS auto-signé + accessible sur le réseau local
```

Ouvre l'adresse `https://192.168.x.x:5173` affichée, accepte l'avertissement de certificat, puis
START. ⚠️ Aucun vrai téléphone n'a encore été testé (voir [Navigateurs](#navigateurs)).

### Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | serveur de dev |
| `npm run dev:phone` | serveur de dev en HTTPS, accessible depuis le réseau local |
| `npm run build` | build de production dans `dist/` (typecheck inclus) |
| `npm run preview` | sert le build |
| `npm run lint` | ESLint |
| `npm run test` | tests unitaires (Vitest) |
| `npm run test:e2e` | tests de bout en bout dans Chromium avec fausse caméra + vraie photo de main (1re fois : `npx playwright install chromium` ; le test geste a besoin de `ffmpeg` et d'internet, sinon il est sauté) |

`npm run dev`, `dev:phone` et `build` copient automatiquement le moteur MediaPipe (WASM) depuis
`node_modules` et téléchargent le modèle de main (~7,5 Mo) dans `public/mediapipe/` (non versionné).
Sans internet à ce moment-là, l'app charge le modèle depuis le CDN de Google au démarrage.

## Navigateurs

- **Vérifié** : Chromium, par des tests automatiques sur ordi et en émulation téléphone (390×844,
  375×667, 844×390), y compris le passage automatique du suivi des mains sur le CPU quand le GPU n'est
  que logiciel.
- **Recommandé** : Google Chrome. Edge et Brave utilisent le même moteur mais n'ont pas été testés
  séparément.
- **Non vérifiés à ce jour** : Safari (macOS et iOS), Firefox, et tous les vrais téléphones. Le code
  contient des adaptations pour iPhone (session audio « playback » pour que le son passe en mode
  silencieux, déverrouillage de l'audio au tap), mais elles n'ont pas encore été testées sur un appareil
  réel.

## Limites connues

- Le suivi des mains tourne sur le fil principal du navigateur : sur un appareil lent ou en mode CPU,
  l'interface peut ralentir.
- Latence geste → son **estimée** à ~130–150 ms, dont ~100 ms de temps de maintien pour éviter les faux
  déclenchements (réglable dans Réglages). Le clavier et le tactile déclenchent immédiatement.

## Tes sons & droits d'auteur

Les sons intégrés sont **synthétisés par le code** (`src/audio/sfx`) : aucun enregistrement copié.
Tes propres sons importés restent **dans ton navigateur** et ne sont jamais ajoutés au repo.
Voir [`public/sounds/README.md`](public/sounds/README.md).

## Vie privée

Le flux caméra est analysé **sur ton appareil** par MediaPipe. Aucune image, aucun son, aucune
statistique ne quitte ta machine. Pas de compte, pas d'analytics. Les seules requêtes réseau servent à
charger les fichiers de l'app ; si le modèle de main n'a pas été copié localement au build, il est
téléchargé depuis le CDN de Google (et le moteur WASM depuis jsDelivr en dernier recours) — ce sont de
simples téléchargements, rien n'est envoyé.

## Architecture

Voir [`ARCHITECTURE.md`](ARCHITECTURE.md) : partie **CURRENT V0.1** (ce qui existe et est testé) et
partie **ROADMAP** (ce qui est prévu). Les moteurs temps réel (audio, caméra, gestes) sont en
TypeScript pur ; React ne fait qu'afficher l'état.

## Licence

Aucune licence choisie pour l'instant (tous droits réservés) — voir [`LICENSE`](LICENSE).
