import { expect, test } from '@playwright/test';
import { FIXTURE_DIR } from './paths';
import { startApp } from './helpers';

test('phone layout: start, tap pads, open the pad editor', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/mobile-start.png` });
  await startApp(page);
  await expect(page.locator('.pads > .pad')).toHaveCount(16);
  await page.getByTestId('pad-2').tap();
  await expect(page.getByTestId('pad-2')).toHaveAttribute('data-result', 'played');
  // every pad is visible without scrolling
  const box = await page.getByTestId('pad-15').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/mobile-main.png` });
  // a long touch on a pad plays it, it must NOT open the editor (gate pads are held)
  await page.getByTestId('pad-3').dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, isPrimary: true, pointerId: 7 });
  await page.waitForTimeout(800);
  await page.getByTestId('pad-3').dispatchEvent('pointerup', { pointerType: 'touch', button: 0, isPrimary: true, pointerId: 7 });
  await expect(page.getByTestId('drawer')).toHaveCount(0);
  // ✏️ edit mode: tapping a pad opens its editor instead of playing it
  const hitsBefore = Number(await page.getByTestId('pad-2').getAttribute('data-hits'));
  await page.getByTestId('edit-mode').tap();
  await page.getByTestId('pad-2').tap();
  await expect(page.getByTestId('pad-editor')).toBeVisible();
  expect(Number(await page.getByTestId('pad-2').getAttribute('data-hits'))).toBe(hitsBefore);
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/mobile-editor.png` });
  // closing the editor leaves edit mode: pads play again
  await page.getByTestId('drawer-close').tap();
  await expect(page.getByTestId('edit-mode')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('pad-2').tap();
  await expect.poll(async () => Number(await page.getByTestId('pad-2').getAttribute('data-hits'))).toBe(hitsBefore + 1);
});

for (const [name, width, height] of [
  ['small-phone', 375, 667],
  ['landscape-phone', 844, 390],
] as const) {
  test(`${name} (${width}×${height}): every pad and the camera fit on screen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await startApp(page);
    for (const id of ['pad-0', 'pad-15', 'stage', 'test-audio']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.x, id).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, id).toBeLessThanOrEqual(width + 1);
      expect(box!.y + box!.height, id).toBeLessThanOrEqual(height + 1);
    }
    // pads stay big enough to hit with a thumb
    const pad = await page.getByTestId('pad-5').boundingBox();
    expect(pad!.width).toBeGreaterThanOrEqual(44);
    expect(pad!.height).toBeGreaterThanOrEqual(40);
    await page.getByTestId('pad-5').tap();
    await expect(page.getByTestId('pad-5')).toHaveAttribute('data-result', 'played');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${FIXTURE_DIR}/screens/${name}.png` });
  });
}
