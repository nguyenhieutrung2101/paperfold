import { expect, type Page, test } from '@playwright/test';

/** Drag with intermediate moves, like a hand would. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 12, from[1] + ((to[1] - from[1]) * i) / 12);
  }
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?shadows=0');
  await page.waitForSelector('html[data-ready="true"]');
});

test('fold a corner to a corner, crease it, undo and redo', async ({ page }) => {
  await expect(page.getByText('A fresh square. Grab a corner.')).toBeVisible();
  const steps = page.locator('.steps li');
  await expect(steps).toHaveCount(1);

  // Bottom-right corner onto the top-left corner (default camera, 150 mm sheet).
  await drag(page, [920, 655], [400, 184]);
  await expect(steps).toHaveCount(2);
  await expect(page.getByText('Double-click the fold to crease it.')).toBeVisible();

  await page.keyboard.press('c');
  await expect(steps).toHaveCount(3);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.step[aria-current="step"]')).toHaveText('1');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.step[aria-current="step"]')).toHaveText('2');
});

test('a fold that would need more layers says so', async ({ page }) => {
  // Book fold: right edge over to the left edge.
  await drag(page, [905, 420], [368, 420]);
  await expect(page.locator('.steps li')).toHaveCount(2);
  // Top layer only, grabbed near the spine where it's joined to the layer under it.
  await drag(page, [600, 430], [450, 430]);
  await expect(page.getByText('Those layers are joined. Grab them all.')).toBeVisible();
  await expect(page.locator('.steps li')).toHaveCount(2);
});

test('the bend lab renders', async ({ page }) => {
  await page.getByRole('tab', { name: 'Bend lab' }).click();
  await expect(page.getByRole('heading', { name: 'Bend lab' })).toBeVisible();
  await expect(page.locator('.lab canvas')).toBeVisible();
});
