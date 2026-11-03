import { useEffect, useRef, useState } from 'react';
import { exportFold, goTo, newSheet, openFold, performMove, redo, undo, creaseActive } from './actions.ts';
import { FoldView } from './fold/FoldView.tsx';
import { LabView } from './lab/LabView.tsx';
import { PRESET_ORDER, PRESETS, type PresetId } from './presets.ts';
import { strings } from './strings.en.ts';
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
        <input type="checkbox" checked={s.autoCrease} onChange={(e) => s.set({ autoCrease: e.target.checked })} />
        <span>
          {strings.autoCrease}
          <small>{strings.autoCreaseHelp}</small>
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
              title={i === 0 ? strings.start : `${i}. ${strings.moveLabel[t.label] ?? t.label}`}
              aria-current={t.current ? 'step' : undefined}
            >
              {i === 0 ? '□' : i}
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
  const showPointer = hint && performance.now() - hint.at < 2200;
  const steps = (view?.timeline.length ?? 1) - 1;
  let intro: string | null = null;
  if (mode === 'fold' && firstRun === 0 && steps === 0) intro = strings.firstRun[0]!;
  else if (mode === 'fold' && firstRun === 1 && active && active.creasedAt === null) intro = strings.firstRun[1]!;
  return (
    <>
      {intro && (
        <div className="intro" role="status">
          {intro}
        </div>
      )}
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
      <div className="stage">{mode === 'fold' ? <FoldView /> : <LabView />}</div>
      <TopBar />
      {mode === 'fold' && <SidePanel />}
      {mode === 'fold' && <Timeline />}
      <Hints />
    </div>
  );
}
