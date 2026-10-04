import { BUILTIN_BANKS, builtinRef } from '../audio/sfx/index';
import { uid } from '../utils/id';
import { defaultMappingSet, defaultMappings } from './GestureMapper';
import { MODES, type Mappings, type ModeId } from './mappingTypes';
import { PAD_COUNT, PAD_MODES, emptyPad, type Bank, type PadConfig, type Project } from './projectTypes';

/** Pads that sound better with a non-default setting. */
const PAD_OVERRIDES: Record<string, Partial<PadConfig>> = {
  'drums/hat': { choke: 1, poly: 2 },
  'drums/openhat': { choke: 1, poly: 2 },
  'drums/kick': { poly: 3 },
  'fx/riser': { mode: 'retrigger' },
  'fx/siren': { mode: 'retrigger' },
  'fx/ufo': { mode: 'retrigger' },
  'memes/crickets': { mode: 'retrigger' },
};

export function builtinBank(bankId: string): Bank {
  const def = BUILTIN_BANKS.find((b) => b.id === bankId);
  if (!def) throw new Error(`unknown bank ${bankId}`);
  return {
    id: def.id,
    name: def.name,
    emoji: def.emoji,
    pads: def.sounds.map((s, i) => ({
      ...emptyPad(i),
      sample: builtinRef(def.id, s.id),
      name: s.name,
      emoji: s.emoji,
      ...PAD_OVERRIDES[`${def.id}/${s.id}`],
    })),
  };
}

export function emptyBank(id: string, name: string, emoji: string): Bank {
  return { id, name, emoji, pads: Array.from({ length: PAD_COUNT }, (_, i) => emptyPad(i)) };
}

/** Default pad for a slot (used by "restore default"). */
export function defaultPad(bankId: string, index: number): PadConfig {
  if (BUILTIN_BANKS.some((b) => b.id === bankId)) return builtinBank(bankId).pads[index];
  return emptyPad(index);
}

export const MODE_DEFAULT_BANK: Partial<Record<ModeId, string>> = {
  memes: 'memes',
  drums: 'drums',
  synth: 'voices',
};

export function createDefaultProject(name = 'Mon projet'): Project {
  const now = Date.now();
  return {
    v: 1,
    id: uid('p'),
    name,
    createdAt: now,
    updatedAt: now,
    mode: 'memes',
    bankId: 'memes',
    banks: [
      ...BUILTIN_BANKS.map((b) => builtinBank(b.id)),
      emptyBank('custom1', 'CUSTOM 1', '⭐'),
      emptyBank('custom2', 'CUSTOM 2', '💎'),
    ],
    mappings: defaultMappings(),
  };
}

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

function normalizePad(raw: unknown, index: number): PadConfig {
  const d = emptyPad(index);
  if (!raw || typeof raw !== 'object') return d;
  const p = raw as Record<string, unknown>;
  return {
    sample: typeof p.sample === 'string' ? p.sample : null,
    name: str(p.name, d.name).slice(0, 40),
    emoji: str(p.emoji, d.emoji).slice(0, 8) || d.emoji,
    color: Math.round(num(p.color, d.color, 0, 15)),
    mode: PAD_MODES.includes(p.mode as PadConfig['mode']) ? (p.mode as PadConfig['mode']) : d.mode,
    volume: num(p.volume, d.volume, 0, 1.5),
    pan: num(p.pan, d.pan, -1, 1),
    pitch: num(p.pitch, d.pitch, -24, 24),
    trimStart: num(p.trimStart, 0, 0, 600),
    trimEnd: num(p.trimEnd, 0, 0, 600),
    fadeIn: num(p.fadeIn, 0, 0, 10),
    fadeOut: num(p.fadeOut, 0, 0, 10),
    reverse: p.reverse === true,
    choke: Math.round(num(p.choke, 0, 0, 4)),
    poly: Math.round(num(p.poly, d.poly, 1, 8)),
    key: typeof p.key === 'string' ? p.key : null,
    image: typeof p.image === 'string' ? p.image : null,
  };
}

/**
 * Validates and upgrades a project loaded from storage or an imported file: unknown fields are
 * dropped, missing ones get defaults, so old saves keep working as the format evolves.
 */
export function normalizeProject(raw: unknown): Project {
  const base = createDefaultProject();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const banksRaw = Array.isArray(r.banks) ? r.banks : [];
  const banks: Bank[] = banksRaw
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && typeof (b as { id?: unknown }).id === 'string')
    .map((b) => ({
      id: b.id as string,
      name: str(b.name, 'BANK').slice(0, 24),
      emoji: str(b.emoji, '🎵'),
      pads: Array.from({ length: PAD_COUNT }, (_, i) => normalizePad(Array.isArray(b.pads) ? b.pads[i] : undefined, i)),
    }));
  // make sure every default bank exists (a save from an older version may miss new banks)
  for (const def of base.banks) if (!banks.some((b) => b.id === def.id)) banks.push(def);

  const mappings = {} as Mappings;
  const mRaw = (r.mappings && typeof r.mappings === 'object' ? r.mappings : {}) as Record<string, unknown>;
  for (const mode of MODES) {
    const set = mRaw[mode] as { discrete?: unknown; continuous?: unknown } | undefined;
    mappings[mode] =
      set && Array.isArray(set.discrete) && Array.isArray(set.continuous)
        ? { discrete: set.discrete as Mappings[ModeId]['discrete'], continuous: set.continuous as Mappings[ModeId]['continuous'] }
        : defaultMappingSet(mode);
  }
  const mode = MODES.includes(r.mode as ModeId) ? (r.mode as ModeId) : base.mode;
  const bankId = typeof r.bankId === 'string' && banks.some((b) => b.id === r.bankId) ? r.bankId : banks[0].id;
  return {
    v: 1,
    id: str(r.id, base.id),
    name: str(r.name, base.name).slice(0, 60),
    createdAt: num(r.createdAt, base.createdAt, 0, 1e15),
    updatedAt: num(r.updatedAt, base.updatedAt, 0, 1e15),
    mode,
    bankId,
    banks,
    mappings,
  };
}
