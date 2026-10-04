import { expect, test } from '@playwright/test';
import { FIXTURE_DIR } from './paths';
import { startApp } from './helpers';

test('phone layout: start, tap pads, open the pad editor', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/mobile-start.png` });
  await startApp(page);
  await expect(page.locator('[data-testid^="pad-"]')).toHaveCount(16);
  await page.getByTestId('pad-2').tap();
  await expect(page.getByTestId('pad-2')).toHaveAttribute('data-result', 'played');
  // every pad is visible without scrolling
  const box = await page.getByTestId('pad-15').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/mobile-main.png` });
  await page.getByTestId('pad-2').click({ button: 'right' });
  await expect(page.getByTestId('pad-editor')).toBeVisible();
  await page.screenshot({ path: `${FIXTURE_DIR}/screens/mobile-editor.png` });
});
