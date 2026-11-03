import { describe, expect, it } from 'vitest';
import { bendPoint, creep } from '../src/index.ts';

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('bendPoint', () => {
  const layer = { h0: 0.04, h1: 0.12, sigma: 1 as const };

  it('starts flat and ends flat on the other side at the target height', () => {
    const [x0, y0] = bendPoint(30, layer, 0, 3);
    expect(x0).toBeCloseTo(30, 12);
    expect(y0).toBeCloseTo(0.04, 12);
    const [x, y] = bendPoint(30, layer, Math.PI, 0);
    expect(x).toBeCloseTo(-30, 9);
    expect(y).toBeCloseTo(0.12, 9);
  });

  it('is developable: arc length along the paper equals material length', () => {
    for (const theta of [0.3, 1.2, 2.5, Math.PI]) {
      const rho = 4;
      const n = 400;
      const xMax = rho * theta + 20;
      let length = 0;
      let prev = bendPoint(0, { ...layer, h1: layer.h0 }, theta, rho);
      for (let i = 1; i <= n; i++) {
        const p = bendPoint((xMax * i) / n, { ...layer, h1: layer.h0 }, theta, rho);
        length += dist(p, prev);
        prev = p;
      }
      expect(length).toBeCloseTo(xMax, 3);
    }
  });

  it('lifts an uncreased fold by twice the soft radius and creeps the flap', () => {
    const rho = 4;
    const [x, y] = bendPoint(30, layer, Math.PI, rho);
    expect(y).toBeCloseTo(0.12 + 2 * rho, 9);
    expect(x).toBeCloseTo(-(30 - creep(Math.PI, rho)), 9);
  });

  it('is continuous where the arc meets the flat part', () => {
    const rho = 3;
    const theta = 2;
    const m = rho * theta;
    const a = bendPoint(m - 1e-9, layer, theta, rho);
    const b = bendPoint(m + 1e-9, layer, theta, rho);
    expect(dist(a, b)).toBeLessThan(1e-6);
  });

  it('wraps stacked layers on concentric arcs (r_i = r_0 + i·t)', () => {
    const t = 0.1;
    const rho = 1;
    // Two moving layers: the top one ends lowest of the moved stack.
    const top = { h0: 0.25, h1: 0.35, sigma: 1 as const };
    const under = { h0: 0.15, h1: 0.45, sigma: 1 as const };
    const theta = Math.PI / 2;
    // Both arcs share the center (0, (h0 + h1) / 2 + rho), one thickness apart in radius.
    const center: [number, number] = [0, 0.3 + rho];
    const rTop = dist(bendPoint(0.5, top, theta, rho), center);
    const rUnder = dist(bendPoint(0.5, under, theta, rho), center);
    expect(rTop).toBeCloseTo(0.05 + rho, 9);
    expect(rUnder - rTop).toBeCloseTo(t, 9);
  });

  it('mountain folds go down', () => {
    const m = { h0: 0.12, h1: 0.04, sigma: -1 as const };
    const [, y] = bendPoint(30, m, Math.PI / 2, 2);
    expect(y).toBeLessThan(0);
  });
});
