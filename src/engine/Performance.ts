import type { AudioEngine } from '../audio/AudioEngine';
import type { SampleLibrary } from '../audio/SampleLibrary';
import type { Sampler, TriggerResult } from '../audio/Sampler';
import type { GestureEngine, GestureEvent } from '../vision/GestureEngine';
import { GESTURE_EMOJI, MOTION_EMOJI, type GestureId, type HandSide, type MotionId } from '../vision/gestureTypes';
import type { HandTracker } from '../vision/HandTracker';
import { activeBank, useProject } from '../store/projectStore';
import { useSession } from '../store/sessionStore';
import { Emitter } from './emitter';
import { matchDiscrete } from './GestureMapper';
import type { ActionDef, DiscreteRule } from './mappingTypes';

export type InputSource = 'key' | 'pointer' | 'gesture' | 'motion' | 'preview';

export interface PadHitEvent {
  bankId: string;
  pad: number;
  result: TriggerResult;
  source: InputSource;
  hand?: HandSide;
  /** normalised display position of the hand that triggered it */
  x?: number;
  y?: number;
  velocity: number;
}

export interface GestureFiredEvent {
  hand: HandSide;
  emoji: string;
  gesture?: GestureId;
  motion?: MotionId;
  rules: DiscreteRule[];
  x: number;
  y: number;
}

export interface UiEvents extends Record<string, unknown> {
  padHit: PadHitEvent;
  padRelease: { bankId: string; pad: number };
  gestureFired: GestureFiredEvent;
  bankChanged: { bankId: string; name: string; emoji: string };
  learned: { pad: number; hand: HandSide; gesture: GestureId };
  stopAll: Record<string, never>;
}

const LEARN_HOLD_MS = 650;
const STUTTER_SECONDS = 0.125;
const TAPE_SECONDS = 0.9;

/**
 * The conductor: turns inputs (gesture events, keys, pointer) into actions on the audio engine,
 * according to the current mode's mapping rules, and broadcasts UI feedback events.
 */
export class Performance {
  readonly events = new Emitter<UiEvents>();
  private readonly audio: AudioEngine;
  private readonly library: SampleLibrary;
  private readonly sampler: Sampler;
  private readonly gestures: GestureEngine;

  constructor(audio: AudioEngine, library: SampleLibrary, sampler: Sampler, tracker: HandTracker, gestures: GestureEngine) {
    this.audio = audio;
    this.library = library;
    this.sampler = sampler;
    this.gestures = gestures;
    tracker.onFrame = (frame) => gestures.process(frame);
    tracker.onStop = () => gestures.reset();
    gestures.onEvent = (e) => this.onGesture(e);
    gestures.onFrame = (t) => this.onTrackedFrame(t);
  }

  static padKey(bankId: string, index: number): string {
    return `${bankId}:${index}`;
  }

  // ------------------------------------------------------------------------------------------
  // Pads
  // ------------------------------------------------------------------------------------------

  triggerPad(index: number, source: InputSource, opts: { velocity?: number; hand?: HandSide; x?: number; y?: number } = {}): TriggerResult {
    const { project } = useProject.getState();
    const bank = activeBank(project);
    const pad = bank.pads[index];
    if (!pad) return 'empty';
    const velocity = opts.velocity ?? 1;
    const result = this.sampler.trigger(Performance.padKey(bank.id, index), pad, { velocity });
    this.events.emit('padHit', { bankId: bank.id, pad: index, result, source, hand: opts.hand, x: opts.x, y: opts.y, velocity });
    const session = useSession.getState();
    if (result === 'empty') session.toast('padEmpty', 'info', { pad: index + 1 });
    else if (result === 'no-audio') session.toast('audioNotReady', 'error');
    else if (result === 'failed') session.toast('soundFailed', 'error');
    if (pad.mode === 'gate' && source === 'motion') setTimeout(() => this.releasePad(index), 220);
    return result;
  }

  releasePad(index: number): void {
    const { project } = useProject.getState();
    const bank = activeBank(project);
    const pad = bank.pads[index];
    if (pad?.mode === 'gate') this.sampler.release(Performance.padKey(bank.id, index));
    this.events.emit('padRelease', { bankId: bank.id, pad: index });
  }

