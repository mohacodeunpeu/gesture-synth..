import { expect, type Page } from '@playwright/test';

/** 16-bit mono WAV with a short beep, built in the test (no audio files in the repo). */
export function makeWav(seconds = 0.4, freq = 660, sampleRate = 44100, silenceLead = 0.15): Buffer {
  const n = Math.round(seconds * sampleRate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const v = t < silenceLead ? 0 : 0.6 * Math.sin(2 * Math.PI * freq * t) * Math.exp(-(t - silenceLead) * 3);
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

export async function startApp(page: Page) {
  await page.goto('/');
  const start = page.getByTestId('start');
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByTestId('audio-pill')).toHaveAttribute('data-status', 'running');
}

/** Highest master level seen during `ms` (polls the meter's data attribute). */
export async function maxLevel(page: Page, ms = 600): Promise<number> {
  return page.evaluate(async (duration) => {
    const el = document.querySelector('[data-testid="master-meter"] > span') as HTMLElement | null;
    let max = 0;
    const end = performance.now() + duration;
    while (performance.now() < end) {
      max = Math.max(max, Number(el?.dataset.level ?? 0));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return max;
  }, ms);
}

export async function hits(page: Page, pad: number): Promise<number> {
  return Number(await page.getByTestId(`pad-${pad}`).getAttribute('data-hits'));
}
