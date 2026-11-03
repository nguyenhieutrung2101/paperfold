import { leftNormal, planeIsoOf, applyPlaneIso, type Snapshot, type Vec2 } from '@paperfold/kernel';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { FoldArrow, FoldLine, Hand, type HandPoseName, PaperMesh, type PaperLook, PushArrow, SnapRing, Studio } from '@paperfold/render';
import { buildFrame, type MotionTransition, type SkinFrame, skinParamsFor, skinPoint } from '@paperfold/skin';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Group, Matrix4, MOUSE, NeutralToneMapping, Vector3 } from 'three';
import type { PlayerStep } from '../kernel/api.ts';
import { PRESETS } from '../presets.ts';
import { captionText, moveNames, strings } from '../strings.en.ts';
import { useStore } from '../store.ts';

const SHADOWS = new URLSearchParams(location.search).get('shadows') !== '0';
const STEP_SECONDS = 3.2;

/** Beats of one step (brief, section 7, "Hands"), as fractions of the step. */
const BEAT = { handsIn: 0.16, moveEnd: 0.56, pause: 0.66, creaseEnd: 0.84, unfoldEnd: 0.93 } as const;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const span = (p: number, a: number, b: number) => smooth((p - a) / (b - a));

interface HandView {
  readonly key: string;
  readonly pose: HandPoseName;
  readonly side: 'left' | 'right';
  readonly at: [number, number, number];
  readonly toward: [number, number];
  readonly opacity: number;
}

interface SceneFrame {
  readonly frame: SkinFrame;
  readonly hands: readonly HandView[];
  readonly symbols: number;
  readonly pulse: number;
  readonly lift: number;
  readonly matrix: Matrix4 | null;
  readonly top: number;
}

function footprintCenter(snap: Snapshot): { c: Vec2; size: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of snap.faces) {
    const iso = planeIsoOf(f.placement);
    for (const p of f.material) {
      const q = applyPlaneIso(iso, p);
      minX = Math.min(minX, q[0]);
      maxX = Math.max(maxX, q[0]);
      minY = Math.min(minY, q[1]);
      maxY = Math.max(maxY, q[1]);
    }
  }
  return { c: [(minX + maxX) / 2, (minY + maxY) / 2], size: Math.max(maxX - minX, maxY - minY) };
}

