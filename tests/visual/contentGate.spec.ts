import { expect, test } from '@playwright/test';

/**
 * The mature-content warning and the reduced-gore choice cover every mode (#183): a fresh player who opens any
 * `?mode=` link sees the warning before the lab starts, and accepting once, with reduced gore on, carries to
 * every other mode. No screenshots, so these run in seconds.
 */
const MODES = ['bullet', 'artillery', 'missile', 'explosion', 'armor'] as const;

for (const mode of MODES) {
  test(`the content warning stops ${mode} until it is accepted`, async ({ page }) => {
    await page.goto(`./?mode=${mode}`);
    await expect(page.locator('.content-warning')).toBeVisible();
    await expect(page.locator('.content-warning .reduced-gore')).toBeVisible();
    // Nothing of the lab has started behind it: no controls and no ready flag.
    await expect(page.locator('.fire, .armor-play')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.dataset.ready)).toBeUndefined();
  });
}

test('accepting once with reduced gore is remembered by every mode', async ({ page }) => {
  // Low quality keeps the scene starts cheap; nothing here looks at a frame.
  await page.addInitScript(() => localStorage.setItem('bullettime.quality', 'low'));
  await page.goto('./?mode=bullet');
  await page.locator('.content-warning .reduced-gore').check();
  await page.locator('.content-warning .continue').click();
  await expect(page.locator('.content-warning')).toHaveCount(0);
  expect(await page.evaluate(() => ({ accepted: localStorage.getItem('bullettime.contentWarningAccepted'), reduced: localStorage.getItem('bullettime.reducedGore') }))).toEqual({
    accepted: '1',
    reduced: '1',
  });
  for (const mode of MODES.filter((m) => m !== 'bullet')) {
    await page.goto(`./?mode=${mode}`);
    // The mode has started (its class is on the body) and the warning never came back.
    await page.waitForFunction((m) => document.body.classList.contains(`mode-${m}`), mode, { timeout: 120_000 });
    await expect(page.locator('.content-warning')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('bullettime.reducedGore'))).toBe('1');
  }
});
