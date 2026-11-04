import { useEffect, useRef, useState } from 'react';
import { creaseActive, exportFold, goTo, newSheet, openFold, openSteps, performMove, redo, undo } from './actions.ts';
import { FoldView } from './fold/FoldView.tsx';
import type { Thumb, View } from './kernel/api.ts';
import { ChoiceStrip, HoverBadge } from './fold/Choices.tsx';
import { StepsPlayer } from './steps/StepsPlayer.tsx';
import { LabView } from './lab/LabView.tsx';
import { PRESET_ORDER, PRESETS, type PresetId } from './presets.ts';
import { moveNames, strings } from './strings.en.ts';
import { saveTheme, useStore } from './store.ts';

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function TopBar() {
  const title = useStore((s) => s.title);
  const mode = useStore((s) => s.mode);
  const set = useStore((s) => s.set);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="brand" aria-hidden="true">
          {strings.appName}
        </span>
        <input
          className="title"
          aria-label={strings.designNameLabel}
          placeholder={strings.untitled}
          value={title}
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>
      <nav className="topbar-right">
        <span className="segmented" role="tablist">
          <button role="tab" aria-selected={mode === 'fold'} className={mode === 'fold' ? 'on' : ''} onClick={() => set({ mode: 'fold' })}>
            {strings.fold}
          </button>
          <button role="tab" aria-selected={mode === 'steps'} className={mode === 'steps' ? 'on' : ''} onClick={() => void openSteps()}>
            {strings.stepsButton}
          </button>
          <button role="tab" aria-selected={mode === 'lab'} className={mode === 'lab' ? 'on' : ''} onClick={() => set({ mode: 'lab', ghost: null })}>
            {strings.lab}
          </button>
        </span>
        <button onClick={() => fileInput.current?.click()}>{strings.open}</button>
        <button onClick={() => void exportFold()}>{strings.export}</button>
        <input
          ref={fileInput}
          type="file"
          accept=".fold,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openFold(f);
            e.target.value = '';
          }}
        />
      </nav>
    </header>
  );
}