/** Where everything is at progress p (0..1) through a step. */
function compose(step: PlayerStep, p: number, mode: 'real' | 'ideal'): SceneFrame {
  const params = skinParamsFor(step.main.paper, mode);
  const tr = step.transition;
  const folds = tr && (tr.kind === 'fold' || tr.kind === 'reverse');
  const handsIn = span(p, 0, BEAT.handsIn);
  const handsOut = 1 - span(p, step.kind === 'precrease' ? BEAT.unfoldEnd : BEAT.creaseEnd, 1);
  const handOpacity = 0.42 * Math.min(handsIn, handsOut);
  const creasing = step.creased || step.kind === 'precrease';
  const hands: HandView[] = [];

  if (folds && tr) {
    const mt = tr as MotionTransition;
    let theta = Math.PI * span(p, BEAT.handsIn, BEAT.moveEnd);
    if (step.kind === 'precrease') theta = Math.PI * (1 - span(p, BEAT.creaseEnd, BEAT.unfoldEnd)) * span(p, BEAT.handsIn, BEAT.moveEnd);
    // The fingernail runs from the middle of the fold outward.
    const c = step.hands.crease;
    const l = mt.line;
    let sharpnessAt: (u: number) => number = () => 0;
    if (creasing && c && p > BEAT.pause) {
      const ua = (c.a[0] - l.p[0]) * l.d[0] + (c.a[1] - l.p[1]) * l.d[1];
      const ub = (c.b[0] - l.p[0]) * l.d[0] + (c.b[1] - l.p[1]) * l.d[1];
      const mid = (ua + ub) / 2;
      const half = Math.abs(ub - ua) / 2 + 1e-6;
      const reach = (half + 6) * span(p, BEAT.pause, BEAT.creaseEnd);
      sharpnessAt = (u) => Math.max(0, Math.min(1, (reach - Math.abs(u - mid)) / 6));
    }
    const motion = { before: step.before, transition: mt, theta, sharpnessAt };
    const frame = buildFrame(step.main, params, motion);
    const fh = step.hands.folding;
    if (fh && p < BEAT.pause) {
      const at = skinPoint(step.main, params, fh.face, fh.material, motion);
      const n = leftNormal(l);
      const toward: [number, number] = fh.pose === 'push' ? pushDir(step) : [-n[0], -n[1]];
      hands.push({ key: 'fold', pose: fh.pose, side: fh.hand, at: [at[0], at[1], at[2]], toward, opacity: handOpacity });
    }
    if (c && creasing && p >= BEAT.pause && p < BEAT.creaseEnd + 0.04) {
      // One pass from the middle out to each end.
      const k = span(p, BEAT.pause, BEAT.creaseEnd);
      const m: Vec2 = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2];
      const end = k < 0.5 ? c.a : c.b;
      const t = k < 0.5 ? k * 2 : (k - 0.5) * 2;
      const q: Vec2 = [m[0] + (end[0] - m[0]) * t, m[1] + (end[1] - m[1]) * t];
      const n = leftNormal(l);
      hands.push({
        key: 'nail',
        pose: 'nail',
        side: step.hands.folding?.hand ?? 'right',
        at: [q[0], frame.topHeight + 0.3, -q[1]],
        toward: [-n[0], -n[1]],
        opacity: 0.42,
      });
    }
    const h = step.hands.holding;
    if (h) {
      const toLine: [number, number] = [-(leftNormal(l)[0]), -(leftNormal(l)[1])];
      hands.push({ key: 'hold', pose: 'hold', side: h.hand, at: [h.at[0], frame.topHeight * 0.5 + 0.2, -h.at[1]], toward: [-toLine[0], -toLine[1]], opacity: handOpacity });
    }
    const lift = step.hands.liftModel ? 12 * Math.sin(Math.PI * span(p, 0, BEAT.moveEnd + 0.05)) : 0;
    return { frame, hands, symbols: 1 - span(p, BEAT.moveEnd, BEAT.pause), pulse: p > BEAT.moveEnd && p < BEAT.pause ? span(p, BEAT.moveEnd, BEAT.pause) : 0, lift, matrix: null, top: frame.topHeight };
  }

  // Turn over / rotate: the whole model swings into its new pose.
  const frame = buildFrame(step.after, params);
  let matrix: Matrix4 | null = null;
  if (tr && (tr.kind === 'turnOver' || tr.kind === 'rotate')) {
    const e = span(p, 0.15, 0.85);
    matrix = new Matrix4();
    if (tr.kind === 'turnOver') {
      const c = new Vector3(tr.axis.p[0], 0, -tr.axis.p[1]);
      const axis = new Vector3(tr.axis.d[0], 0, -tr.axis.d[1]).normalize();
      matrix
        .makeTranslation(c.x, 60 * Math.sin(Math.PI * e) + 1.5, c.z)
        .multiply(new Matrix4().makeRotationAxis(axis, -Math.PI * (1 - e)))
        .multiply(new Matrix4().makeTranslation(-c.x, -1.5, -c.z));
    } else {
      const c = new Vector3(tr.center[0], 0, -tr.center[1]);
      matrix
        .makeTranslation(c.x, 0, c.z)
        .multiply(new Matrix4().makeRotationY((-tr.degrees * Math.PI * (1 - e)) / 180))
        .multiply(new Matrix4().makeTranslation(-c.x, 0, -c.z));
    }
  }
  // A standalone crease: the fingernail runs along it.
  const c = step.hands.crease;
  if (step.kind === 'crease' && c) {
    const k = span(p, 0.15, 0.85);
    const q: Vec2 = [c.a[0] + (c.b[0] - c.a[0]) * k, c.a[1] + (c.b[1] - c.a[1]) * k];
    hands.push({ key: 'nail', pose: 'nail', side: 'right', at: [q[0], frame.topHeight + 0.3, -q[1]], toward: [0, 1], opacity: 0.42 * Math.min(handsIn, handsOut) });
  }
  return { frame, hands, symbols: 1 - span(p, 0.6, 0.8), pulse: 0, lift: 0, matrix, top: frame.topHeight };
}

function pushDir(step: PlayerStep): [number, number] {
  const push = step.symbols.find((s) => s.kind === 'push-arrow');
  return push && push.kind === 'push-arrow' ? [push.dir[0], push.dir[1]] : [0, 1];
}

