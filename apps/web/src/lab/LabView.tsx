import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { springbackDeg, type Vec2 } from '@paperfold/kernel';
import { FoldLine, PaperMesh, type PaperLook, Studio } from '@paperfold/render';
import { buildFrame, type FoldTransition, type SkinFrame, skinParamsFor } from '@paperfold/skin';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MOUSE, NeutralToneMapping, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { kernel } from '../kernel/client.ts';
import type { LabScene } from '../kernel/api.ts';
import { PRESETS } from '../presets.ts';
import { strings } from '../strings.en.ts';
import { useStore } from '../store.ts';

/** ?shadows=0 turns shadows off (slow devices, screenshot tests). */
const SHADOWS = new URLSearchParams(location.search).get('shadows') !== '0';

const BINS = 256;

/** Sharpness along the fold line, binned over u in [-span, span]. */
class SharpnessBins {
  readonly values = new Float32Array(BINS);
  readonly span: number;
  constructor(span: number) {
    this.span = span;
  }
  index(u: number): number {
    return Math.max(0, Math.min(BINS - 1, Math.floor(((u + this.span) / (2 * this.span)) * BINS)));
  }
  at = (u: number): number => {
    // Linear between bin centers, so the bend changes smoothly along the fold.
    const f = ((u + this.span) / (2 * this.span)) * BINS - 0.5;
    const i = Math.max(0, Math.min(BINS - 1, Math.floor(f)));
    const j = Math.min(BINS - 1, i + 1);
    const t = Math.max(0, Math.min(1, f - i));
    return this.values[i]! * (1 - t) + this.values[j]! * t;
  };
  raise(u0: number, u1: number, amount: number): void {
    const a = this.index(Math.min(u0, u1));
    const b = this.index(Math.max(u0, u1));
    for (let i = a; i <= b; i++) this.values[i] = Math.min(1, this.values[i]! + amount);
    this.smooth();
  }
  /** Paper is stiff: a pressed spot sharpens its neighbors a little too (about 5 mm). */
  private smooth(): void {
    const radius = Math.max(1, Math.round((5 / (2 * this.span)) * BINS));
    const src = Float32Array.from(this.values);
    for (let i = 0; i < BINS; i++) {
      let sum = 0;
      let w = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = i + k;
        if (j < 0 || j >= BINS) continue;
        const wk = radius + 1 - Math.abs(k);
        sum += src[j]! * wk;
        w += wk;
      }
      this.values[i] = Math.max(src[i]! * 0.7, sum / w);
    }
  }
  mean(lo: number, hi: number): number {
    const a = this.index(lo);
    const b = this.index(hi);
    let s = 0;
    for (let i = a; i <= b; i++) s += this.values[i]!;
    return s / Math.max(1, b - a + 1);
  }
}

interface LabModel {
  scene: LabScene | null;
  bins: SharpnessBins;
  theta: number;
  target: number;
  dirty: boolean;
}

function LabPaper({ model, look, fibers }: { model: React.RefObject<LabModel>; look: PaperLook; fibers: { count: number; length: number } }) {
  const paperMode = useStore((s) => s.paperMode);
  const [frame, setFrame] = useState<SkinFrame | null>(null);
  useFrame((_, dt) => {
    const m = model.current;
    if (!m.scene || m.scene.transition.kind !== 'fold') return;
    // Ease toward the target angle (springback when let go).
    const diff = m.target - m.theta;
    if (Math.abs(diff) > 1e-4) {
      m.theta += diff * Math.min(1, dt * 9);
      m.dirty = true;
    }
    if (!m.dirty) return;
    m.dirty = false;
    const params = skinParamsFor(m.scene.after.paper, paperMode);
    setFrame(
      buildFrame(m.scene.after, params, {
        before: m.scene.before,
        transition: m.scene.transition as FoldTransition,
        theta: m.theta,
        sharpnessAt: m.bins.at,
      }),
    );
  });
  useEffect(() => {
    model.current.dirty = true;
  }, [paperMode, model]);
  if (!frame) return null;
  return <PaperMesh frame={frame} look={look} fibers={fibers} />;
}