  /** Plays a pad of any bank (editor preview), ignoring the active bank. */
  previewPad(bankId: string, index: number): TriggerResult {
    const bank = useProject.getState().project.banks.find((b) => b.id === bankId);
    const pad = bank?.pads[index];
    if (!bank || !pad) return 'empty';
    return this.sampler.trigger(Performance.padKey(bank.id, index), { ...pad, mode: pad.mode === 'loop' ? 'oneshot' : pad.mode }, {});
  }

  stopAll(): void {
    this.sampler.stopAll();
    this.audio.graph?.fx.setStutter(false, STUTTER_SECONDS);
    this.audio.graph?.fx.setTapeStop(false, TAPE_SECONDS);
    this.events.emit('stopAll', {});
  }

  cycleBank(dir: 1 | -1): void {
    const bank = useProject.getState().cycleBank(dir);
    this.library.preload(bank.pads.map((p) => p.sample).filter((s): s is string => !!s));
    this.events.emit('bankChanged', { bankId: bank.id, name: bank.name, emoji: bank.emoji });
  }

  // ------------------------------------------------------------------------------------------
  // Gestures
  // ------------------------------------------------------------------------------------------

  private onGesture(e: GestureEvent) {
    if (useSession.getState().learnPad !== null) return; // learning: gestures don't play anything
    const { project } = useProject.getState();
    const set = project.mappings[project.mode];
    if (e.kind === 'gesture') {
      const rules = matchDiscrete(set.discrete, { kind: 'gesture', hand: e.hand, gesture: e.gesture });
      for (const r of rules) this.runAction(r.action, e.phase, e.hand, e.x, e.y, 1, 'gesture');
      if (e.phase === 'start') this.events.emit('gestureFired', { hand: e.hand, emoji: GESTURE_EMOJI[e.gesture], gesture: e.gesture, rules, x: e.x, y: e.y });
    } else {
      const rules = matchDiscrete(set.discrete, { kind: 'motion', hand: e.hand, motion: e.motion });
      for (const r of rules) this.runAction(r.action, 'start', e.hand, e.x, e.y, e.intensity, 'motion');
      if (rules.length) this.events.emit('gestureFired', { hand: e.hand, emoji: MOTION_EMOJI[e.motion], motion: e.motion, rules, x: e.x, y: e.y });
    }
  }

  private runAction(action: ActionDef, phase: 'start' | 'end', hand: HandSide, x: number, y: number, velocity: number, source: InputSource) {
    switch (action.type) {
      case 'pad':
        if (phase === 'start') this.triggerPad(action.pad, source, { velocity, hand, x, y });
        else this.releasePad(action.pad);
        break;
      case 'stopAll':
        if (phase === 'start') this.stopAll();
        break;
      case 'mute':
        if (phase === 'start') this.audio.setMuted(!this.audio.getInfo().muted);
        break;
      case 'bankPrev':
      case 'bankNext':
        if (phase === 'start') this.cycleBank(action.type === 'bankNext' ? 1 : -1);
        break;
      case 'fxHold':
        if (action.fx === 'stutter') this.audio.graph?.fx.setStutter(phase === 'start', STUTTER_SECONDS);
        else this.audio.graph?.fx.setTapeStop(phase === 'start', TAPE_SECONDS);
        break;
      default:
        // looper / recorder / fx toggles arrive with their features
        break;
    }
  }

  /** After every tracked frame: "learn gesture" waits for a pose held steadily. */
  private onTrackedFrame(t: number) {
    const session = useSession.getState();
    const pad = session.learnPad;
    if (pad === null) return;
    for (const side of ['Right', 'Left'] as const) {
      const h = this.gestures.hands[side];
      if (h.present && h.stable !== 'NONE' && t - h.stableSince >= LEARN_HOLD_MS) {
        const { project, assignGesture } = useProject.getState();
        assignGesture(project.mode, { kind: 'gesture', hand: side, gesture: h.stable }, { type: 'pad', pad });
        session.setLearnPad(null);
        this.events.emit('learned', { pad, hand: side, gesture: h.stable });
        return;
      }
    }
  }
}