function StepScene({ step, progress, look, fibers }: { step: PlayerStep; progress: React.RefObject<number>; look: PaperLook; fibers: { count: number; length: number } }) {
  const mode = useStore((s) => s.paperMode);
  const dark = useStore((s) => s.theme === 'dark');
  const [scene, setScene] = useState<SceneFrame>(() => compose(step, 0, mode));
  const group = useRef<Group>(null);
  const lastP = useRef(-1);
  useEffect(() => {
    lastP.current = -1;
  }, [step, mode]);
  useFrame(() => {
    const p = progress.current ?? 0;
    if (Math.abs(p - lastP.current) < 1e-4) return;
    lastP.current = p;
    const next = compose(step, p, mode);
    setScene(next);
    const g = group.current;
    if (g) {
      g.matrixAutoUpdate = false;
      g.matrix.copy(next.matrix ?? new Matrix4().makeTranslation(0, next.lift, 0));
      g.matrixWorldNeedsUpdate = true;
    }
  });
  const color = dark ? '#8fc3ff' : '#1f5fae';
  const y = scene.top + 0.6;
  return (
    <>
      <group ref={group}>
        <PaperMesh frame={scene.frame} look={look} fibers={fibers} />
      </group>
      {scene.symbols > 0.02 &&
        step.symbols.map((s, i) => {
          if (s.kind === 'valley-line' || s.kind === 'mountain-line') {
            return <FoldLine key={i} a={s.a} b={s.b} height={y} kind={s.kind === 'valley-line' ? 'valley' : 'mountain'} color={color} />;
          }
          if (s.kind === 'valley-arrow' || s.kind === 'mountain-arrow' || s.kind === 'fold-unfold-arrow') {
            const kind = s.kind === 'valley-arrow' ? 'valley' : s.kind === 'mountain-arrow' ? 'mountain' : 'both';
            return <FoldArrow key={i} from={s.from} to={s.to} height={y} color={color} kind={kind} progress={Math.min(1, scene.symbols * 1.6)} />;
          }
          if (s.kind === 'push-arrow') return <PushArrow key={i} at={s.at} dir={s.dir} height={y + 2} color={color} />;
          return null;
        })}
      {scene.pulse > 0 &&
        step.symbols.map((s, i) =>
          s.kind === 'valley-arrow' || s.kind === 'mountain-arrow' || s.kind === 'fold-unfold-arrow' ? (
            <SnapRing key={`pulse-${i}`} at={s.to} height={y} radius={2 + 4 * Math.sin(Math.PI * scene.pulse)} color={color} />
          ) : null,
        )}
      {scene.hands.map((h) => (h.opacity > 0.01 ? <Hand key={h.key} pose={h.pose} side={h.side} at={h.at} toward={h.toward} opacity={h.opacity} /> : null))}
    </>
  );
}

