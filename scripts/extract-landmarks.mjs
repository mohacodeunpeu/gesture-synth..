#!/usr/bin/env node
/* global window */
// Dev tool: runs the real MediaPipe HandLandmarker (IMAGE mode) in headless Chromium on a folder of
// hand photos and writes the landmarks to a JSON file. The output is used as test fixtures for the
// gesture classifier so it is calibrated against real model output, not only synthetic hands.
//
// usage: node scripts/extract-landmarks.mjs <imagesDir> <out.json>
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const [imagesDir, outFile] = process.argv.slice(2);
if (!imagesDir || !outFile) {
  console.error('usage: node scripts/extract-landmarks.mjs <imagesDir> <out.json>');
  process.exit(1);
}
const root = resolve('.');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png', '.html': 'text/html', '.task': 'application/octet-stream' };

const page = `<!doctype html><meta charset="utf-8"><body><script type="module">
import { FilesetResolver, HandLandmarker } from '/tv/vision_bundle.mjs';
window.run = async (names) => {
  const fileset = await FilesetResolver.forVisionTasks('/public/mediapipe/wasm');
  const lm = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/public/mediapipe/models/hand_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE', numHands: 2, minHandDetectionConfidence: 0.3,
  });
  const out = {};
  for (const name of names) {
    const img = new Image(); img.src = '/img/' + name; await img.decode();
    const r = lm.detect(img);
    out[name] = { width: img.naturalWidth, height: img.naturalHeight, hands: r.landmarks.map((l, i) => ({
      label: r.handedness[i][0].categoryName, score: r.handedness[i][0].score,
      landmarks: l.map(p => [+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5)]),
      world: r.worldLandmarks[i].map(p => [+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5)]),
    })) };
  }
  return out;
};
window.ready = true;
</script>`;

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page); }
    let file;
    if (url.startsWith('/tv/')) file = join(root, 'node_modules/@mediapipe/tasks-vision', url.slice(4));
    else if (url.startsWith('/img/')) file = join(resolve(imagesDir), url.slice(5));
    else file = join(root, url);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const names = (await readdir(imagesDir)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
try {
  const p = await browser.newPage();
  p.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForFunction(() => window.ready === true);
  const result = await p.evaluate((n) => window.run(n), names);
  await writeFile(outFile, JSON.stringify(result, null, 0));
  for (const [name, r] of Object.entries(result)) {
    console.log(name.padEnd(28), r.hands.map((h) => `${h.label}(${h.score.toFixed(2)})`).join(' ') || 'no hands');
  }
} finally {
  await browser.close();
  server.close();
}
