import { flatView, stackLevels, type Vec2 } from '@paperfold/kernel';
import { footprintHull } from './describe.ts';
import type { DiagramSymbol, Step } from './types.ts';

export interface DiagramOptions {
  readonly title: string;
  /** Each step's sentence (the app's words; strings stay in one place). */
  readonly text: (step: Step) => string;
  /** A line under the title (step count, difficulty). */
  readonly subtitle?: string;
  readonly columns?: number;
}

const CELL_W = 260;
const DRAW = 220;
const CELL_H = 330;
const HEAD = 70;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Words into lines of at most `n` characters. */
function wrap(text: string, n: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if (line && (line + ' ' + w).length > n) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

/**
 * The build steps as a diagram sheet (brief, section 7, "Diagram export"): each step drawn the
 * way paper diagrams are, from above, before the step, with Yoshizawa–Randlett lines and
 * arrows (valley dashed, mountain dash-dot, fold arrows, push arrows, turn-over and rotate
 * symbols), its number and its sentence. One SVG; print it to get a PDF.
 */
export function stepsSvg(steps: readonly Step[], o: DiagramOptions): string {
  const cols = Math.max(1, o.columns ?? 3);
  const rows = Math.ceil(steps.length / cols);
  const W = cols * CELL_W;
  const H = HEAD + rows * CELL_H;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1d4ed8"/></marker>`,
    `<marker id="hollow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#ffffff" stroke="#1d4ed8" stroke-width="1.2"/></marker></defs>`,
    `<text x="20" y="32" font-size="20" font-weight="700" fill="#111">${esc(o.title)}</text>`,
  );
  if (o.subtitle) parts.push(`<text x="20" y="54" font-size="13" fill="#555">${esc(o.subtitle)}</text>`);
  steps.forEach((s, i) => {
    const x0 = (i % cols) * CELL_W;
    const y0 = HEAD + Math.floor(i / cols) * CELL_H;
    parts.push(`<g transform="translate(${x0},${y0})">`, cell(s, i, o), '</g>');
  });
  parts.push('</svg>');
  return parts.join('\n');
}

function cell(s: Step, i: number, o: DiagramOptions): string {
  const view = flatView(s.before);
  const out: string[] = [];
  out.push(`<text x="14" y="22" font-size="16" font-weight="700" fill="#111">${i + 1}</text>`);
  if (!view) return out.join('');
  // Fit the model and its symbols into the drawing box.
  const hull = footprintHull(s.before);
  const pts: Vec2[] = [...hull];
  for (const sym of s.symbols) {
    if (sym.kind === 'valley-line' || sym.kind === 'mountain-line') pts.push(sym.a, sym.b);
    else if (sym.kind === 'valley-arrow' || sym.kind === 'mountain-arrow' || sym.kind === 'fold-unfold-arrow') pts.push(sym.from, sym.to);
    else if (sym.kind === 'push-arrow') pts.push(sym.at);
  }
  // Room for push arrows' tails (they come in from outside the paper).
  {
    const span0 = Math.max(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])), 1e-6);
    for (const sym of s.symbols) {
      if (sym.kind === 'push-arrow') pts.push([sym.at[0] - sym.dir[0] * span0 * 0.16, sym.at[1] - sym.dir[1] * span0 * 0.16]);
    }
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const k = DRAW / span;
  const ox = 20 + (DRAW - (maxX - minX) * k) / 2;
  const oy = 30 + (DRAW - (maxY - minY) * k) / 2;
  const X = (p: Vec2) => (ox + (p[0] - minX) * k).toFixed(2);
  const Y = (p: Vec2) => (oy + (maxY - p[1]) * k).toFixed(2);
  const pt = (p: Vec2) => `${X(p)},${Y(p)}`;

  // Faces, bottom layer first, in the side of the paper that faces up.
  const levels = stackLevels(s.before);
  const faces = [...view.faceIds].sort((a, b) => (levels.get(a) ?? 0) - (levels.get(b) ?? 0));
  const front = s.before.paper.front.color;
  const back = s.before.paper.back.color;
  for (const f of faces) {
    const poly = view.poly.get(f)!;
    out.push(`<polygon points="${poly.map(pt).join(' ')}" fill="${view.frontUp.get(f) ? front : back}" stroke="#333" stroke-width="0.8" stroke-linejoin="round"/>`);
  }
  for (const sym of s.symbols) out.push(symbol(sym, X, Y));
  // The sentence, under the drawing.
  const lines = wrap(o.text(s), 38);
  lines.forEach((l, j) => out.push(`<text x="14" y="${30 + DRAW + 26 + j * 16}" font-size="13" fill="#111">${esc(l)}</text>`));
  return out.join('\n');
}

function symbol(sym: DiagramSymbol, X: (p: Vec2) => string, Y: (p: Vec2) => string): string {
  switch (sym.kind) {
    case 'valley-line':
      return `<line x1="${X(sym.a)}" y1="${Y(sym.a)}" x2="${X(sym.b)}" y2="${Y(sym.b)}" stroke="#1d4ed8" stroke-width="1.6" stroke-dasharray="7 4"/>`;
    case 'mountain-line':
      return `<line x1="${X(sym.a)}" y1="${Y(sym.a)}" x2="${X(sym.b)}" y2="${Y(sym.b)}" stroke="#b91c1c" stroke-width="1.6" stroke-dasharray="7 3 1.5 3"/>`;
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow': {
      // A curved arrow from where the paper is to where it lands, bowed to one side.
      const a = [Number(X(sym.from)), Number(Y(sym.from))];
      const b = [Number(X(sym.to)), Number(Y(sym.to))];
      const mx = (a[0]! + b[0]!) / 2;
      const my = (a[1]! + b[1]!) / 2;
      const dx = b[0]! - a[0]!;
      const dy = b[1]! - a[1]!;
      const c = [mx - dy * 0.3, my + dx * 0.3];
      const both = sym.kind === 'fold-unfold-arrow' ? ' marker-start="url(#head)"' : '';
      const head = sym.kind === 'mountain-arrow' ? 'url(#hollow)' : 'url(#head)';
      return `<path d="M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}" fill="none" stroke="#1d4ed8" stroke-width="1.6" marker-end="${head}"${both}/>`;
    }
    case 'push-arrow': {
      const at = [Number(X(sym.at)), Number(Y(sym.at))];
      const len = 30;
      const from = [at[0]! - sym.dir[0] * len, at[1]! + sym.dir[1] * len];
      return `<line x1="${from[0]}" y1="${from[1]}" x2="${at[0]}" y2="${at[1]}" stroke="#1d4ed8" stroke-width="2.2" marker-end="url(#hollow)"/>`;
    }
    case 'turn-over':
      // Two arrows chasing each other in a loop.
      return `<g transform="translate(52,14)"><path d="M-12,4 A12,9 0 1 1 12,4" fill="none" stroke="#1d4ed8" stroke-width="1.6" marker-end="url(#head)"/><path d="M12,-4 A12,9 0 0 1 -12,-4" fill="none" stroke="#1d4ed8" stroke-width="1.6" marker-end="url(#head)" transform="translate(0,14)"/></g>`;
    case 'rotate':
      return `<g transform="translate(52,16)"><path d="M10,0 A10,10 0 1 ${sym.degrees > 0 ? 0 : 1} -10,0" fill="none" stroke="#1d4ed8" stroke-width="1.6" marker-end="url(#head)"/><text x="0" y="22" font-size="10" text-anchor="middle" fill="#1d4ed8">${Math.abs(sym.degrees)}°</text></g>`;
  }
}
