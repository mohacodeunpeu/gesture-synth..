import { create } from 'zustand';
import { assignTrigger, defaultMappingSet } from '../engine/GestureMapper';
import { MODE_DEFAULT_BANK, createDefaultProject, defaultPad, normalizeProject } from '../engine/defaultProject';
import type { ActionDef, MappingSet, ModeId, TriggerDef } from '../engine/mappingTypes';
import type { Bank, PadConfig, Project } from '../engine/projectTypes';
import { kvGet, kvSet, projectsTable } from '../persistence/db';
import { uid } from '../utils/id';

export type SaveState = 'saved' | 'saving' | 'error';

interface ProjectStore {
  project: Project;
  saveState: SaveState;
  setMode: (mode: ModeId) => void;
  setBank: (bankId: string) => void;
  cycleBank: (dir: 1 | -1) => Bank;
  updatePad: (bankId: string, index: number, patch: Partial<PadConfig>) => void;
  clearPad: (bankId: string, index: number) => void;
  resetPad: (bankId: string, index: number) => void;
  setMappingSet: (mode: ModeId, set: MappingSet) => void;
  assignGesture: (mode: ModeId, trigger: TriggerDef, action: ActionDef) => void;
  removePadGestures: (mode: ModeId, pad: number) => void;
  resetMappings: (mode: ModeId) => void;
  replaceProject: (p: Project) => void;
}

function touch(p: Project): Project {
  return { ...p, updatedAt: Date.now() };
}

export const useProject = create<ProjectStore>()((set, get) => ({
  project: createDefaultProject(),
  saveState: 'saved',

  setMode: (mode) =>
    set(({ project }) => {
      const bank = MODE_DEFAULT_BANK[mode];
      return { project: touch({ ...project, mode, bankId: bank && project.banks.some((b) => b.id === bank) ? bank : project.bankId }) };
    }),

  setBank: (bankId) => set(({ project }) => (project.banks.some((b) => b.id === bankId) ? { project: touch({ ...project, bankId }) } : {})),

  cycleBank: (dir) => {
    const { project } = get();
    const i = project.banks.findIndex((b) => b.id === project.bankId);
    const next = project.banks[(i + dir + project.banks.length) % project.banks.length];
    set({ project: touch({ ...project, bankId: next.id }) });
    return next;
  },

  updatePad: (bankId, index, patch) =>
    set(({ project }) => ({
      project: touch({
        ...project,
        banks: project.banks.map((b) => (b.id !== bankId ? b : { ...b, pads: b.pads.map((p, i) => (i === index ? { ...p, ...patch } : p)) })),
      }),
    })),

  clearPad: (bankId, index) =>
    get().updatePad(bankId, index, { sample: null, name: '', emoji: '➕', image: null, trimStart: 0, trimEnd: 0, reverse: false, pitch: 0 }),

  resetPad: (bankId, index) => get().updatePad(bankId, index, defaultPad(bankId, index)),

  setMappingSet: (mode, mapping) => set(({ project }) => ({ project: touch({ ...project, mappings: { ...project.mappings, [mode]: mapping } }) })),

  assignGesture: (mode, trigger, action) => {
    const { project } = get();
    get().setMappingSet(mode, assignTrigger(project.mappings[mode], trigger, action, () => uid('d')));
  },

  removePadGestures: (mode, pad) => {
    const set0 = get().project.mappings[mode];
    get().setMappingSet(mode, { ...set0, discrete: set0.discrete.filter((r) => !(r.action.type === 'pad' && r.action.pad === pad)) });
  },

  resetMappings: (mode) => get().setMappingSet(mode, defaultMappingSet(mode)),

  replaceProject: (p) => set({ project: p }),
}));

export const activeBank = (p: Project): Bank => p.banks.find((b) => b.id === p.bankId) ?? p.banks[0];

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function save(p: Project) {
  useProject.setState({ saveState: 'saving' });
  try {
    await projectsTable.put({ id: p.id, name: p.name, updatedAt: p.updatedAt, doc: p });
    await kvSet('currentProject', p.id);
    useProject.setState({ saveState: 'saved' });
  } catch (err) {
    console.error('[project] save failed', err);
    useProject.setState({ saveState: 'error' });
  }
}

/** Loads the last project (or creates the default one) and starts autosaving. */
export async function loadProject(): Promise<void> {
  const id = await kvGet<string>('currentProject').catch(() => undefined);
  const stored = id ? await projectsTable.get(id).catch(() => undefined) : undefined;
  if (stored) useProject.setState({ project: normalizeProject(stored.doc) });
  else void save(useProject.getState().project);
  useProject.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(useProject.getState().project), 600);
  });
}