function SidePanel() {
  const s = useStore();
  const pickPreset = (id: PresetId) => {
    const p = PRESETS[id];
    s.set({ preset: id, frontColor: p.sheet.frontColor, backColor: p.sheet.backColor });
  };
  if (!s.panelOpen) {
    return (
      <button className="panel-toggle" onClick={() => s.set({ panelOpen: true })} aria-label={strings.expand}>
        {strings.paper}
      </button>
    );
  }
  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>{strings.paper}</h2>
        <button className="ghost-btn" onClick={() => s.set({ panelOpen: false })} aria-label={strings.collapse}>
          ‹
        </button>
      </div>
      <div className="chips" role="radiogroup">
        {PRESET_ORDER.map((id) => (
          <button key={id} role="radio" aria-checked={s.preset === id} className={s.preset === id ? 'on' : ''} onClick={() => pickPreset(id)}>
            {strings.presets[id]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{strings.size}</span>
        <span className="segmented">
          {[150, 200, 250].map((mm) => (
            <button key={mm} className={s.sizeMm === mm ? 'on' : ''} onClick={() => s.set({ sizeMm: mm })}>
              {mm / 10} cm
            </button>
          ))}
        </span>
      </label>
      <div className="row">
        <label className="swatch">
          <input type="color" value={s.frontColor} onChange={(e) => s.set({ frontColor: e.target.value })} />
          <span>{strings.frontColor}</span>
        </label>
        <label className="swatch">
          <input type="color" value={s.backColor} onChange={(e) => s.set({ backColor: e.target.value })} />
          <span>{strings.backColor}</span>
        </label>
      </div>
      <button className="primary" onClick={() => void newSheet()}>
        {strings.newSheet}
      </button>

      <h2>{strings.view}</h2>
      <label className="toggle">
        <input type="checkbox" checked={s.paperMode === 'real'} onChange={(e) => s.set({ paperMode: e.target.checked ? 'real' : 'ideal' })} />
        <span>
          {strings.realPaper}
          <small>{strings.realPaperHelp}</small>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={s.relaxed} onChange={(e) => s.set({ relaxed: e.target.checked })} />
        <span>
          {strings.relaxed}
          <small>{strings.relaxedHelp}</small>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={s.lightbox} onChange={(e) => s.set({ lightbox: e.target.checked })} />
        <span>
          {strings.lightbox}
          <small>{strings.lightboxHelp}</small>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={s.autoCrease} onChange={(e) => s.set({ autoCrease: e.target.checked })} />
        <span>
          {strings.autoCrease}
          <small>{strings.autoCreaseHelp}</small>
        </span>
      </label>
      <label className="field">
        <span>{strings.handedness}</span>
        <span className="segmented">
          <button className={s.handedness === 'right' ? 'on' : ''} onClick={() => s.set({ handedness: 'right' })}>
            {strings.rightHand}
          </button>
          <button className={s.handedness === 'left' ? 'on' : ''} onClick={() => s.set({ handedness: 'left' })}>
            {strings.leftHand}
          </button>
        </span>
      </label>
      <label className="field">
        <span>{strings.theme}</span>
        <span className="segmented">
          <button className={s.theme === 'light' ? 'on' : ''} onClick={() => saveTheme('light')}>
            {strings.light}
          </button>
          <button className={s.theme === 'dark' ? 'on' : ''} onClick={() => saveTheme('dark')}>
            {strings.dark}
          </button>
        </span>
      </label>
      <p className="muted keys">{strings.keys}</p>
    </aside>
  );
}

/** A small top view of a step: faces bottom to top in the paper's colors. */
function ThumbSvg({ thumb }: { readonly thumb: Thumb }) {
  const front = useStore((s) => s.frontColor);
  const back = useStore((s) => s.backColor);
  return (
    <svg className="thumb" viewBox="0 0 1 1" aria-hidden="true">
      {thumb.polys.map((poly, i) => {
        const pts: string[] = [];
        for (let k = 0; k + 1 < poly.length; k += 2) pts.push(`${poly[k]!.toFixed(3)},${poly[k + 1]!.toFixed(3)}`);
        return (
          <polygon
            key={i}
            points={pts.join(' ')}
            fill={thumb.frontUp[i] ? front : back}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={0.012}
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

function Timeline() {
  const view = useStore((s) => s.view);
  if (!view) return null;
  const steps = view.timeline.length - 1;
  return (
    <footer className="timeline">
      <button onClick={() => void undo()} disabled={!view.canUndo} aria-label={strings.undo} title={strings.undo}>
        ↶
      </button>
      <ol className="steps" aria-label={strings.steps(steps)}>
        {view.timeline.map((t, i) => (
          <li key={t.id}>
            <button
              className={`step ${t.current ? 'current' : ''}`}
              onClick={() => void goTo(t.id)}
              title={i === 0 ? strings.start : `${i}. ${t.label === 'start' ? strings.start : moveNames[t.label]}`}
              aria-current={t.current ? 'step' : undefined}
              aria-label={i === 0 ? strings.start : `${i}. ${t.label === 'start' ? strings.start : moveNames[t.label]}`}
            >
              <ThumbSvg thumb={t.thumb} />
              <span className="step-n">{i === 0 ? '' : i}</span>
            </button>
          </li>
        ))}
      </ol>
      <button onClick={() => void redo()} disabled={!view.canRedo} aria-label={strings.redo} title={strings.redo}>
        ↷
      </button>
    </footer>
  );
}

/** Is there a folded edge to push (any fold that's still folded)? */
function hasFoldedEdge(view: View | null): boolean {
  return view?.snapshot.creases.some((c) => c.left !== null && c.right !== null && Math.abs(c.angleDeg) === 180) ?? false;
}

function Hints() {
  const hint = useStore((s) => s.hint);
  const firstRun = useStore((s) => s.firstRun);
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const active = useStore((s) => s.active);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => tick((n) => n + 1), 2300);
    return () => window.clearTimeout(t);
  }, [hint]);
  const drag = useStore((s) => s.drag);
  const keyboard = useStore((s) => s.keyboard);
  const showPointer = hint && performance.now() - hint.at < 2200;
  const steps = (view?.timeline.length ?? 1) - 1;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let intro: string | null = null;
  if (mode === 'fold' && firstRun === 0 && steps === 0) intro = strings.firstRun[0]!;
  else if (mode === 'fold' && firstRun === 1 && active && active.creasedAt === null) intro = strings.firstRun[1]!;
  else if (mode === 'fold' && firstRun === 2 && !drag) intro = coarse ? strings.firstRunTouchHold : strings.firstRun[2]!;
  else if (mode === 'fold' && firstRun === 3 && steps > 0 && !drag && hasFoldedEdge(view)) intro = strings.firstRun[3]!;
  return (
    <>
      {intro && !keyboard && (
        <div className="intro" role="status">
          {intro}
        </div>
      )}
      {keyboard && (
        <div className="intro" role="status" aria-live="polite">
          {keyboard.text}
        </div>
      )}
      {mode === 'fold' && <ChoiceStrip />}
      {mode === 'fold' && <HoverBadge />}
      {showPointer && (
        <div className="pointer-hint" role="status" style={{ left: hint.x + 14, top: hint.y + 14 }}>
          {hint.text}
        </div>
      )}
    </>
  );
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (useStore.getState().mode !== 'fold') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        void redo();
      } else if (!mod && e.key.toLowerCase() === 'f') {
        void performMove({ type: 'turnOver', params: { axis: e.shiftKey ? 'top' : 'side' } });
      } else if (!mod && e.key.toLowerCase() === 'q') {
        void performMove({ type: 'rotate', params: { degrees: 45 } });
      } else if (!mod && e.key.toLowerCase() === 'e') {
        void performMove({ type: 'rotate', params: { degrees: -45 } });
      } else if (!mod && e.key.toLowerCase() === 'c') {
        void creaseActive();
      } else if (!mod && e.key.toLowerCase() === 'r') {
        const st = useStore.getState();
        st.set({ relaxed: !st.relaxed });
      } else if (!mod && e.key.toLowerCase() === 'l' && !e.repeat) {
        // Hold L to look; a quick tap leaves it on (and another turns it off).
        lDownAt = performance.now();
        useStore.getState().set({ lightboxHeld: true });
      }
    };
    let lDownAt = 0;
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'l' || lDownAt === 0) return;
      const st = useStore.getState();
      const tap = performance.now() - lDownAt < 280;
      lDownAt = 0;
      st.set({ lightboxHeld: false, ...(tap ? { lightbox: !st.lightbox } : {}) });
    };
    const onBlur = () => {
      lDownAt = 0;
      useStore.getState().set({ lightboxHeld: false });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}

export function App() {
  const theme = useStore((s) => s.theme);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view);
  const [webgl] = useState(hasWebGL2);
  useKeyboard();
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);
  useEffect(() => {
    if (!view) void newSheet();
    // Scripts and e2e tests wait for this before touching the paper.
    document.documentElement.dataset['ready'] = view ? 'true' : 'false';
  }, [view]);

  if (!webgl) {
    return (
      <main className="fallback">
        <p>{strings.noWebGL}</p>
      </main>
    );
  }
  return (
    <div className="app">
      <div className="stage">{mode === 'fold' ? <FoldView /> : mode === 'lab' ? <LabView /> : <StepsPlayer />}</div>
      <TopBar />
      {mode === 'fold' && <SidePanel />}
      {mode === 'fold' && <Timeline />}
      <Hints />
    </div>
  );
}
