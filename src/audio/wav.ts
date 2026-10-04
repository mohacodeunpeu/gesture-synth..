/** 16-bit PCM WAV encoder (interleaved). */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = Math.max(1, channels.length);
  const length = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const dataSize = length * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const ch = channels[c] ?? channels[0];
      const v = Math.max(-1, Math.min(1, ch[i] || 0));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

/** Concatenates PCM chunks (as produced by the recorder worklet) per channel. */
export function joinChunks(chunks: ReadonlyArray<readonly Float32Array[]>, numChannels: number): Float32Array[] {
  const total = chunks.reduce((n, c) => n + (c[0]?.length ?? 0), 0);
  const out = Array.from({ length: numChannels }, () => new Float32Array(total));
  let offset = 0;
  for (const chunk of chunks) {
    const len = chunk[0]?.length ?? 0;
    for (let c = 0; c < numChannels; c++) out[c].set(chunk[c] ?? chunk[0], offset);
    offset += len;
  }
  return out;
}
