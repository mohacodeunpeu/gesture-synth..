import { drumSounds } from './drums';
import { fxSounds } from './fxsounds';
import { memeSounds } from './memes';
import { voiceSounds } from './voices';

export type SoundGenerator = (sampleRate: number) => Float32Array[];

export interface BuiltinSound {
  /** unique within its bank */
  id: string;
  name: string;
  emoji: string;
  generate: SoundGenerator;
}

export interface BuiltinBank {
  id: string;
  name: string;
  emoji: string;
  sounds: BuiltinSound[];
}

const s = (id: string, name: string, emoji: string, generate: SoundGenerator): BuiltinSound => ({ id, name, emoji, generate });

/** Built-in banks, 16 pads each, in pad order. Every sound is synthesised — no audio files. */
export const BUILTIN_BANKS: BuiltinBank[] = [
  {
    id: 'memes',
    name: 'MEMES',
    emoji: '😂',
    sounds: [
      s('bruh', 'BRUH', '💀', memeSounds.bruh),
      s('wow', 'WOW', '😮', memeSounds.wow),
      s('bonk', 'BONK', '🔨', memeSounds.bonk),
      s('boom', 'BOOM', '💥', memeSounds.boom),
      s('airhorn', 'AIRHORN', '📯', memeSounds.airhorn),
      s('laugh', 'HA HA', '🤣', memeSounds.laugh),
      s('wrong', 'ERROR', '❌', memeSounds.wrong),
      s('dramatic', 'DRAMA', '🎭', memeSounds.dramatic),
      s('sad', 'SAD TROMBONE', '🎺', memeSounds.sadTrombone),
      s('rimshot', 'BA DUM TSS', '🥁', memeSounds.rimshot),
      s('boing', 'BOING', '🌀', memeSounds.boing),
      s('crickets', 'CRICKETS', '🦗', memeSounds.crickets),
      s('tada', 'TADA', '🎉', memeSounds.tada),
      s('whoosh', 'WHOOSH', '💨', memeSounds.whoosh),
      s('pew', 'PEW', '⚡', memeSounds.pew),
      s('scratch', 'SCRATCH', '📀', memeSounds.scratch),
    ],
  },
  {
    id: 'drums',
    name: 'DRUMS',
    emoji: '🥁',
    sounds: [
      s('kick', 'KICK', '🦶', drumSounds.kick),
      s('snare', 'SNARE', '🥁', drumSounds.snare),
      s('clap', 'CLAP', '👏', drumSounds.clap),
      s('hat', 'HI-HAT', '🎩', drumSounds.hat),
      s('openhat', 'OPEN HAT', '🎪', drumSounds.openhat),
      s('tomlow', 'TOM LOW', '🛢️', drumSounds.tomlow),
      s('tommid', 'TOM MID', '🪣', drumSounds.tommid),
      s('tomhigh', 'TOM HIGH', '🥫', drumSounds.tomhigh),
      s('rim', 'RIM', '🪵', drumSounds.rim),
      s('cowbell', 'COWBELL', '🐄', drumSounds.cowbell),
      s('crash', 'CRASH', '💥', drumSounds.crash),
      s('ride', 'RIDE', '🛎️', drumSounds.ride),
      s('shaker', 'SHAKER', '🧂', drumSounds.shaker),
      s('sub', '808', '🔊', drumSounds.sub),
      s('snap', 'SNAP', '🫰', drumSounds.snap),
      s('conga', 'CONGA', '🪘', drumSounds.conga),
    ],
  },
  {
    id: 'fx',
    name: 'FX',
    emoji: '🚀',
    sounds: [
      s('riser', 'RISER', '🚀', fxSounds.riser),
      s('downlifter', 'DROP', '🛬', fxSounds.downlifter),
      s('impact', 'IMPACT', '💣', fxSounds.impact),
      s('laser', 'LASER', '🔫', fxSounds.laser),
      s('coin', 'COIN', '🪙', fxSounds.coin),
      s('powerup', 'POWER UP', '⭐', fxSounds.powerUp),
      s('explosion', 'EXPLOSION', '🧨', fxSounds.explosion),
      s('siren', 'SIREN', '🚨', fxSounds.siren),
      s('zap', 'ZAP', '⚡', fxSounds.zap),
      s('bubbles', 'BUBBLES', '🫧', fxSounds.bubbles),
      s('alarm', 'ALARM', '⏰', fxSounds.alarm),
      s('glitch', 'GLITCH', '👾', fxSounds.glitch),
      s('ufo', 'UFO', '🛸', fxSounds.ufo),
      s('sweep', 'SWEEP', '🌊', fxSounds.sweep),
      s('jump', 'JUMP', '🦘', fxSounds.jump),
      s('gameover', 'GAME OVER', '🕹️', fxSounds.gameOver),
    ],
  },
  {
    id: 'voices',
    name: 'VOICES',
    emoji: '🎤',
    sounds: [
      s('aah', 'AAH', '😇', voiceSounds.aah),
      s('ooh', 'OOH', '👻', voiceSounds.ooh),
      s('hey', 'HEY!', '👋', voiceSounds.hey),
      s('yeah', 'YEAH', '😎', voiceSounds.yeah),
      s('uhoh', 'UH-OH', '😬', voiceSounds.uhoh),
      s('whoa', 'WHOA', '😲', voiceSounds.whoa),
      s('huh', 'HUH?', '🤨', voiceSounds.huh),
      s('hmm', 'HMM', '🤔', voiceSounds.hmm),
      s('yay', 'YAY', '🥳', voiceSounds.yay),
      s('boo', 'BOO', '👎', voiceSounds.boo),
      s('ohno', 'OH NO', '😱', voiceSounds.ohno),
      s('ha', 'HA!', '😆', voiceSounds.ha),
      s('do', 'DO', '🎵', voiceSounds.doLow),
      s('mi', 'MI', '🎵', voiceSounds.mi),
      s('sol', 'SOL', '🎵', voiceSounds.sol),
      s('do2', 'DO+', '🎶', voiceSounds.doHigh),
    ],
  },
];

export const BUILTIN_PREFIX = 'builtin:';
export const builtinRef = (bankId: string, soundId: string) => `${BUILTIN_PREFIX}${bankId}/${soundId}`;

const index = new Map<string, BuiltinSound>();
for (const bank of BUILTIN_BANKS) for (const sound of bank.sounds) index.set(builtinRef(bank.id, sound.id), sound);

export function findBuiltin(ref: string): BuiltinSound | undefined {
  return index.get(ref);
}

export function allBuiltinRefs(): string[] {
  return [...index.keys()];
}
