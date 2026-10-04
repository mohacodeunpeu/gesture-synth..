# MOHA MOTION — Architecture

> **Read this first.** This document has two strictly separated parts:
>
> 1. **CURRENT V0.1 — implemented and tested.** Everything in this part exists in the code today
>    (functional code reference: commit `a33363e`).
> 2. **ROADMAP / TARGET ARCHITECTURE — planned, NOT implemented.** Nothing in this part exists yet.
>    Where some groundwork is already in the code (types, unused audio nodes, unused IndexedDB stores),
>    that groundwork is listed explicitly — and labelled as unused — in part 1.

---

## PART 1 — CURRENT V0.1 (implemented and tested)

### 1.1 Overview

```
 webcam ─► HandTracker ─► GestureEngine ─► Performance ─► Sampler ─► AudioEngine ─► speakers
           (MediaPipe,    (classifier,      (conductor:     (pad voices)
            main thread)   smoother,         mapping rules,
                           One-Euro axes,    learn gesture)
                           motions)               ▲
 keyboard / mouse / touch ────────────────────────┘
```

React only renders state. Realtime work (audio, camera, tracking, gestures) lives in plain TypeScript
engines created once in `src/engine/instance.ts`. The stage canvas, meters and pad animations read the
engines in their own `requestAnimationFrame` loops or event callbacks, not through React state.

### 1.2 Audio (`src/audio`)

The graph actually built by `AudioEngine.buildGraph()` (one `AudioContext`, `latencyHint: "interactive"`):

```
 pad voices (keys, pointer, gestures) ─► liveBus ─┐
 trackBus ×8 + synthBus (created, nothing feeds them yet) ─┴─► mixBus ─► EffectRack (neutral, see below)
   ─► master (volume 0.9) ─► mute ─► StereoPanner ─► limiter (DynamicsCompressor) ─► recordTap ─► output ─► destination
                                                                                         └─► analyser (master meter)

 TEST AUDIO + START chime ─► testBus ─► limiter
     (enters after the effects, master volume and mute, so it is always audible;
      it goes through the limiter, so it shows on the master meter)

 clickBus ─► output   (metronome bus: exists but unused — there is no metronome yet)
```

- **Unlock:** `audio.unlock()` runs synchronously inside the START click: it creates the context,
  starts a one-sample silent buffer (WebKit unlock), calls `resume()`, then a short confirmation chime plays.
- **iOS adaptations — implemented, NOT tested on a real iPhone:** `navigator.audioSession.type = "playback"`
  when the API exists, otherwise a looping silent `<audio>` element on Apple touch devices, so the
  silent switch should not mute the app.
- **States:** locked / running / suspended / interrupted / closed / unsupported. After unlock, any
  non-running state shows a full-width "AUDIO PAUSED — CLICK TO RESUME" banner. The app tries to resume
  when the tab becomes visible again. RESET AUDIO closes the context and rebuilds a fresh graph.
- **EffectRack** (`EffectRack.ts`): DJ filter (high-pass + low-pass biquads), a slot for the `moha-glitch`
  AudioWorklet (stutter / tape stop), delay send with filtered feedback, reverb send (`ConvolverNode`
  with a generated impulse response). **In V0.1 it stays at neutral settings** (filter open, sends at 0):
  no UI and no visible mode controls it. The worklet module (`worklets/moha-worklets.js`) is loaded
  asynchronously and the glitch node spliced in when it loads; the same module registers a
  `moha-recorder` PCM processor that is **never instantiated**.
- **SampleLibrary:** cache of decoded `AudioBuffer`s — triggering a pad never decodes anything.
  Built-in sounds are generated in a Web Worker (`sfx/sfx.worker.ts`, main-thread fallback), active bank
  first. Imported files are decoded once to validate them; the original bytes are stored in IndexedDB
  (`samples`, 40 MB max per file); the leading silence (−45 dB) is measured and applied as the pad's
  trim start at import.
- **Sampler:** one `AudioBufferSourceNode` → `GainNode` → optional `StereoPannerNode` per trigger.
  Modes one-shot / gate / loop (toggle) / retrigger, choke groups 1–4, per-pad polyphony, 48-voice global
  cap, trim start/end, fades, reverse (cached reversed buffer), pitch in semitones (`playbackRate`).
  A sound that is still being generated is moved to the front of the queue and played if it is ready
  within 450 ms.
- **sfx/:** 64 procedurally generated, deterministic sounds (4 banks × 16). No audio files are shipped.
- **wav.ts:** 16-bit PCM WAV encoder (used for the iOS silent-audio fallback; unit-tested).

### 1.3 Vision (`src/vision`)

