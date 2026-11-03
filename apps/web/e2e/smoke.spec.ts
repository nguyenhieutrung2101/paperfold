import { expect, type Page, test } from '@playwright/test';

type Pt = readonly [number, number];

/** Screen position of a table-plane point (mm), through the dev-only projection hook. */
async function screen(page: Page, p: Pt): Promise<Pt> {
  const s = await page.evaluate(
    (q) => (window as unknown as { __paperfold: { toScreen(p: Pt): { x: number; y: number } } }).__paperfold.toScreen(q),
    p,
  );
  return [s.x, s.y];
}

/** Press, move in small steps like a hand would, and optionally do something before letting go. */
async function drag(page: Page, from: Pt, to: Pt, beforeRelease?: () => Promise<void>) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 12, from[1] + ((to[1] - from[1]) * i) / 12);
  }
  if (beforeRelease) await beforeRelease();
  await page.mouse.up();
}

/** Drag between table-plane points (mm). */
async function dragMm(page: Page, from: Pt, to: Pt, beforeRelease?: () => Promise<void>) {
  await drag(page, await screen(page, from), await screen(page, to), beforeRelease);
}

const steps = (page: Page) => page.locator('.steps li');

test.beforeEach(async ({ page }) => {
  await page.goto('/?shadows=0');
  await page.waitForSelector('html[data-ready="true"]');
  await page.waitForFunction(() => 'toScreen' in ((window as unknown as { __paperfold?: object }).__paperfold ?? {}));
});

test('fold a corner to a corner, crease it, undo and redo', async ({ page }) => {
  await expect(page.getByText('A fresh square. Grab a corner.')).toBeVisible();
  await expect(steps(page)).toHaveCount(1);

  // Bottom-right corner onto the top-left corner (150 mm sheet centred on the origin).
  await dragMm(page, [75, -75], [-75, 75]);
  await expect(steps(page)).toHaveCount(2);
  await expect(page.getByText('Run your finger along the fold to crease it.')).toBeVisible();

  await page.keyboard.press('c');
  await expect(steps(page)).toHaveCount(3);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.step[aria-current="step"]')).toHaveText('1');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.step[aria-current="step"]')).toHaveText('2');
});

test('a top layer joined at the spine: the chip offers both layers', async ({ page }) => {
  // Book fold: right edge over to the left edge.
  await dragMm(page, [75, 0], [-75, 0]);
  await expect(steps(page)).toHaveCount(2);
  // Grab near the spine, where the top layer is joined to the one under it.
  await dragMm(page, [-15, 3], [-50, 3], async () => {
    await expect(page.locator('.chip')).toContainText('Fold both layers');
  });
  await expect(steps(page)).toHaveCount(3);
});

test('the paper resists a held fold, and explains on the second try', async ({ page }) => {
  // Hold the paper down where the flap would have to move, then try to fold it.
  await page.keyboard.down(' ');
  const hold = await screen(page, [30, -10]);
  await page.mouse.click(hold[0], hold[1]);
  // Space is still down: a press that moves folds, around the pin.
  await dragMm(page, [75, -75], [-75, 75]);
  await expect(steps(page)).toHaveCount(1);
  await expect(page.getByText('That would tear the paper.')).toHaveCount(0);
  await dragMm(page, [75, -75], [-75, 75]);
  await expect(page.getByText('That would tear the paper.')).toBeVisible();
  await expect(steps(page)).toHaveCount(1);
  await page.keyboard.up(' ');
});

test('inside reverse fold: named while dragging, Tab tries another way, steps replay it', async ({ page }) => {
  // Diagonal fold, creased: a two-layer triangle whose spine runs corner to corner.
  await dragMm(page, [75, -75], [-75, 75]);
  await expect(steps(page)).toHaveCount(2);
  await page.keyboard.press('c');
  await expect(steps(page)).toHaveCount(3);

  // Push the tip at (75, 75) in between the layers.
  const chip = page.locator('.chip');
  await dragMm(page, [66, 73], [40, 68], async () => {
    await expect(chip).toContainText('Inside reverse fold');
    await page.keyboard.press('Tab');
    await expect(chip).toContainText('Fold both layers');
    await page.keyboard.press('Tab');
    await expect(chip).toContainText('Inside reverse fold');
  });
  await expect(steps(page)).toHaveCount(4);

  await page.getByRole('tab', { name: 'Steps' }).click();
  const list = page.getByRole('complementary', { name: 'All steps as text' });
  await expect(list.getByText('2 steps.', { exact: false })).toBeVisible();
  await expect(list.getByText('Push the tip inside.')).toBeVisible();
  await expect(page.locator('.warn')).toHaveCount(0);

  await list.getByText('Push the tip inside.').click();
  await expect(page.locator('.steps-bar')).toContainText('Inside reverse fold');
  await expect(page.locator('.steps-bar')).toContainText('Step 2 of 2');
});

test('fold with the keyboard', async ({ page }) => {
  await page.keyboard.press('k');
  await expect(page.getByRole('status').getByText(/Pick what to move/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').getByText(/Pick where it goes/)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(steps(page)).toHaveCount(2);
});

test('the bend lab renders', async ({ page }) => {
  await page.getByRole('tab', { name: 'Bend lab' }).click();
  await expect(page.getByRole('heading', { name: 'Bend lab' })).toBeVisible();
  await expect(page.locator('.lab canvas')).toBeVisible();
});
