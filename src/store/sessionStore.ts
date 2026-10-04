import { create } from 'zustand';
import type { DictKey } from '../i18n';
import { uid } from '../utils/id';

export type Phase = 'boot' | 'start' | 'app';
export type DrawerTab = 'pad' | 'settings' | 'diagnostics';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  key: DictKey;
  vars?: Record<string, string | number>;
}

interface SessionStore {
  phase: Phase;
  drawer: DrawerTab | null;
  selectedPad: number;
  /** pad waiting for a gesture to be learned */
  learnPad: number | null;
  /** touch-friendly edit mode: tapping a pad opens its editor instead of playing it */
  editMode: boolean;
  toasts: Toast[];
  persistenceOk: boolean;
  /** KeyboardEvent.code → label printed on the user's keyboard */
  keyLabels: Record<string, string>;
  setPhase: (p: Phase) => void;
  openDrawer: (tab: DrawerTab, pad?: number) => void;
  closeDrawer: () => void;
  selectPad: (pad: number) => void;
  setLearnPad: (pad: number | null) => void;
  setEditMode: (on: boolean) => void;
  toast: (key: DictKey, kind?: Toast['kind'], vars?: Toast['vars']) => void;
  dismiss: (id: string) => void;
  setKeyLabels: (labels: Record<string, string>) => void;
}

export const useSession = create<SessionStore>()((set, get) => ({
  phase: 'boot',
  drawer: null,
  selectedPad: 0,
  learnPad: null,
  editMode: false,
  toasts: [],
  persistenceOk: true,
  keyLabels: {},
  setPhase: (phase) => set({ phase }),
  openDrawer: (tab, pad) => set({ drawer: tab, ...(pad !== undefined ? { selectedPad: pad } : {}) }),
  // leaving the editor always leaves edit mode, so pads never stay silently "in edit"
  closeDrawer: () => set({ drawer: null, learnPad: null, editMode: false }),
  selectPad: (selectedPad) => set({ selectedPad }),
  setLearnPad: (learnPad) => set({ learnPad }),
  setEditMode: (editMode) => set(editMode ? { editMode } : { editMode, drawer: get().drawer === 'pad' ? null : get().drawer }),
  toast: (key, kind = 'info', vars) => {
    // identical toasts are not stacked
    const existing = get().toasts.find((t) => t.key === key && JSON.stringify(t.vars) === JSON.stringify(vars));
    if (existing) return;
    const id = uid('t');
    set({ toasts: [...get().toasts.slice(-3), { id, kind, key, vars }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 2600);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setKeyLabels: (keyLabels) => set({ keyLabels }),
}));