- **HandTracker:** camera via `getUserMedia` (ideal 1280×720 @ 30 fps → 640×480 → any; front camera by
  default, device selectable in Settings). MediaPipe `HandLandmarker`, VIDEO mode, 2 hands.
  The model is fetched by the app (progress bar): local `/mediapipe/models/hand_landmarker.task` first,
  Google CDN as fallback. The WASM runtime: local `/mediapipe/wasm` first, jsDelivr (same version) as
  fallback. Both are copied/downloaded into `public/mediapipe/` (not committed) by
  `scripts/vendor-mediapipe.mjs` on `predev` / `prebuild`.
- **Delegate:** GPU first — except when WebGL is software-rendered (SwiftShader, llvmpipe…), where the CPU
  delegate is used directly. After warm-up, a median GPU inference above 70 ms switches to CPU; a GPU
  exception at runtime also switches to CPU.
- **Loop:** driven by `requestVideoFrameCallback` (rAF fallback); inference is throttled to a target rate
  that adapts between 12 and 30 Hz from the measured inference time. **Inference runs on the main thread.**
- **Handedness:** MediaPipe labels assume a mirrored (selfie) image; raw frames are fed, so the labels
  are swapped. User override: "swap hands" (Settings + quick button on the stage). There is **no
  calibration wizard**.
- **GestureClassifier** (pure): works on the **normalised image landmarks (x, y, z)**, made isotropic
  with the video aspect ratio. **`worldLandmarks` are not used** (they were noisier on real MediaPipe
  output). Per finger: PIP/DIP bend angles + fingertip reach; thumb from distances to the palm; pinch
  distance; thumbs up/down from the on-screen thumb direction. 12 templates (OPEN_PALM, FIST, POINT,
  PEACE, THREE, FOUR, THUMBS_UP, THUMBS_DOWN, ROCK, CALL, PINCH, OK), each scored by its weakest finger
  → best gesture + confidence + all scores.
- **GestureSmoother** (pure): dwell 90 ms and ≥ 2 frames to start, lower hold threshold (hysteresis),
  release after 140 ms, per-gesture cooldown 200 ms → clean start/end events (a held pose never
  re-triggers). Settings map "sensitivity" to the enter threshold (0.72 → 0.45, hold = enter − 0.2) and
  expose dwell (40–300 ms) and cooldown (80–800 ms).
- **GestureEngine:** per hand: classify → smooth → continuous axes → motions. **The One-Euro filtering
  lives here** (x, y and pinch axes). It keeps hand identity when MediaPipe flips a left/right label for
  fewer than 12 frames, resolves two hands with the same label by screen position, and releases a hand
  missing for 200 ms.
- **MotionAnalyzer** (pure): works on the **raw** palm centre (no One-Euro): swipes (open hand, ≥ 20 % of
  the screen within 320 ms) and drum strikes (downward ≥ 1.5 screen heights per second). Thresholds were
  tuned on synthetic trajectories only.

### 1.4 Engine (`src/engine`)

- **Performance** (conductor): keyboard, pointer and gesture input → pad trigger/release, rule actions,
  UI feedback events. **Actions handled at runtime:** `pad`, `stopAll`, `mute`, `bankPrev`, `bankNext`,
  `fxHold`. The other action types declared in `mappingTypes.ts` (`loopPlay`, `loopRecord`, `undo`,
  `fxToggle`, `videoRecord`) are **no-ops** (roadmap).
- **GestureMapper:** discrete rule matching (used at runtime) and `assignTrigger` (learn gesture).
  `evaluateContinuous` and the continuous target ranges are implemented and unit-tested but **not called
  at runtime** — continuous gesture control is roadmap.
- **Modes visible in V0.1: Mèmes, Batterie, Perso.**
  - *Mèmes* — one gesture per pad (11 right-hand, 5 left-hand), left open hand = stop all, open-hand
    swipe ← / → = previous / next bank. Selecting the mode shows the MEMES bank.
  - *Batterie* — left / right downward strike = KICK / SNARE, plus pinch, peace, point, rock, thumbs-up
    and shaka for the other drums. Selecting the mode shows the DRUMS bank.
  - *Perso* — starts as a copy of the Mèmes rules; keeps the current bank.
  - Rule sets for `synth` and `fx` exist in code, but these modes are **hidden** (there is no synth engine
    and the effects are not exposed). As a result `mute` and `fxHold` are not reachable from the visible
    modes.
- **Learn gesture:** while a pad is learning, gestures trigger nothing; the first pose held for 650 ms
  (after the ~90 ms dwell) is assigned to that pad in the current mode, replacing any rule that used the
  same trigger or already pointed at that pad.
- **Project model** (`projectTypes.ts`, `defaultProject.ts`): banks of 16 pads (MEMES, DRUMS, FX, VOICES
  built-in + empty CUSTOM 1 / CUSTOM 2) and per-mode mappings. `normalizeProject` validates and upgrades
  stored data. `PadConfig.image` exists but has no UI.