/** Stroke along the fold to crease it: only where you pass gets sharp. */
function LabInput({ model, onStroke }: { model: React.RefObject<LabModel>; onStroke: () => void }) {
  const { gl, camera } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const ray = new Raycaster();
    const ndc = new Vector2();
    const hit = new Vector3();
    const plane = new Plane(new Vector3(0, 1, 0), -1);
    const toPlane = (ev: PointerEvent): Vec2 | null => {
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hit) ? [hit.x, -hit.z] : null;
    };
    let last: { u: number; t: number; x: number; y: number } | null = null;
    const local = (q: Vec2) => {
      const tr = model.current.scene?.transition;
      if (!tr || tr.kind !== 'fold') return null;
      const l = tr.line;
      const rx = q[0] - l.p[0];
      const ry = q[1] - l.p[1];
      return { u: rx * l.d[0] + ry * l.d[1], x: -rx * l.d[1] + ry * l.d[0] };
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const q = toPlane(ev);
      const lc = q && local(q);
      if (!lc || Math.abs(lc.x) > 30) return;
      ev.stopImmediatePropagation();
      el.setPointerCapture(ev.pointerId);
      last = { u: lc.u, t: performance.now(), x: ev.clientX, y: ev.clientY };
      el.style.cursor = 'grabbing';
    };
    const onMove = (ev: PointerEvent) => {
      if (!last) return;
      const q = toPlane(ev);
      const lc = q && local(q);
      if (!lc) return;
      const now = performance.now();
      const px = Math.hypot(ev.clientX - last.x, ev.clientY - last.y);
      const speed = px / Math.max(1, now - last.t);
      // Slower strokes and more pressure crease harder.
      const pressure = ev.pressure > 0 && ev.pointerType === 'pen' ? ev.pressure : 0.5;
      const amount = 0.22 * (0.6 + pressure) * Math.max(0.4, Math.min(1.4, 1.4 - speed * 0.6));
      model.current.bins.raise(last.u, lc.u, amount);
      model.current.dirty = true;
      last = { u: lc.u, t: now, x: ev.clientX, y: ev.clientY };
    };
    const onUp = (ev: PointerEvent) => {
      if (!last) return;
      last = null;
      el.style.cursor = '';
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      onStroke();
    };
    el.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, model, onStroke]);
  return null;
}

