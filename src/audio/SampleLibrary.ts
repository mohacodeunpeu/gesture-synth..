import { BUILTIN_PREFIX, findBuiltin } from './sfx/index';
import { samplesTable, type StoredSample } from '../persistence/db';
import { uid } from '../utils/id';

export const USER_PREFIX = 'user:';
export const userRef = (id: string) => `${USER_PREFIX}${id}`;

export interface SampleMeta {
  id: string;
  ref: string;
  name: string;
  mime: string;
  size: number;
  duration: number;
  createdAt: number;
  source: 'import' | 'mic';
}

export class SampleDecodeError extends Error {
  constructor(message = 'decode-failed') {
    super(message);
    this.name = 'SampleDecodeError';
  }
}

const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|opus|m4a|aac|mp4|flac|webm|caf|aif|aiff)$/i;

interface WorkerReply {
  id: number;
  ref: string;
  channels?: Float32Array[];
  error?: string;
}

type Listener = () => void;

/**
 * Decoded-audio cache. Every sample is decoded ONCE into an AudioBuffer; triggering a pad never
 * decodes anything. Built-in sounds are generated in a Web Worker (active bank first); user
 * samples are stored as original bytes in IndexedDB and decoded on first use.
 */
export class SampleLibrary {
  /** sample rate used to generate built-in sounds (updated to the AudioContext's) */
  sampleRate = 48000;
  private buffers = new Map<string, AudioBuffer>();
  private reversed = new Map<string, AudioBuffer>();
  private inflight = new Map<string, Promise<AudioBuffer | null>>();
  private metas = new Map<string, SampleMeta>();
  private peaksCache = new Map<string, Float32Array>();
  private listeners = new Set<Listener>();
  private decodeCtx: BaseAudioContext | null = null;
  private liveCtx: BaseAudioContext | null = null;
  private failed = new Set<string>();
  private version = 0;

  // worker queue for built-ins
  private worker: Worker | null = null;
  private workerBroken = false;
  private queue: string[] = [];
  private waiting = new Map<string, Array<(b: AudioBuffer | null) => void>>();
  private busy = false;
  private jobId = 0;

  async init(): Promise<void> {
    const stored = await samplesTable.getAll().catch(() => [] as StoredSample[]);
    for (const s of stored) this.metas.set(s.id, toMeta(s));
    this.emit();
  }

  /** Called once the real AudioContext exists: decode with it from now on. */
  attachContext(ctx: BaseAudioContext): void {
    this.liveCtx = ctx;
    this.sampleRate = ctx.sampleRate;
  }

  get(ref: string): AudioBuffer | undefined {
    return this.buffers.get(ref);
  }

  has(ref: string): boolean {
    return this.buffers.has(ref);
  }

  hasFailed(ref: string): boolean {
    return this.failed.has(ref);
  }

  /** Version counter that changes whenever samples are added/removed/renamed (for UI). */
  getVersion = (): number => this.version;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private emit() {
    this.version++;
    for (const cb of this.listeners) cb();
  }

