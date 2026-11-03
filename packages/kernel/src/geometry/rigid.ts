import type { Line2 } from './line.ts';
import type { Vec2, Vec3 } from './vec.ts';

/** Row-major 3x3 matrix. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/**
 * Rigid transform from material space to world space: x_world = R · (u, v, w) + t,
 * where material points are (u, v, 0) and +w is the front side of the sheet.
 *
 * World space: the table is the XZ plane, +Y is up (brief, section 3).
 */
export interface Rigid3 {
  readonly r: Mat3;
  readonly t: Vec3;
}

export const IDENTITY: Rigid3 = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    }
  }
  return out as unknown as Mat3;
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** a ∘ b: apply b first, then a. */
export function compose(a: Rigid3, b: Rigid3): Rigid3 {
  const bt = mulVec(a.r, b.t);
  return { r: mulMat(a.r, b.r), t: [bt[0] + a.t[0], bt[1] + a.t[1], bt[2] + a.t[2]] };
}

export function apply(tr: Rigid3, p: Vec3): Vec3 {
  const q = mulVec(tr.r, p);
  return [q[0] + tr.t[0], q[1] + tr.t[1], q[2] + tr.t[2]];
}

export function applyMaterial(tr: Rigid3, uv: Vec2): Vec3 {
  return apply(tr, [uv[0], uv[1], 0]);
}

/**
 * Half-turn about an axis through `p` with unit direction `d`: R = 2 d dᵀ − I.
 * A 180° rotation is its own inverse and has the same matrix for +180° and −180°.
 */
export function halfTurn(p: Vec3, d: Vec3): Rigid3 {
  const r: Mat3 = [
    2 * d[0] * d[0] - 1, 2 * d[0] * d[1], 2 * d[0] * d[2],
    2 * d[1] * d[0], 2 * d[1] * d[1] - 1, 2 * d[1] * d[2],
    2 * d[2] * d[0], 2 * d[2] * d[1], 2 * d[2] * d[2] - 1,
  ];
  const rp = mulVec(r, p);
  return { r, t: [p[0] - rp[0], p[1] - rp[1], p[2] - rp[2]] };
}

/** Rotation by `angle` radians about the axis through p with unit direction d (Rodrigues). */
export function rotationAbout(p: Vec3, d: Vec3, angle: number): Rigid3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  const [x, y, z] = d;
  const r: Mat3 = [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k,
  ];
  const rp = mulVec(r, p);
  return { r, t: [p[0] - rp[0], p[1] - rp[1], p[2] - rp[2]] };
}

// ---------------------------------------------------------------------------
// The table plane.
//
// For flat states we work in 2D "plane" coordinates (x, y) with world X = x,
// world Z = −y. Looking down from +Y with screen-up = −Z, plane coordinates
// are screen coordinates (y up), and a material frame with det = +1 has its
// front side facing up.
// ---------------------------------------------------------------------------

export const planeToWorld = (q: Vec2, height = 0): Vec3 => [q[0], height, -q[1]];
export const worldToPlane = (p: Vec3): Vec2 => [p[0], -p[2]];
export const planeDirToWorld = (d: Vec2): Vec3 => [d[0], 0, -d[1]];

/** 2D isometry of the table plane: plane = [[a, b], [c, d]] · (u, v) + (tx, ty). */
export interface PlaneIso {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export function applyPlaneIso(m: PlaneIso, uv: Vec2): Vec2 {
  return [m.a * uv[0] + m.b * uv[1] + m.tx, m.c * uv[0] + m.d * uv[1] + m.ty];
}

export function invertPlaneIso(m: PlaneIso): PlaneIso {
  // Orthogonal: inverse of A is Aᵀ.
  return {
    a: m.a,
    b: m.c,
    c: m.b,
    d: m.d,
    tx: -(m.a * m.tx + m.c * m.ty),
    ty: -(m.b * m.tx + m.d * m.ty),
  };
}

export function planeIsoDet(m: PlaneIso): number {
  return m.a * m.d - m.b * m.c;
}

export function rigidFromPlaneIso(m: PlaneIso): Rigid3 {
  const det = planeIsoDet(m) >= 0 ? 1 : -1;
  return {
    r: [m.a, m.b, 0, 0, 0, det, -m.c, -m.d, 0],
    t: [m.tx, 0, -m.ty],
  };
}

/** True when the transform lays the material flat on the table plane (within tol). */
export function isFlat(tr: Rigid3, lenTol: number): boolean {
  const r = tr.r;
  const e = 1e-9;
  return (
    Math.abs(r[3]) <= e &&
    Math.abs(r[4]) <= e &&
    Math.abs(r[2]) <= e &&
    Math.abs(r[8]) <= e &&
    Math.abs(Math.abs(r[5]) - 1) <= e &&
    Math.abs(tr.t[1]) <= lenTol
  );
}

/** Extract the plane isometry of a flat transform. Callers check isFlat first. */
export function planeIsoOf(tr: Rigid3): PlaneIso {
  const r = tr.r;
  return { a: r[0], b: r[1], c: -r[6], d: -r[7], tx: tr.t[0], ty: -tr.t[2] };
}

/** +1 when the material front faces world +Y. */
export function frontUp(tr: Rigid3): boolean {
  return tr.r[5] > 0;
}

/** World half-turn about a line lying in the table plane (a flat fold by 180°). */
export function halfTurnAboutPlaneLine(l: Line2): Rigid3 {
  return halfTurn(planeToWorld(l.p), planeDirToWorld(l.d));
}

/** Material-space half-turn about the line through material points a, b (in the w = 0 plane). */
export function materialHalfTurn(a: Vec2, b: Vec2): Rigid3 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  return halfTurn([a[0], a[1], 0], [dx / l, dy / l, 0]);
}

/** Largest deviation of RᵀR from I: zero for an exact rotation. */
export function orthonormalityError(tr: Rigid3): number {
  const r = tr.r;
  let err = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const v = r[i]! * r[j]! + r[3 + i]! * r[3 + j]! + r[6 + i]! * r[6 + j]!;
      err = Math.max(err, Math.abs(v - (i === j ? 1 : 0)));
    }
  }
  return err;
}

export function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}
