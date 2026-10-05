import { expect, test, type Page } from '@playwright/test';

/**
 * Visual regression screenshots (#243): one frame per shot, parked a fixed
 * time after first contact through a replay link (`?at=`), with every panel
 * hidden (`?clean`) and the wall clock frozen (`?still`), at Low quality so
 * no bloom or ambient occlusion noise gets in. A change that moves more than
 * 200 pixels fails the job (a clean run moves none); `npm run visual:update`
 * accepts it.
 */

/** Opens the app with the content warning accepted and Low quality, then waits for the scene to be ready. */
async function open(page: Page, query: string): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('bullettime.contentWarningAccepted', '1');
    localStorage.setItem('bullettime.quality', 'low');
    localStorage.setItem('bullettime.impactBeat', 'on');
  });
  await page.goto(`./?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 300_000 });
  await settle(page);
}

/** Lets a few frames render, so the parked frame and its effects are on screen. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let n = 0;
        const tick = () => (++n >= 6 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
  await page.waitForTimeout(1500);
}

const SHOTS: { name: string; query: string }[] = [
  { name: 'bullet-9mm-jhp-gel', query: 'mode=bullet&bullet=9mm-jhp&medium=gel10&at=1.2ms' },
  { name: 'bullet-308-sp-c35', query: 'mode=bullet&bullet=308-sp&medium=concrete-c35&at=300us' },
  { name: 'bullet-12ga-slug-steel', query: 'mode=bullet&bullet=12ga-slug&medium=steel-mild&thickness=0.006&at=150us' },
  { name: 'artillery-default', query: 'mode=artillery&at=300us' },
  { name: 'missile-default', query: 'mode=missile&at=1ms' },
  { name: 'explosion-default', query: 'mode=explosion&at=2ms' },
];

for (const shot of SHOTS) {
  test(shot.name, async ({ page }) => {
    await open(page, `${shot.query}&clean&still`);
    await expect(page).toHaveScreenshot(`${shot.name}.png`);
  });
}

/** The Armor lab: pick a family, fire, and park the scrubber; in the 2D section and the 3D view. */
const ARMOR: { family: string; at: number; view: '2d' | '3d' }[] = [
  { family: 'apfsds', at: 0.5, view: '2d' },
  { family: 'heat', at: 0.45, view: '2d' },
  { family: 'hesh', at: 0.9, view: '2d' },
  { family: 'apfsds', at: 0.5, view: '3d' },
];

for (const shot of ARMOR) {
  test(`armor-${shot.family}-${shot.view}`, async ({ page }) => {
    await open(page, 'mode=armor&still');
    await page.selectOption('#armor-family', shot.family);
    await page.click('.armor-fire');
    if (shot.view === '3d') await page.click('.armor-view [data-view="3d"]');
    await page.$eval(
      '.armor-scrub',
      (el, u) => {
        const input = el as HTMLInputElement;
        input.value = String(Math.round(u * 1000));
        input.dispatchEvent(new Event('input'));
      },
      shot.at,
    );
    await settle(page);
    await expect(page.locator('.armor-stage')).toHaveScreenshot(`armor-${shot.family}-${shot.view}.png`);
  });
}