  listUserSamples(): SampleMeta[] {
    return [...this.metas.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  meta(ref: string): SampleMeta | undefined {
    return ref.startsWith(USER_PREFIX) ? this.metas.get(ref.slice(USER_PREFIX.length)) : undefined;
  }

  /** Loads (generates or decodes) a sample. `urgent` jumps the generation queue. */
  load(ref: string, urgent = false): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(ref);
    if (cached) return Promise.resolve(cached);
    if (ref.startsWith(BUILTIN_PREFIX)) return this.loadBuiltin(ref, urgent);
    const existing = this.inflight.get(ref);
    if (existing) return existing;
    const p = this.loadUser(ref).finally(() => this.inflight.delete(ref));
    this.inflight.set(ref, p);
    return p;
  }

  /** Queue built-ins in priority order (e.g. the active bank first). */
  preload(refs: readonly string[]): void {
    for (const ref of refs) if (!this.buffers.has(ref)) void this.load(ref);
  }

  // ------------------------------------------------------------------------------------------
  // Built-ins (worker)
  // ------------------------------------------------------------------------------------------

  private loadBuiltin(ref: string, urgent: boolean): Promise<AudioBuffer | null> {
    return new Promise((resolve) => {
      const list = this.waiting.get(ref);
      if (list) {
        list.push(resolve);
        if (urgent) this.bump(ref);
        return;
      }
      this.waiting.set(ref, [resolve]);
      if (urgent) this.queue.unshift(ref);
      else this.queue.push(ref);
      this.pump();
    });
  }

  private bump(ref: string) {
    const i = this.queue.indexOf(ref);
    if (i > 0) {
      this.queue.splice(i, 1);
      this.queue.unshift(ref);
    }
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.workerBroken) return this.worker;
    try {
      this.worker = new Worker(new URL('./sfx/sfx.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onerror = (e) => {
        console.warn('[samples] worker failed, generating on the main thread', e.message);
        this.workerBroken = true;
        this.worker?.terminate();
        this.worker = null;
        this.busy = false;
        this.pump();
      };
    } catch (err) {
      console.warn('[samples] worker unavailable', err);
      this.workerBroken = true;
    }
    return this.worker;
  }

  private pump() {
    if (this.busy) return;
    const ref = this.queue.shift();
    if (!ref) return;
    if (this.buffers.has(ref)) {
      this.resolveWaiting(ref, this.buffers.get(ref)!);
      this.pump();
      return;
    }
    this.busy = true;
    const worker = this.ensureWorker();
    const id = ++this.jobId;
    const sr = this.sampleRate;
    if (worker) {
      worker.onmessage = (e: MessageEvent<WorkerReply>) => {
        if (e.data.id !== id) return;
        this.busy = false;
        this.finishBuiltin(ref, e.data.channels ?? null, sr, e.data.error);
        this.pump();
      };
      worker.postMessage({ id, ref, sampleRate: sr });
    } else {
      // main-thread fallback, one sound per task so the UI stays responsive
      setTimeout(() => {
        let channels: Float32Array[] | null = null;
        let error: string | undefined;
        try {
          channels = findBuiltin(ref)?.generate(sr) ?? null;
          if (!channels) error = 'unknown sound';
        } catch (err) {
          error = String(err);
        }
        this.busy = false;
        this.finishBuiltin(ref, channels, sr, error);
        this.pump();
      }, 0);
    }
  }

  private finishBuiltin(ref: string, channels: Float32Array[] | null, sr: number, error?: string) {
    if (!channels || error) {
      console.error(`[samples] could not generate ${ref}: ${error}`);
      this.failed.add(ref);
      this.resolveWaiting(ref, null);
      return;
    }
    const buf = this.makeBuffer(channels, sr);
    this.buffers.set(ref, buf);
    this.resolveWaiting(ref, buf);
    this.emit();
  }

  private resolveWaiting(ref: string, buf: AudioBuffer | null) {
    const list = this.waiting.get(ref);
    this.waiting.delete(ref);
    for (const r of list ?? []) r(buf);
  }

  private makeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
    const length = channels[0].length;
    let buf: AudioBuffer;
    try {
      buf = new AudioBuffer({ length, numberOfChannels: channels.length, sampleRate });
    } catch {
      const ctx = this.liveCtx ?? this.getDecodeCtx();
      buf = ctx.createBuffer(channels.length, length, sampleRate);
    }
    channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return buf;
  }

  // ------------------------------------------------------------------------------------------
  // User samples
  // ------------------------------------------------------------------------------------------

  private getDecodeCtx(): BaseAudioContext {
    if (this.liveCtx) return this.liveCtx;
    if (!this.decodeCtx) {
      const Offline = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      this.decodeCtx = new Offline(2, 1, 48000);
    }
    return this.decodeCtx;
  }

