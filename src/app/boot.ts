import { BUILTIN_BANKS, builtinRef } from '../audio/sfx/index';
import { audio, gestures, library, tracker } from '../engine/instance';
import { DEFAULT_PAD_KEYS } from '../engine/projectTypes';
import { initPersistence } from '../persistence/db';
import { activeBank, loadProject, useProject } from '../store/projectStore';
import { useSession } from '../store/sessionStore';
import { enterThreshold, getSettings, loadSettings, useSettings, type Settings } from '../store/settingsStore';

/** Pushes the user's settings into the realtime engines (and keeps them in sync). */
function applySettings(s: Settings) {
  tracker.settings = { ...tracker.settings, mirror: s.mirror, swapHands: s.swapHands };
  const enter = enterThreshold(s.sensitivity);
  gestures.setSmootherConfig({ enterThreshold: enter, holdThreshold: enter - 0.2, dwellMs: s.dwellMs, cooldownMs: s.cooldownMs });
  document.documentElement.lang = s.lang;
}

function preloadSounds() {
  const { project } = useProject.getState();
  const first = activeBank(project).pads.map((p) => p.sample).filter((s): s is string => !!s);
  const rest = BUILTIN_BANKS.flatMap((b) => b.sounds.map((s) => builtinRef(b.id, s.id)));
  library.preload([...first, ...rest]);
}

const QWERTY_LABELS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];
const AZERTY_LABELS = ['1', '2', '3', '4', 'A', 'Z', 'E', 'R', 'Q', 'S', 'D', 'F', 'W', 'X', 'C', 'V'];

export function keyLabelsFor(layout: 'qwerty' | 'azerty'): Record<string, string> {
  const labels = layout === 'azerty' ? AZERTY_LABELS : QWERTY_LABELS;
  return Object.fromEntries(DEFAULT_PAD_KEYS.map((code, i) => [code, labels[i]]));
}

interface KeyboardWithLayout {
  getLayoutMap?: () => Promise<Map<string, string>>;
}

/** Shows the letters actually printed on the user's keyboard (AZERTY on French Macs…). */
async function detectKeyboardLayout() {
  const kb = (navigator as Navigator & { keyboard?: KeyboardWithLayout }).keyboard;
  if (kb?.getLayoutMap) {
    try {
      const map = await kb.getLayoutMap();
      const labels: Record<string, string> = {};
      for (const code of DEFAULT_PAD_KEYS) {
        const v = map.get(code);
        labels[code] = code.startsWith('Digit') ? code.slice(5) : (v ?? code.replace(/^Key/, '')).toUpperCase();
      }
      useSession.getState().setKeyLabels(labels);
      return;
    } catch {
      /* fall through */
    }
  }
  const langs = navigator.languages ?? [navigator.language];
  const azerty = langs.some((l) => /^fr(-(fr|be|lu|mc))?$/i.test(l ?? ''));
  useSession.getState().setKeyLabels(keyLabelsFor(azerty ? 'azerty' : 'qwerty'));
}

let booted = false;

export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  const persistenceOk = await initPersistence();
  useSession.setState({ persistenceOk });
  await Promise.all([loadSettings(), loadProject(), library.init()]);
  applySettings(getSettings());
  useSettings.subscribe((s) => applySettings(s));
  preloadSounds();
  void detectKeyboardLayout();
  // start downloading the hand model while the user reads the start screen
  void tracker.loadModel();
  useSession.getState().setPhase('start');
  if (!persistenceOk) useSession.getState().toast('persistenceOff', 'error');
}

/**
 * START button. Everything audio-related happens SYNCHRONOUSLY inside the click (autoplay rules),
 * then the camera starts. The app stays usable with pads/keyboard even if the camera fails.
 */
export function startApp(): void {
  audio.unlock();
  if (audio.ctx) library.attachContext(audio.ctx);
  audio.playConfirm();
  useSession.getState().setPhase('app');
  void startCamera();
}

export async function startCamera(): Promise<void> {
  const s = getSettings();
  void tracker.loadModel();
  const ok = await tracker.startCamera(s.cameraId, s.facing);
  if (!ok && s.cameraId) {
    // the remembered camera disappeared: fall back to the default one
    useSettings.getState().set({ cameraId: null });
    await tracker.startCamera(null, s.facing);
  }
}
