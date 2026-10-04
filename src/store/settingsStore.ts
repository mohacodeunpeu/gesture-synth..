import { create } from 'zustand';
import { detectLang, type Lang } from '../i18n';
import { kvGet, kvSet } from '../persistence/db';

export interface Settings {
  lang: Lang;
  mirror: boolean;
  swapHands: boolean;
  /** 0 = strict (fewer false triggers) … 1 = sensitive */
  sensitivity: number;
  dwellMs: number;
  cooldownMs: number;
  cameraId: string | null;
  facing: 'user' | 'environment';
  showSkeleton: boolean;
  showCheatSheet: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: detectLang(),
  mirror: true,
  swapHands: false,
  sensitivity: 0.5,
  dwellMs: 90,
  cooldownMs: 200,
  cameraId: null,
  facing: 'user',
  showSkeleton: true,
  showCheatSheet: true,
};

/** enter threshold for the gesture smoother from the sensitivity slider */
export function enterThreshold(sensitivity: number): number {
  return 0.72 - 0.27 * Math.max(0, Math.min(1, sensitivity));
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsStore>()((set) => ({
  ...DEFAULT_SETTINGS,
  set: (patch) => set(patch),
}));

export function getSettings(): Settings {
  const { set: _set, ...s } = useSettings.getState();
  return s;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadSettings(): Promise<void> {
  const saved = await kvGet<Partial<Settings>>('settings').catch(() => undefined);
  if (saved && typeof saved === 'object') {
    const clean: Partial<Settings> = {};
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = saved[key];
      if (v !== undefined && (typeof v === typeof DEFAULT_SETTINGS[key] || (key === 'cameraId' && (v === null || typeof v === 'string')))) {
        (clean as Record<string, unknown>)[key] = v;
      }
    }
    useSettings.setState(clean);
  }
  useSettings.subscribe(() => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void kvSet('settings', getSettings()).catch(() => undefined), 300);
  });
}