### 1.5 State and persistence

- **zustand stores:** `projectStore` (the current project, autosaved 600 ms after a change),
  `settingsStore` (saved 300 ms after a change), `sessionStore` (runtime only: phase, drawer, selected pad,
  learn target, edit mode, toasts, keyboard labels, storage status).
- **IndexedDB `moha-motion` v1** (`persistence/db.ts`), with an in-memory fallback and a warning toast when
  IndexedDB is unavailable; `navigator.storage.persist()` is requested.
  - used: `samples` (imported audio, original bytes), `projects` (the current project), `kv` (settings,
    current project id);
  - created but **unused**: `images`, `recordings`.
- Only the current project exists: no project list, no export/import (`fflate` is a dependency but is
  not used yet).

### 1.6 UI (`src/app`, `src/features`, `src/components`)

- **Start screen:** START, FR/EN switch, hand-model download and sound-generation progress, privacy note.
- **Top bar:** modes, bank selector (◀ ▶), audio pill (click: resume if paused, else Diagnostics),
  camera / hands pill, Settings, Diagnostics.
- **Stage:** mirrored camera video + canvas overlay (neon skeleton per hand — right cyan, left green — with
  the current pose, gesture → action bubble, emoji burst on every pad hit, audio-reactive border),
  "show your hand" hint, gesture help grouped by hand (folded on phones), camera error cards with retry
  (denied, not found, busy, error; no retry when the browser has no camera API), model loading / error
  bar, swap-hands button.