function SymbolIcon({ kind }: { kind: 'turn-over' | 'rotate' }) {
  return kind === 'turn-over' ? (
    <svg viewBox="0 0 24 24" className="symbol-icon" aria-hidden="true">
      <path d="M4 14c0-5 4-8 8-8s7 2 8 6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 12l-3 -0.5M20 12l0.5 -3" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <path d="M20 10c0 5-4 8-8 8s-7-2-8-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2 2" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="symbol-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="30 14" />
      <path d="M17 6l2 4-4.2 0.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** Build steps, played back (brief, section 7, "Ways to view"). */
export function StepsPlayer() {
  const sv = useStore((s) => s.stepsView);
  const set = useStore((s) => s.set);
  const dark = useStore((s) => s.theme === 'dark');
  const preset = useStore((s) => s.preset);
  const frontColor = useStore((s) => s.frontColor);
  const backColor = useStore((s) => s.backColor);
  const p = PRESETS[preset];
  const look: PaperLook = useMemo(() => ({ ...p.look, front: frontColor, back: backColor }), [p, frontColor, backColor]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [scrub, setScrub] = useState(0);
  const progress = useRef(0);
  const steps = sv?.steps ?? [];
  const step = steps[Math.min(index, steps.length - 1)];

  // Advance time.
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let last = performance.now();
    let shown = -1;
    const tick = (now: number) => {
      // A slow frame slows the film down rather than skipping beats.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playing) {
        progress.current += (dt * speed) / STEP_SECONDS;
        if (progress.current >= 1) {
          if (loop) progress.current = 0;
          else if (index + 1 < steps.length) {
            progress.current = 0;
            setIndex(index + 1);
            return;
          } else {
            progress.current = 1;
            setPlaying(false);
          }
        }
      }
      const rounded = Math.round(progress.current * 100) / 100;
      if (rounded !== shown) {
        shown = rounded;
        setScrub(rounded);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, playing, speed, loop, index, steps.length]);

  const go = (i: number) => {
    progress.current = 0;
    setIndex(Math.max(0, Math.min(steps.length - 1, i)));
    setPlaying(true);
  };

  const frameInfo = useMemo(() => (step ? footprintCenter(step.before) : { c: [0, 0] as Vec2, size: 150 }), [step]);
  const k = Math.max(0.7, frameInfo.size / 150);
  const turn = step?.symbols.find((s) => s.kind === 'turn-over' || s.kind === 'rotate');

  return (
    <div className="steps-view">
      {step ? (
        <Canvas
          shadows="percentage"
          dpr={[1, 2]}
          camera={{ position: [frameInfo.c[0], 270 * k, -frameInfo.c[1] + 120 * k], fov: 35, near: 2, far: 4000 }}
          gl={{ antialias: true, toneMapping: NeutralToneMapping, preserveDrawingBuffer: true }}
        >
          <color attach="background" args={[dark ? '#141917' : '#dfe4e0']} />
          <Studio dark={dark} shadows={SHADOWS} />
          <StepScene step={step} progress={progress} look={look} fibers={p.fibers} />
          <OrbitControls makeDefault enableDamping target={[frameInfo.c[0], 0, -frameInfo.c[1]]} mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }} />
        </Canvas>
      ) : null}

      <aside className="steps-list" aria-label={strings.stepsList}>
        <div className="panel-head">
          <h2>{strings.stepsTitle}</h2>
          <button className="ghost-btn" onClick={() => set({ mode: 'fold' })}>
            {strings.backToFolding}
          </button>
        </div>
        {steps.length === 0 ? (
          <p className="muted">{strings.stepsEmpty}</p>
        ) : (
          <>
            <p className="muted">{strings.stepsSummary(steps.length)}</p>
            {sv && !sv.verified && <p className="warn">{strings.stepsUnverified}</p>}
            <ol>
              {steps.map((s, i) => (
                <li key={i}>
                  <button className={i === index ? 'current' : ''} aria-current={i === index ? 'step' : undefined} onClick={() => go(i)}>
                    <span className="n">{i + 1}.</span> {captionText(s.caption)}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>

      {step && (
        <section className="steps-bar" aria-live="polite">
          <div className="caption">
            <span className="muted">{strings.stepOf(index + 1, steps.length)}</span>
            {step.named && step.kind !== 'fold' && step.kind !== 'precrease' ? <span className="chip-inline">{moveNames[step.name]}</span> : null}
            {turn && (turn.kind === 'turn-over' || turn.kind === 'rotate') ? <SymbolIcon kind={turn.kind} /> : null}
            <strong>{captionText(step.caption)}</strong>
          </div>
          <div className="controls">
            <button onClick={() => go(index - 1)} disabled={index === 0} aria-label={strings.previous}>
              ‹
            </button>
            <button
              onClick={() => {
                if (!playing && progress.current >= 1) progress.current = 0;
                setPlaying(!playing);
              }}
              aria-label={playing ? strings.pause : strings.play}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <button onClick={() => go(index + 1)} disabled={index >= steps.length - 1} aria-label={strings.next}>
              ›
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={scrub}
              aria-label={strings.stepOf(index + 1, steps.length)}
              onChange={(e) => {
                progress.current = Number(e.target.value);
                setScrub(progress.current);
                setPlaying(false);
              }}
            />
            <span className="segmented" role="radiogroup" aria-label={strings.speed}>
              {[0.5, 1, 2].map((v) => (
                <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>
                  {v}×
                </button>
              ))}
            </span>
            <label className="toggle compact">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
              <span>{strings.loopStep}</span>
            </label>
          </div>
        </section>
      )}
    </div>
  );
}
