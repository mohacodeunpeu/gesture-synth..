/* global sampleRate, registerProcessor, AudioWorkletProcessor */
// AudioWorklet processors for MOHA MOTION. Plain JS on purpose: loaded with audioWorklet.addModule().

const FADE_SECONDS = 0.006;

/**
 * Stutter (beat repeat) + tape stop on the master bus.
 * Keeps a 4 s ring buffer of its input. Pass-through when idle (no added latency).
 *   port.postMessage({ type: 'stutter', on: true, seconds: 0.125 })
 *   port.postMessage({ type: 'tape', on: true, seconds: 0.8 })
 */
class GlitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.ceil(sampleRate * 4);
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.w = 0;
    this.mode = 'off';
    this.mix = 0; // crossfade live ↔ effect
    this.target = 0;
    this.step = 1 / (FADE_SECONDS * sampleRate);
    this.sliceLen = 1;
    this.sliceStart = 0;
    this.slicePos = 0;
    this.pendingSlice = 0;
    this.tapePos = 0;
    this.tapeRate = 1;
    this.tapeDecel = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (m.type === 'stutter') {
      if (m.on) {
        const len = Math.max(64, Math.min(this.size - 1, Math.round(m.seconds * sampleRate)));
        if (this.mode !== 'stutter') {
          this.sliceLen = len;
          this.sliceStart = (this.w - len + this.size) % this.size;
          this.slicePos = 0;
          this.mode = 'stutter';
        } else if (len !== this.sliceLen) {
          this.pendingSlice = len; // applied at the next slice boundary
        }
        this.target = 1;
      } else if (this.mode === 'stutter') {
        this.target = 0;
      }
    } else if (m.type === 'tape') {
      if (m.on) {
        if (this.mode !== 'tape') {
          this.mode = 'tape';
          this.tapePos = this.w;
          this.tapeRate = 1;
        }
        this.tapeDecel = 1 / Math.max(0.05, m.seconds) / sampleRate;
        this.target = 1;
      } else if (this.mode === 'tape') {
        this.target = 0;
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const inL = input && input[0];
    const inR = input && (input[1] || input[0]);
    const outL = output[0];
    const outR = output[1] || output[0];
    const n = outL.length;
    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : 0;
      this.bufL[this.w] = l;
      this.bufR[this.w] = r;

      let el = 0;
      let er = 0;
      if (this.mode === 'stutter') {
        const idx = (this.sliceStart + this.slicePos) % this.size;
        const fadeLen = Math.min(this.sliceLen / 2, FADE_SECONDS * sampleRate);
        const edge = Math.min(1, this.slicePos / fadeLen, (this.sliceLen - this.slicePos) / fadeLen);
        el = this.bufL[idx] * edge;
        er = this.bufR[idx] * edge;
        this.slicePos++;
        if (this.slicePos >= this.sliceLen) {
          this.slicePos = 0;
          if (this.pendingSlice) {
            this.sliceLen = this.pendingSlice;
            this.sliceStart = (this.w - this.sliceLen + this.size) % this.size;
            this.pendingSlice = 0;
          }
        }
      } else if (this.mode === 'tape') {
        const p = this.tapePos;
        const i0 = Math.floor(p);
        const frac = p - i0;
        const a = ((i0 % this.size) + this.size) % this.size;
        const b = (a + 1) % this.size;
        el = this.bufL[a] + (this.bufL[b] - this.bufL[a]) * frac;
        er = this.bufR[a] + (this.bufR[b] - this.bufR[a]) * frac;
        // pitch drops with speed; also fade the level as the "platter" stops
        const lvl = Math.min(1, this.tapeRate * 1.5);
        el *= lvl;
        er *= lvl;
        this.tapePos += this.tapeRate;
        this.tapeRate = Math.max(0, this.tapeRate - this.tapeDecel);
      }

      if (this.mix !== this.target) {
        this.mix = this.target > this.mix ? Math.min(this.target, this.mix + this.step) : Math.max(this.target, this.mix - this.step);
        if (this.mix === 0) this.mode = 'off';
      }
      outL[i] = l * (1 - this.mix) + el * this.mix;
      if (outR !== outL) outR[i] = r * (1 - this.mix) + er * this.mix;
      this.w = (this.w + 1) % this.size;
    }
    return true;
  }
}

/**
 * Captures raw PCM from its input and posts Float32 chunks to the main thread (for WAV export).
 *   port.postMessage({ type: 'start' }) / ({ type: 'stop' })
 */
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.chunk = 8192;
    this.reset(2);
    this.port.onmessage = (e) => {
      if (e.data.type === 'start') {
        this.recording = true;
        this.reset(2);
      } else if (e.data.type === 'stop') {
        this.flush();
        this.recording = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  reset(channels) {
    this.channels = channels;
    this.bufs = Array.from({ length: channels }, () => new Float32Array(this.chunk));
    this.pos = 0;
  }

  flush() {
    if (this.pos === 0) return;
    const out = this.bufs.map((b) => b.slice(0, this.pos));
    this.port.postMessage({ type: 'chunk', channels: out }, out.map((c) => c.buffer));
    this.pos = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    // keep the node silent: its output only exists so the graph pulls it
    for (const ch of outputs[0]) ch.fill(0);
    if (!this.recording) return true;
    const n = input && input[0] ? input[0].length : 128;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < this.channels; c++) {
        const src = input && (input[c] || input[0]);
        this.bufs[c][this.pos] = src ? src[i] : 0;
      }
      this.pos++;
      if (this.pos >= this.chunk) this.flush();
    }
    return true;
  }
}

registerProcessor('moha-glitch', GlitchProcessor);
registerProcessor('moha-recorder', RecorderProcessor);
