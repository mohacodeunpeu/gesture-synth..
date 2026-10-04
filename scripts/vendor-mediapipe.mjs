#!/usr/bin/env node
// Copies the MediaPipe WASM runtime out of node_modules and downloads the hand
// landmark model into public/mediapipe so the app (and its offline PWA cache)
// never depends on a third-party CDN at runtime.
//
// Safe to run repeatedly: files are only copied/downloaded when missing or stale.
// A failed model download is NOT fatal: the app falls back to Google's CDN at
// runtime and prints a clear message in the diagnostics panel.
import { copyFile, mkdir, stat, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const outDir = join(root, 'public/mediapipe');
const wasmOut = join(outDir, 'wasm');
const modelOut = join(outDir, 'models/hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

async function sameFile(a, b) {
  try {
    const [sa, sb] = await Promise.all([stat(a), stat(b)]);
    return sa.size === sb.size && sb.mtimeMs >= sa.mtimeMs;
  } catch {
    return false;
  }
}

async function vendorWasm() {
  if (!existsSync(wasmSrc)) {
    console.warn('[vendor] @mediapipe/tasks-vision is not installed yet — run npm install.');
    return;
  }
  await mkdir(wasmOut, { recursive: true });
  let copied = 0;
  for (const file of WASM_FILES) {
    const from = join(wasmSrc, file);
    const to = join(wasmOut, file);
    if (!(await sameFile(from, to))) {
      await copyFile(from, to);
      copied++;
    }
  }
  console.log(`[vendor] MediaPipe WASM ready (${copied} file(s) updated).`);
}

async function vendorModel() {
  if (existsSync(modelOut)) {
    const { size } = await stat(modelOut);
    if (size > 1_000_000) {
      console.log('[vendor] Hand landmark model already present.');
      return;
    }
  }
  await mkdir(dirname(modelOut), { recursive: true });
  const tmp = `${modelOut}.download`;
  try {
    console.log('[vendor] Downloading hand landmark model (~7.5 MB)…');
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1_000_000) throw new Error(`unexpected size ${buf.length}`);
    await writeFile(tmp, buf);
    await rename(tmp, modelOut);
    console.log('[vendor] Hand landmark model saved to public/mediapipe/models.');
  } catch (err) {
    await rm(tmp, { force: true });
    console.warn(
      `[vendor] Could not download the hand model (${err instanceof Error ? err.message : err}).\n` +
        '         The app will load it from Google\'s CDN at runtime instead (needs internet).',
    );
  }
}

await vendorWasm();
await vendorModel();
