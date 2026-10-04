import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { FIXTURE_DIR } from './paths';
import { hits, startApp } from './helpers';

// The fake camera shows a real photo of a ✌️ hand (see global-setup.ts).
test('a real ✌️ hand triggers its pad exactly once, and "learn gesture" works', async ({ page }) => {
  test.skip(!existsSync(`${FIXTURE_DIR}/victory.y4m`), 'needs ffmpeg + internet to build the fake camera video');
  test.setTimeout(150_000);
  await startApp(page);
  await expect(page.getByTestId('camera-pill')).toHaveAttribute('data-status', 'live');

  // the hand model loads (CPU fallback in headless browsers) and the hand is found
  await expect(page.getByTestId('camera-pill')).toHaveAttribute('data-hands', '1', { timeout: 90_000 });

  // PEACE is mapped to pad 5 (right hand) / pad 11 (left hand) in MEMES mode
  const peaceHits = async () => (await hits(page, 4)) + (await hits(page, 10));
  await expect.poll(peaceHits, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/gesture-stage.png` });

  // holding the pose never re-triggers (no machine-gun)
  await page.waitForTimeout(3000);
  expect(await peaceHits()).toBe(1);

  // live gesture is visible in diagnostics
  await page.getByTestId('open-diagnostics').click();
  const right = await page.getByTestId('diag-gesture-right').textContent();
  const left = await page.getByTestId('diag-gesture-left').textContent();
  expect(`${right} ${left}`).toContain('✌️');
  await page.getByTestId('drawer-close').click();

  // learn gesture: assign the held ✌️ to pad 1
  await page.getByTestId('pad-0').click({ button: 'right' });
  await expect(page.getByTestId('pad-editor')).toBeVisible();
  await page.getByTestId('learn-gesture').click();
  await expect(page.locator('.toast.success')).toContainText('✌️', { timeout: 10_000 });
  await expect(page.getByTestId('pad-0').locator('.pad-gesture')).toContainText('✌️');
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/gesture-learned.png` });
});
