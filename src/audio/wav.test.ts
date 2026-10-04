import { describe, expect, it } from 'vitest';
import { encodeWav, joinChunks } from './wav';

describe('wav', () => {
  it('writes a valid 16-bit PCM stereo header and clamps samples', () => {
    const l = new Float32Array([0, 0.5, -1, 2]);
    const r = new Float32Array([0, -0.5, 1, -2]);
    const buf = encodeWav([l, r], 48000);
    const v = new DataView(buf);
    const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(buf, o, n));
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(buf.byteLength).toBe(44 + 16);
    expect(v.getInt16(44 + 4, true)).toBe(Math.round(0.5 * 0x7fff - 0.5)); // l[1]
    expect(v.getInt16(44 + 6, true)).toBe(-0x4000); // r[1]
    expect(v.getInt16(44 + 12, true)).toBe(0x7fff); // l[3] clamped
    expect(v.getInt16(44 + 14, true)).toBe(-0x8000); // r[3] clamped
  });

  it('joins recorder chunks per channel', () => {
    const out = joinChunks([[new Float32Array([1, 2]), new Float32Array([3, 4])], [new Float32Array([5]), new Float32Array([6])]], 2);
    expect([...out[0]]).toEqual([1, 2, 5]);
    expect([...out[1]]).toEqual([3, 4, 6]);
  });
});
