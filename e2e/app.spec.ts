import { expect, test } from '@playwright/test';
import { FIXTURE_DIR } from './paths';
import { hits, makeWav, maxLevel, startApp } from './helpers';

/** MediaPipe/Emscripten print their logs on stderr → console.error; those are not app errors. */
const NOISE = /^(INFO|WARNING|W\d{4}|I\d{4})|XNNPACK|TensorFlow Lite|gl_context|OpenGL|WebGL|GPU stall/i;

test('V0.1 flow: START → test audio → camera → pads (keys + mouse) → import → persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  await startApp(page);

  // TEST AUDIO really produces signal on the master bus
  await page.getByTestId('test-audio').click();
  expect(await maxLevel(page, 900)).toBeGreaterThan(0.05);

  // camera (Chromium fake device) is live
  await expect(page.getByTestId('camera-pill')).toHaveAttribute('data-status', 'live');

  // 16 pads, all filled in the MEMES bank
  await expect(page.locator('[data-testid^="pad-"]')).toHaveCount(16);
  await expect(page.getByTestId('pad-0')).toContainText('BRUH');

  // keyboard → pad 1
  await page.keyboard.press('Digit1');
  await expect.poll(() => hits(page, 0)).toBe(1);
  await expect(page.getByTestId('pad-0')).toHaveAttribute('data-result', 'played');
  expect(await maxLevel(page, 500)).toBeGreaterThan(0.02);

  // mouse → pad 5 (AIRHORN)
  await page.getByTestId('pad-4').click();
  await expect.poll(() => hits(page, 4)).toBe(1);
  await expect(page.getByTestId('pad-4')).toHaveAttribute('data-result', 'played');

  // import a sound: goes to the first free pad (CUSTOM 1 bank, pad 1)
  await page.getByTestId('import-input').setInputFiles({ name: 'my-beep.wav', mimeType: 'audio/wav', buffer: makeWav() });
  await expect(page.locator('.toast.success')).toContainText('my beep');
  await expect(page.getByTestId('bank-select')).toHaveValue('custom1');
  await expect(page.getByTestId('pad-0')).toContainText('my beep');
  await page.waitForTimeout(700);

  // the imported sound plays from the keyboard
  await page.keyboard.press('Digit1');
  await expect.poll(() => hits(page, 0)).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('pad-0')).toHaveAttribute('data-result', 'played');
  expect(await maxLevel(page, 600)).toBeGreaterThan(0.02);

  // diagnostics show a healthy system
  await page.getByTestId('open-diagnostics').click();
  await expect(page.getByTestId('diag-audio-state')).toHaveText('running');
  await expect(page.getByTestId('diag-camera-state')).toHaveText('live');
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/desktop-diagnostics.png` });
  await page.getByTestId('drawer-close').click();

  // everything survives a reload (IndexedDB)
  await page.reload();
  await startApp(page);
  await expect(page.getByTestId('bank-select')).toHaveValue('custom1');
  await expect(page.getByTestId('pad-0')).toContainText('my beep');
  await page.keyboard.press('Digit1');
  await expect(page.getByTestId('pad-0')).toHaveAttribute('data-result', 'played');

  await page.getByTestId('bank-select').selectOption('memes');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/desktop-main.png` });

  expect(errors).toEqual([]);
});

test('pads keep working when the camera is refused', async ({ browser }) => {
  const context = await browser.newContext({ permissions: [] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await startApp(page);
  await expect(page.getByTestId('camera-card')).toHaveAttribute('data-status', 'denied');
  await page.keyboard.press('Digit2');
  await expect(page.getByTestId('pad-1')).toHaveAttribute('data-result', 'played');
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/desktop-camera-denied.png` });
  await context.close();
});

test('start screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('start')).toBeEnabled();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/desktop-start.png` });
});
