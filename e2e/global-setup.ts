import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_DIR } from './paths';

/**
 * Builds the fake-camera video used by the gesture test: a real photo of a hand making a ✌️ sign
 * (from MediaPipe's public test assets), converted to Y4M for Chromium's fake capture device.
 * Downloaded at test time — nothing is committed.
 */
export default async function globalSetup() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const y4m = join(FIXTURE_DIR, 'victory.y4m');
  if (existsSync(y4m)) return;
  const jpg = join(FIXTURE_DIR, 'victory.jpg');
  if (!existsSync(jpg)) {
    const res = await fetch('https://storage.googleapis.com/mediapipe-assets/victory.jpg');
    if (!res.ok) throw new Error(`could not download the hand photo (HTTP ${res.status})`);
    writeFileSync(jpg, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-loop', '1', '-i', jpg, '-t', '2',
    '-vf', 'scale=-2:440,pad=640:480:(ow-iw)/2:(oh-ih)/2:color=0x808080,format=yuv420p',
    '-r', '30', y4m,
  ]);
}