export function LabView() {
  const dark = useStore((s) => s.theme === 'dark');
  const preset = useStore((s) => s.preset);
  const frontColor = useStore((s) => s.frontColor);
  const backColor = useStore((s) => s.backColor);
  const sizeMm = useStore((s) => s.sizeMm);
  const p = PRESETS[preset];
  const [layers, setLayers] = useState<1 | 2 | 4 | 8>(2);
  const [diagonal, setDiagonal] = useState(false);
  const [thickness, setThickness] = useState(p.sheet.thicknessMm);
  const [angleDeg, setAngleDeg] = useState(150);
  const [holding, setHolding] = useState(false);
  const model = useRef<LabModel>({ scene: null, bins: new SharpnessBins(sizeMm), theta: 0, target: 0, dirty: true });
  const [scene, setScene] = useState<LabScene | null>(null);

  useEffect(() => setThickness(p.sheet.thicknessMm), [p]);

  useEffect(() => {
    let cancelled = false;
    void kernel()
      .labScene(
        { sizeMm, thicknessMm: thickness, stiffness: p.sheet.stiffness, frontColor, backColor },
        layers,
        diagonal ? 45 : 0,
      )
      .then((s) => {
        if (cancelled) return;
        model.current.scene = s;
        model.current.dirty = true;
        setScene(s);
      });
    return () => {
      cancelled = true;
    };
  }, [layers, diagonal, thickness, sizeMm, p, frontColor, backColor]);

  // Where the paper settles when you let go: creased parts hold, soft parts spring back.
  const restFor = (deg: number) => {
    const m = model.current;
    const tr = m.scene?.transition;
    let sharp = 0;
    if (tr && tr.kind === 'fold') sharp = m.bins.mean(-sizeMm / 2, sizeMm / 2);
    const spring = (springbackDeg(p.sheet.stiffness) * (1 - sharp) * deg) / 180;
    return (Math.max(0, deg - spring) * Math.PI) / 180;
  };
  const settle = () => {
    model.current.target = restFor(angleDeg);
  };
  useEffect(() => {
    if (!holding) model.current.target = restFor(angleDeg);
    else model.current.target = (angleDeg * Math.PI) / 180;
    // restFor reads refs; recompute when inputs change.
    }, [angleDeg, holding, scene]);

  const look: PaperLook = useMemo(() => ({ ...p.look, front: frontColor, back: backColor }), [p, frontColor, backColor]);
  const tr = scene?.transition.kind === 'fold' ? scene.transition : null;
  const hinge = useMemo((): [Vec2, Vec2] | null => {
    if (!tr) return null;
    const l = tr.line;
    const r = sizeMm / 2;
    return [
      [l.p[0] - l.d[0] * r, l.p[1] - l.d[1] * r],
      [l.p[0] + l.d[0] * r, l.p[1] + l.d[1] * r],
    ];
  }, [tr, sizeMm]);

  return (
    <div className="lab">
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ position: [-40, 190, 210], fov: 35, near: 2, far: 4000 }}
        gl={{ antialias: true, toneMapping: NeutralToneMapping, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={[dark ? '#141917' : '#dfe4e0']} />
        <Studio dark={dark} shadows={SHADOWS} />
        <LabPaper model={model} look={look} fibers={p.fibers} />
        {hinge && angleDeg < 1 && <FoldLine a={hinge[0]} b={hinge[1]} height={0.6} kind="valley" color={dark ? '#8fc3ff' : '#1f5fae'} />}
        <LabInput model={model} onStroke={settle} />
        <OrbitControls
          key={layers}
          makeDefault
          enableDamping
          target={tr ? [tr.line.p[0], 0, -tr.line.p[1]] : [0, 0, 0]}
          mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }}
        />
      </Canvas>
      <section className="lab-panel" aria-label={strings.labTitle}>
        <h2>{strings.labTitle}</h2>
        <p className="muted">{strings.labIntro}</p>
        <label className="field">
          <span>{strings.labLayers}</span>
          <span className="segmented" role="radiogroup">
            {([1, 2, 4, 8] as const).map((n) => (
              <button key={n} role="radio" aria-checked={layers === n} className={layers === n ? 'on' : ''} onClick={() => setLayers(n)}>
                {n}
              </button>
            ))}
          </span>
        </label>
        <label className="field">
          <span>{strings.labDirection}</span>
          <span className="segmented" role="radiogroup">
            <button role="radio" aria-checked={!diagonal} className={!diagonal ? 'on' : ''} onClick={() => setDiagonal(false)}>
              Straight
            </button>
            <button role="radio" aria-checked={diagonal} className={diagonal ? 'on' : ''} onClick={() => setDiagonal(true)}>
              Diagonal
            </button>
          </span>
        </label>
        <label className="field">
          <span>
            {strings.labAngle} <output>{angleDeg}°</output>
          </span>
          <input
            type="range"
            min={0}
            max={180}
            value={angleDeg}
            onChange={(e) => setAngleDeg(Number(e.target.value))}
            onPointerDown={() => setHolding(true)}
            onPointerUp={() => setHolding(false)}
            onKeyDown={() => setHolding(true)}
            onKeyUp={() => setHolding(false)}
          />
        </label>
        <label className="field">
          <span>
            {strings.labThickness} <output>{thickness.toFixed(2)} mm</output>
          </span>
          <input type="range" min={0.04} max={0.6} step={0.01} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} />
        </label>
        <div className="row">
          <button
            onClick={() => {
              model.current.bins.values.fill(0);
              model.current.dirty = true;
              settle();
            }}
          >
            {strings.labSoften}
          </button>
        </div>
      </section>
    </div>
  );
}
