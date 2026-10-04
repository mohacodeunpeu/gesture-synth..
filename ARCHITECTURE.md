# MOHA MOTION — Architecture

A local-first PWA: hand tracking (MediaPipe) → gesture engine → mapper → audio engine.
React only renders **state**; all realtime work lives in plain TypeScript engines.

```
 camera ─► HandTracker ─► GestureEngine ─► Performance (conductor) ─► Sampler / Synth / EffectRack
 (video)   (MediaPipe,     (classifier,      (mapping rules, modes,      │
           GPU→CPU)         smoother,         keyboard + touch input)    ▼
                            motion)                                  AudioEngine graph
                                                                          │
 Sequencer (looper) ── schedules on AudioContext.currentTime ────────────┘
 RecorderEngine ── taps the graph BEFORE ctx.destination (+ composite canvas for video)
```

## Audio graph (one AudioContext, `latencyHint: "interactive"`)

```
 pad voices (live) ─► liveBus ─┐
 sequencer tracks  ─► trackBus[i] ─┤
 synth voices      ─► synthBus ─┴─► mixBus ─► FX rack (DJ filter → stutter/tape worklet
                                                → dry + delay send + reverb send)
                                                       │
                                                  masterGain ─► pan ─► limiter ─► recordTap ─┬─► outputGain ─► destination
                                                                                             ├─► analyser (meters)
                                                                                             ├─► MediaStreamDestination (video rec)
                                                                                             └─► PCM recorder worklet (WAV)
 metronome / test tone ─► outputGain (heard, never recorded)
```

* The context is created/resumed **synchronously inside the START click** (iOS/Chrome autoplay rules),
  then a confirmation chime plays. `navigator.audioSession.type = "playback"` is set where available so
  iPhones in silent mode still play sound.
* Any `suspended` / `interrupted` state after unlock shows a full-width **"AUDIO PAUSED — CLICK TO RESUME"** banner.
* Buffers are decoded once and cached (`SampleLibrary`); triggering a pad only creates an
  `AudioBufferSourceNode`. Built-in sounds are **generated procedurally** (`src/audio/sfx`) — no copyrighted audio.
* AudioWorklets (FX + PCM recorder) are spliced in asynchronously; if they fail the graph keeps working
  (effects bypassed, WAV export falls back to compressed audio, clearly labelled).

## Vision pipeline

* `HandTracker` owns the camera stream and the MediaPipe `HandLandmarker` (VIDEO mode, 2 hands,
  GPU delegate with CPU fallback). Inference is driven by `requestVideoFrameCallback` (rAF fallback) and
  throttled to a target rate (~30 Hz, adaptive) — independent from the 60 fps UI.
* MediaPipe assumes mirrored input; raw frames are fed so handedness labels are swapped back
  (plus a user "swap hands" toggle + calibration).
* `GestureClassifier` (pure, unit-tested): per-finger extension from 3D world-landmark joint angles,
  template scoring with margins → gesture + confidence + per-gesture scores.
* `GestureSmoother` (pure): dwell time, min frames, hysteresis (hold threshold), release time and
  per-gesture cooldown → clean `start`/`end` events, no machine-gun triggering.
* `MotionAnalyzer` (pure): One-Euro filtered position, velocity, swipes, drum "strikes".
* `GestureMapper` (pure): rules `trigger → action` (discrete) and `axis → target` (continuous, optionally
  gated by a held gesture). Every mode (Memes, Drums, Synth, FX, Custom) is just a rule set + options,
  editable in the UI without code.

## State

* `zustand` stores: `projectStore` (persisted, autosaved to IndexedDB), `settingsStore` (persisted),
  `sessionStore` (runtime status: audio/camera/tracker/transport/UI).
* Realtime values (landmarks, meters, playhead, particles) never go through React state: canvases and
  meters read engine objects inside their own `requestAnimationFrame` loops.

## Persistence (IndexedDB `moha-motion`)

`samples` (user audio blobs) · `images` (pad images) · `projects` (JSON) · `recordings` (video/audio blobs) · `kv` (settings).
Project export/import = ZIP (`project.json` + referenced samples/images). Nothing is ever uploaded.

## Folders

```
src/
  app/          App shell, boot, layout
  audio/        AudioEngine, SampleLibrary, Sampler, Synth, EffectRack, Sequencer, RecorderEngine, sfx/, worklets
  vision/       HandTracker, GestureClassifier, GestureSmoother, MotionAnalyzer, GestureMapper, types
  engine/       Performance conductor (vision + input → actions), modes & default mappings, event bus
  features/     UI per feature: sampler, stage, looper, effects, mapper, recorder, projects, diagnostics, settings, onboarding
  components/   Small shared UI primitives
  store/        zustand stores
  persistence/  IndexedDB access + project (de)serialisation + ZIP bundles
  i18n/         FR / EN dictionaries
  styles/       Global CSS + tokens
```

## Future desktop app

Nothing depends on a server; the build is static files. A Tauri wrapper only needs to point at `dist/`
(camera permission entitlements on macOS are the only extra work).
