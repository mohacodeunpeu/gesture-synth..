#!/usr/bin/env node
// Renders the app icon (SVG below) to the PNG sizes the PWA manifest and iOS need.
// Uses Playwright's Chromium for pixel-perfect SVG rendering. Run once: node scripts/generate-icons.mjs
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = (maskable) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22e5ff"/><stop offset="1" stop-color="#2dffb4"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#0f3a48"/><stop offset="1" stop-color="#05060a"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="url(#glow)"/>
  <g transform="${maskable ? 'translate(76 76) scale(0.703)' : ''}">
    <path d="M104 372V160l76 108 76-108 76 108 76-108v212" fill="none" stroke="url(#g)" stroke-width="44"
      stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="420" cy="104" r="30" fill="#2dffb4"/>
  </g>
</svg>`;

const outputs = [
  ['public/icons/icon-192.png', 192, false],
  ['public/icons/icon-512.png', 512, false],
  ['public/icons/icon-maskable-512.png', 512, true],
  ['public/icons/apple-touch-icon.png', 180, true],
];

await mkdir('public/icons', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage();
  for (const [path, size, maskable] of outputs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(maskable).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
    await page.screenshot({ path, omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', path);
  }
} finally {
  await browser.close();
}