- **Pads:** 4×4 grid, key labels matching the user's keyboard (Keyboard API, else language heuristic,
  else learned from key presses), gesture badge, playback progress bar, hit animation (Web Animations
  API), empty pad → file picker, drag & drop import. Editing: right-click or ⋯ (pointer devices), or the
  ✏️ Edit mode (any device; it ends automatically when the editor closes). On touch screens pads contain
  no button (Chrome's touch-target adjustment would steal taps) and there is no long-press. Haptic tick on
  Android.
- **Bottom bar:** TEST AUDIO, master meter, Import sound (first empty pad of the current bank, else the
  first empty pad of another bank, else the selected pad), ✏️ Edit, keyboard hint.
- **Drawer:**
  - *Pad editor* — pad picker, emoji, name, sound (my sounds + every built-in), preview, import,
    waveform with trim handles, gesture chips + learn + remove, play mode, volume, pitch, pan, fades,
    reverse, choke group, max voices, key capture, restore default (built-in banks) / clear.
  - *Settings* — language, camera (+ front/back when there are several), mirror, swap hands, skeleton,
    gesture help, sensitivity, dwell, cooldown, reset the gestures of the current mode.
  - *Diagnostics* — audio state, sample rate, base/output latency, worklet status, master volume, sounds
    loaded, voices, meter, output device (when `setSinkId` exists), TEST / RESUME / RESET AUDIO; camera
    status, device, resolution, camera and tracking fps, inference time, delegate, model source, hands,
    dropped frames, live gesture per hand, TEST / RESET / STOP CAMERA; UI fps, storage, version.
- **Keyboard:** 1234 / QWER / ASDF / ZXCV by physical position (per-pad override), Esc = stop all + close
  the drawer, ← / → = bank.
- Toasts, audio-paused banner, FR/EN (auto-detected), `prefers-reduced-motion` honoured.
- **Debug handle:** in dev mode or with `?debug` in the URL, the engine singletons are exposed as
  `window.__moha` (used for debugging and by the E2E tests).

### 1.7 PWA status

The production build contains a web manifest (linked from `index.html`), icons, and a Workbox service
worker (`sw.js`, generated by `vite-plugin-pwa`, with runtime caching rules for the MediaPipe files) —
**but the app never registers the service worker.** Offline use and installability are therefore **not
finalised and not verified.**

### 1.8 Tests

- **Unit (Vitest): 70 tests in 9 files** — classifier on 14 real MediaPipe outputs
  (`vision/__fixtures__/real-hands.json`, extracted with `scripts/extract-landmarks.mjs`) and on synthetic
  hands (`vision/testing/syntheticHand.ts`: 10 poses, both hands, palm/back, rotations, noise); smoother;
  motion analyzer + One-Euro filter; gesture engine; mapper; the 64 sounds; WAV encoder; i18n.
- **E2E (Playwright, Chromium only, fake camera): 7 tests** — V0.1 flow (START, measured TEST AUDIO level,
  camera, keyboard, mouse, import, persistence after reload, diagnostics); camera refused → pads still
  work; start screen; a real ✌️ photo as camera → exactly one trigger, no repeat while held, learn
  gesture; phone emulation 390×844, 375×667 and 844×390 (layout fit, taps, a long touch does not open the
  editor, edit mode). The gesture test is skipped when ffmpeg or internet is missing.
- **Not covered:** unit tests for Sampler, SampleLibrary, Performance and the stores; Safari, Firefox and
  real devices.

### 1.9 Known limitations of V0.1

- MediaPipe inference runs on the main thread: each inference blocks the UI while it runs (much longer on
  the CPU fallback).
- Gesture → sound latency is **estimated** at ~130–150 ms, about 100 ms of which is the anti-false-trigger
  dwell at 30 fps; keyboard and pointer trigger immediately. Not measured on real hardware.
- The handedness swap (MediaPipe labels on raw frames) has not been validated with a real webcam.
- Automated tests ran in headless Chromium only; Safari / iOS, Firefox and real phones are unverified.
- Swipe and strike thresholds come from synthetic data.

### 1.10 Folders (as they are)

```
src/
  app/          App shell (App, MainScreen), boot + START flow
  audio/        AudioEngine, EffectRack, SampleLibrary, Sampler, wav, sfx/ (procedural sounds + worker), worklets/
  vision/       HandTracker, GestureClassifier, GestureSmoother, GestureEngine, MotionAnalyzer, OneEuroFilter,
                gestureTypes, __fixtures__/ (real landmarks), testing/ (synthetic hands)
  engine/       Performance (conductor), GestureMapper (+ default rule sets), mappingTypes, projectTypes,
                defaultProject, emitter, instance (engine singletons)
  features/     start, layout (top / bottom bars), stage, sampler (pads, pad editor, waveform, import),
                drawer, settings, diagnostics
  components/   Toasts, AudioBanner, Meter, LangSwitch
  hooks/        useT, useEngines, useRaf, useKeyboardPads
  store/        projectStore, settingsStore, sessionStore
  persistence/  db.ts (IndexedDB + in-memory fallback)
  i18n/         fr, en
  styles/       global.css
  utils/        id
scripts/        vendor-mediapipe.mjs, generate-icons.mjs, extract-landmarks.mjs
e2e/            Playwright specs + fake-camera fixture setup
```

---

## PART 2 — ROADMAP / TARGET ARCHITECTURE (planned, NOT implemented)

Agreed order: audit fixes → gesture latency below 80 ms if possible → PWA / offline → effects → looper →
recorder → projects → final polish. The synth mode, mapping editor and calibration wizard are planned
as well.

- **Latency:** HandLandmarker in a Web Worker (with a main-thread fallback); faster confirmation of very
  clear gestures (target < 80 ms gesture → sound).
- **PWA:** register the service worker (with an update prompt), offline cache of the MediaPipe assets,
  installation as an app.
- **Effects:** an FX controller (base values + temporary gesture overrides + holds) driving the existing
  `EffectRack`; continuous rules (`evaluateContinuous`) evaluated on every tracked frame; FX panel and
  on-stage HUD; FX mode made visible.
- **Looper:** transport (play / stop / record, count-in, metronome on `clickBus`, BPM 60–200, 1 / 2 / 4 / 8
  bars, quantize), lookahead scheduler on `AudioContext.currentTime`, 8 tracks on `trackBus[i]`
  (volume / mute / solo / clear / duplicate), undo / redo, demo beat.
- **Recorder:** composite canvas (camera + overlay) → `captureStream(30)` + a
  `MediaStreamAudioDestinationNode` on `recordTap` → `MediaRecorder` (MP4 or WebM); WAV through the
  `moha-recorder` worklet; recordings kept in the `recordings` store.
- **Synth / instrument mode:** a synth engine on `synthBus`; pinch to play, hand height = pitch, scale lock,
  theremin glide, chords.
- **Projects:** several projects, new / save as / duplicate / delete, ZIP export / import (`fflate`:
  `project.json` + samples + images), pad images (`images` store), microphone sample recording.
- **Mapping editor UI:** every discrete and continuous rule of every mode editable without code (beyond
  today's learn gesture).
- **Calibration wizard:** camera, audio check, left / right confirmation, gesture confidence.
- **Desktop app:** optional Tauri wrapper around the static build (camera entitlements on macOS).

Target audio graph once the roadmap is done:

```
 liveBus + trackBus[i] (looper) + synthBus ─► mixBus ─► EffectRack (gesture-controlled) ─► master ─► … ─► limiter ─► recordTap ─┬─► output ─► speakers
                                                                                                                                ├─► analyser
                                                                                                                                ├─► MediaStreamDestination (video)
                                                                                                                                └─► moha-recorder worklet (WAV)
 metronome ─► clickBus ─► output   (heard, never recorded)
```