  private async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    try {
      return await this.getDecodeCtx().decodeAudioData(data.slice(0));
    } catch {
      throw new SampleDecodeError();
    }
  }

  private async loadUser(ref: string): Promise<AudioBuffer | null> {
    const id = ref.slice(USER_PREFIX.length);
    const stored = await samplesTable.get(id).catch(() => undefined);
    if (!stored) {
      this.failed.add(ref);
      return null;
    }
    try {
      const buf = await this.decode(stored.data);
      this.buffers.set(ref, buf);
      this.emit();
      return buf;
    } catch {
      this.failed.add(ref);
      return null;
    }
  }

  static looksLikeAudio(file: File): boolean {
    return file.type.startsWith('audio/') || file.type === 'video/mp4' || file.type === 'video/webm' || AUDIO_EXT.test(file.name);
  }

  /** Decodes (to validate), stores the original bytes locally, caches the buffer. */
  async importFile(file: File, source: 'import' | 'mic' = 'import'): Promise<SampleMeta> {
    if (file.size > MAX_IMPORT_BYTES) throw new SampleDecodeError('too-large');
    const data = await file.arrayBuffer();
    const name = cleanName(file.name) || 'SOUND';
    return this.importBytes(data, name, file.type || guessMime(file.name), source);
  }

  async importBytes(data: ArrayBuffer, name: string, mime: string, source: 'import' | 'mic'): Promise<SampleMeta> {
    const buf = await this.decode(data);
    if (buf.length < 16) throw new SampleDecodeError();
    const id = uid('s');
    const stored: StoredSample = { id, name, mime, size: data.byteLength, duration: buf.duration, createdAt: Date.now(), source, data };
    await samplesTable.put(stored);
    const meta = toMeta(stored);
    this.metas.set(id, meta);
    this.buffers.set(meta.ref, buf);
    this.emit();
    return meta;
  }

  async rename(id: string, name: string): Promise<void> {
    const stored = await samplesTable.get(id);
    if (!stored) return;
    stored.name = name;
    await samplesTable.put(stored);
    this.metas.set(id, toMeta(stored));
    this.emit();
  }

  async remove(id: string): Promise<void> {
    await samplesTable.delete(id);
    this.metas.delete(id);
    const ref = userRef(id);
    this.buffers.delete(ref);
    this.reversed.delete(ref);
    this.emit();
  }

  /** Raw bytes of a user sample (project export). */
  async bytes(id: string): Promise<StoredSample | undefined> {
    return samplesTable.get(id);
  }

  // ------------------------------------------------------------------------------------------
  // Analysis helpers
  // ------------------------------------------------------------------------------------------

  getReversed(ref: string): AudioBuffer | undefined {
    const cached = this.reversed.get(ref);
    if (cached) return cached;
    const src = this.buffers.get(ref);
    if (!src) return undefined;
    const channels = Array.from({ length: src.numberOfChannels }, (_, c) => src.getChannelData(c).slice().reverse());
    const rev = this.makeBuffer(channels, src.sampleRate);
    this.reversed.set(ref, rev);
    return rev;
  }

  /** Min/max envelope for waveform drawing: [min0, max0, min1, max1, …]. */
  peaks(ref: string, buckets = 96): Float32Array | null {
    const key = `${ref}#${buckets}`;
    const cached = this.peaksCache.get(key);
    if (cached) return cached;
    const buf = this.buffers.get(ref);
    if (!buf) return null;
    const out = computePeaks(buf.getChannelData(0), buckets);
    this.peaksCache.set(key, out);
    return out;
  }

  /** Seconds of near-silence at the start (used to auto-trim imported sounds). */
  leadingSilence(ref: string): number {
    const buf = this.buffers.get(ref);
    if (!buf) return 0;
    return leadingSilenceOf(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), buf.sampleRate);
  }
}

export function computePeaks(data: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const size = Math.max(1, Math.floor(data.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let min = 0;
    let max = 0;
    const start = b * size;
    const end = Math.min(data.length, start + size);
    for (let i = start; i < end; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}

export function leadingSilenceOf(channels: readonly Float32Array[], sampleRate: number, thresholdDb = -45): number {
  const thr = Math.pow(10, thresholdDb / 20);
  const len = channels[0]?.length ?? 0;
  for (let i = 0; i < len; i++) {
    for (const c of channels) {
      if (Math.abs(c[i]) > thr) {
        const t = i / sampleRate - 0.004; // keep a few ms before the attack
        return Math.max(0, Math.min(2, t));
      }
    }
  }
  return 0;
}

function toMeta(s: StoredSample): SampleMeta {
  return { id: s.id, ref: userRef(s.id), name: s.name, mime: s.mime, size: s.size, duration: s.duration, createdAt: s.createdAt, source: s.source };
}

function cleanName(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);
}

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm' };
  return (ext && map[ext]) || 'application/octet-stream';
}

export const sampleLibrary = new SampleLibrary();
