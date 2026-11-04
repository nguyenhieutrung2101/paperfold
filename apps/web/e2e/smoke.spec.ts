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

test('a sloppy corner drag still folds exactly in half', async ({ page }) => {
  // Bottom-right corner let go about 11 mm short of the top-left corner.
  await dragMm(page, [74, -74], [-67, 67], async () => {
    await expect(page.locator('.strip')).toContainText('In half');
  });
  await expect(steps(page)).toHaveCount(2);
  // The new crease runs exactly corner to corner (material corners (0,0) and (150,150)).
  const exact = await page.evaluate(() => {
    const snap = (window as unknown as { __paperfold: { useStore: { getState(): { view: { snapshot: { creases: Array<{ a: number[]; b: number[]; left: number | null; right: number | null }> } } } } } }).__paperfold.useStore.getState().view.snapshot;
    const near = (p: number[], q: number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) < 1e-6;
    return snap.creases.some((c) => c.left !== null && c.right !== null && ((near(c.a, [0, 0]) && near(c.b, [150, 150])) || (near(c.a, [150, 150]) && near(c.b, [0, 0]))));
  });
  expect(exact).toBe(true);
});

test('a blintz: corners pressed a little inside all meet exactly in the middle', async ({ page }) => {
  const corners: Array<readonly [number, number]> = [[75, -75], [75, 75], [-75, 75], [-75, -75]];
  for (const [i, c] of corners.entries()) {
    // About 6 mm inside the corner, let go about 4 mm from the middle.
    await dragMm(page, [c[0] - Math.sign(c[0]) * 4.2, c[1] - Math.sign(c[1]) * 4.2], [3, -2.5], async () => {
      await expect(page.locator('.strip')).toContainText('To the center');
    });
    await expect(steps(page)).toHaveCount(i + 2);
  }
  // Every corner of the sheet now lies exactly on the middle.
  const off = await page.evaluate(() => {
    type F = { material: number[][]; placement: { r: number[]; t: number[] } };
    const snap = (window as unknown as { __paperfold: { useStore: { getState(): { view: { snapshot: { faces: F[] } } } } } }).__paperfold.useStore.getState().view.snapshot;
    let worst = 0;
    for (const f of snap.faces) {
      for (const m of f.material) {
        const isCorner = (m[0] === 0 || m[0] === 150) && (m[1] === 0 || m[1] === 150);
        if (!isCorner) continue;
        const x = f.placement.r[0]! * m[0]! + f.placement.r[1]! * m[1]! + f.placement.t[0]!;
        const z = f.placement.r[6]! * m[0]! + f.placement.r[7]! * m[1]! + f.placement.t[2]!;
        worst = Math.max(worst, Math.hypot(x, z));
      }
    }
    return worst;
  });
  expect(off).toBeLessThan(1e-6);
});

test('R relaxes the folds, and again presses them flat', async ({ page }) => {
  await dragMm(page, [75, -75], [-75, 75]);
  await expect(steps(page)).toHaveCount(2);
  const relaxed = page.getByLabel('Relaxed folds');
  await expect(relaxed).not.toBeChecked();
  await page.keyboard.press('r');
  await expect(relaxed).toBeChecked();
  await page.keyboard.press('r');
  await expect(relaxed).not.toBeChecked();
});

test('a top layer joined at the spine: the strip offers both layers', async ({ page }) => {
  // Book fold: right edge over to the left edge.
  await dragMm(page, [75, 0], [-75, 0]);
  await expect(steps(page)).toHaveCount(2);
  // Grab near the spine, where the top layer is joined to the one under it.
  await dragMm(page, [-15, 3], [-50, 3], async () => {
    await expect(page.locator('.strip')).toContainText('Fold both layers');
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

/** Diagonal fold, creased: a two-layer triangle whose spine runs from (-75, -75) to (75, 75). */
async function triangle(page: Page) {
  await dragMm(page, [75, -75], [-75, 75]);
  await expect(steps(page)).toHaveCount(2);
  await page.keyboard.press('c');
  await expect(steps(page)).toHaveCount(3);
}

const lastStep = (page: Page) => page.locator('.steps li button').last();

test('a corner on the folded edge folds over; it does not crease', async ({ page }) => {
  await triangle(page);
  // One end of the spine onto the other: fold the triangle in half.
  await dragMm(page, [-74, -74.5], [74, 74]);
  await expect(steps(page)).toHaveCount(4);
  await expect(lastStep(page)).toHaveAttribute('aria-label', '3. Valley fold');
});

test('hover shows what you would pick up; scroll while pressing takes more layers', async ({ page }) => {
  await triangle(page);
  // The open corner: two loose layers.
  const c = await screen(page, [-73.5, 73.5]);
  await page.mouse.move(c[0], c[1], { steps: 4 });
  const badge = page.locator('.hover-badge');
  await expect(badge).toContainText('Top layer');
  await page.mouse.down();
  await page.mouse.wheel(0, 120);
  await expect(badge).toContainText('Both layers');
  const to = await screen(page, [-40, 40]);
  for (let i = 1; i <= 12; i++) await page.mouse.move(c[0] + ((to[0] - c[0]) * i) / 12, c[1] + ((to[1] - c[1]) * i) / 12);
  await expect(page.locator('.strip')).toContainText('Fold both layers');
  await page.mouse.up();
  await expect(steps(page)).toHaveCount(4);
});

test('push a folded edge in: an inside reverse fold, no precrease; 1–2 switch; steps replay it', async ({ page }) => {
  await triangle(page);
  // Hovering the folded edge says what it does.
  const e = await screen(page, [0.6, -0.6]);
  await page.mouse.move(e[0], e[1], { steps: 4 });
  await expect(page.locator('.hover-badge')).toContainText('Push in: tuck the tip inside');

  // The spine point (55, 55) goes to (35, 65): the line through (30, 30) along (1, 2).
  const strip = page.locator('.strip');
  await dragMm(page, [55.4, 54.6], [35, 65], async () => {
    await expect(strip).toContainText('Inside reverse fold');
    await page.keyboard.press('2');
    await expect(strip).toContainText('Fold both layers');
    await page.keyboard.press('1');
    await expect(strip).toContainText('Inside reverse fold');
  });
  await expect(steps(page)).toHaveCount(4);
  await expect(lastStep(page)).toHaveAttribute('aria-label', '3. Inside reverse fold');

  await page.getByRole('tab', { name: 'Steps' }).click();
  const list = page.getByRole('complementary', { name: 'All steps as text' });
  await expect(list.getByText('2 steps.', { exact: false })).toBeVisible();
  await expect(list.getByText('Push the tip inside.')).toBeVisible();
  await expect(page.locator('.warn')).toHaveCount(0);
  await list.getByText('Push the tip inside.').click();
  await expect(page.locator('.steps-bar')).toContainText('Inside reverse fold');
  await expect(page.locator('.steps-bar')).toContainText('Step 2 of 2');
});

test('pull a folded edge out: an outside reverse fold', async ({ page }) => {
  await triangle(page);
  // The spine point (55, 55) goes outside, to (15.04, -2.04): the tip wraps around the outside.
  await dragMm(page, [55.4, 54.6], [15.04, -2.04], async () => {
    await expect(page.locator('.strip')).toContainText('Outside reverse fold');
  });
  await expect(steps(page)).toHaveCount(4);
  await expect(lastStep(page)).toHaveAttribute('aria-label', '3. Outside reverse fold');
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
