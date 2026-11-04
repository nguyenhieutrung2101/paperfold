import type { CandidateKind } from '@paperfold/intent';
import { candidateName, strings } from '../strings.en.ts';
import { useStore } from '../store.ts';

type PictureKind = CandidateKind | 'push';

/**
 * Place a label by the pointer on the side away from the model, so it never covers the paper
 * you're looking at (the corner's curl, the tip being tucked).
 */
function beside(at: { readonly x: number; readonly y: number }, away: { readonly x: number; readonly y: number }): React.CSSProperties {
  const right = away.x >= -0.2;
  const below = away.y >= -0.2;
  return {
    left: right ? Math.min(at.x + 22, window.innerWidth - 16) : Math.max(16, at.x - 22),
    top: below ? Math.min(at.y + 22, window.innerHeight - 16) : Math.max(16, at.y - 22),
    transform: `translate(${right ? '0' : '-100%'}, ${below ? '0' : '-100%'})`,
  };
}

/**
 * A tiny picture of a move on a folded triangle: what moves is drawn in the accent color, a tip
 * that goes inside is dashed. Shapes only, so they read at 36 px.
 */
export function MovePicture({ kind, layers }: { readonly kind: PictureKind; readonly layers?: number }) {
  const sheet = { fill: 'var(--paper-fill)', stroke: 'var(--text)', strokeWidth: 1.4, strokeLinejoin: 'round' as const };
  const moved = { fill: 'var(--accent)', stroke: 'var(--text)', strokeWidth: 1.4, strokeLinejoin: 'round' as const };
  const tipped = kind === 'inside-reverse' || kind === 'outside-reverse' || kind === 'push';
  if (kind === 'squash') {
    // A flap opened and pressed flat into a diamond over its hinge.
    return (
      <svg viewBox="0 0 40 40" className="move-picture" aria-hidden="true">
        <polygon points="6,34 34,34 20,10" {...sheet} />
        <polygon points="20,10 29,22 20,34 11,22" {...moved} />
        <line x1="20" y1="10" x2="20" y2="34" stroke="var(--text)" strokeWidth={1} />
      </svg>
    );
  }
  if (kind === 'pleat') {
    // A strip folded under and the part beyond laid back over it: a zigzag edge-on.
    return (
      <svg viewBox="0 0 40 40" className="move-picture" aria-hidden="true">
        <polygon points="4,12 22,12 22,30 4,30" {...sheet} />
        <polygon points="16,12 22,12 22,30 16,30" fill="var(--paper-under)" stroke="var(--text)" strokeWidth={1.4} strokeLinejoin="round" />
        <polygon points="16,12 34,12 34,30 16,30" {...moved} />
        <line x1="16" y1="12" x2="16" y2="30" stroke="var(--text)" strokeWidth={1} strokeDasharray="2.5 1.5" />
      </svg>
    );
  }
  if (kind === 'inside-crimp' || kind === 'outside-crimp') {
    // A flap with its tip kinked down at two lines; inside, the strip is dashed (tucked in).
    return (
      <svg viewBox="0 0 40 40" className="move-picture" aria-hidden="true">
        <polygon points="4,10 20,10 20,22 4,22" {...sheet} />
        <polygon points="20,10 24,14 22,25 18,22" {...moved} strokeDasharray={kind === 'inside-crimp' ? '2 1.5' : undefined} />
        <polygon points="24,14 36,32 30,35 22,25" {...moved} />
      </svg>
    );
  }
  if (kind === 'rabbit-ear') {
    // The triangle's sides folded in, the ear standing over to one side.
    return (
      <svg viewBox="0 0 40 40" className="move-picture" aria-hidden="true">
        <polygon points="4,34 36,34 20,18" {...sheet} />
        <polygon points="20,18 27,34 18,34" fill="var(--paper-under)" stroke="var(--text)" strokeWidth={1.4} strokeLinejoin="round" />
        <polygon points="20,18 30,6 27,24" {...moved} />
      </svg>
    );
  }
  if (kind === 'petal') {
    // The bottom point lifted up on a hinge, the sides folded in under it.
    return (
      <svg viewBox="0 0 40 40" className="move-picture" aria-hidden="true">
        <polygon points="20,14 33,25 20,37 7,25" {...sheet} />
        <polygon points="20,3 25,20 20,25 15,20" {...moved} />
        <line x1="13.5" y1="20" x2="26.5" y2="20" stroke="var(--text)" strokeWidth={1} strokeDasharray="2 1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 40" className="move-picture" aria-hidden="true">
      {tipped ? (
        <polygon points="6,6 22,6 25,15 6,34" {...sheet} />
      ) : kind === 'fold-top' ? (
        <>
          <polygon points="6,6 34,6 6,34" {...sheet} />
          <polygon points="6,6 15,6 6,15" fill="var(--paper-under)" />
        </>
      ) : (
        <polygon points="15,6 34,6 6,34 6,15" {...sheet} />
      )}
      {kind === 'inside-reverse' || kind === 'push' ? (
        <polygon points="22,6 25,15 15.5,10.5" fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeDasharray="2.2 1.8" />
      ) : kind === 'outside-reverse' ? (
        <polygon points="22,6 25,15 33,22" {...moved} />
      ) : (
        <polygon points="15,6 6,15 15,15" {...moved} />
      )}
      {kind === 'fold-layers' && layers !== undefined && (
        <text x="27" y="31" fontSize="11" fontWeight="600" fill="var(--text)" textAnchor="middle">
          {layers}
        </text>
      )}
    </svg>
  );
}

/**
 * While dragging: every way this drag could fold, as small pictures by the pointer. The one
 * the paper shows is highlighted; scroll, Tab or 1–9 switch, and on touch a tap does.
 */
export function ChoiceStrip() {
  const drag = useStore((s) => s.drag);
  const choose = useStore((s) => s.choose);
  if (!drag || drag.resisting || drag.candidates.length === 0) return null;
  const sel = drag.candidates[drag.selected];
  if (!sel) return null;
  const snapName = drag.snapKind ? strings.targetNames[drag.snapKind] : null;
  // A plain fold of the top layer with nothing else to pick needs no name, only what it lines up with.
  const plain = drag.candidates.length === 1 && sel.kind === 'fold-top';
  if (plain && !snapName) return null;
  return (
    <div className="strip" style={beside(drag.pointer, drag.away)} role="radiogroup" aria-label={strings.choicesLabel}>
      {drag.candidates.length > 1 && (
        <div className="strip-tiles">
          {drag.candidates.slice(0, 9).map((c, i) => (
            <button
              key={`${c.kind}:${c.layers}`}
              role="radio"
              aria-checked={i === drag.selected}
              aria-label={candidateName(c.kind, c.layers)}
              className={i === drag.selected ? 'on' : ''}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                choose?.(i);
              }}
            >
              <MovePicture kind={c.kind} layers={c.layers} />
              <span className="key">{i + 1}</span>
            </button>
          ))}
        </div>
      )}
      <div className="strip-label">
        {plain ? <strong>{snapName}</strong> : <strong>{candidateName(sel.kind, sel.layers)}</strong>}
        {!plain && snapName && <span className="snap-name">{snapName}</span>}
        {drag.candidates.length > 1 && <span className="muted">{strings.stripHint(drag.candidates.length)}</span>}
      </div>
    </div>
  );
}

/** Before you press: what you'd pick up here, or what a folded edge does. */
export function HoverBadge() {
  const hover = useStore((s) => s.hover);
  const drag = useStore((s) => s.drag);
  const keyboard = useStore((s) => s.keyboard);
  if (!hover || drag || keyboard) return null;
  let title: string;
  let sub: string | null = null;
  let picture: PictureKind;
  if (hover.zone === 'folded-edge') {
    title = strings.pushIn;
    sub = strings.pushSub;
    picture = 'push';
  } else {
    // One layer: nothing to choose, the ring and the curl say enough.
    if (hover.total <= 1) return null;
    title = strings.layersName(hover.layers, hover.total);
    if (hover.layers < hover.total) sub = strings.scrollLayers('more', hover.pressed);
    else if (hover.layers > hover.min) sub = strings.scrollLayers('fewer', hover.pressed);
    picture = hover.layers >= hover.total && hover.total > 1 ? 'fold-all' : hover.layers === 1 ? 'fold-top' : 'fold-layers';
  }
  const key = `${hover.zone}:${hover.corner?.join(',') ?? ''}:${hover.edge ? 'e' : ''}`;
  return (
    <div key={key} className="hover-badge" style={beside(hover.screen, hover.away)}>
      <MovePicture kind={picture} layers={hover.layers} />
      <div>
        <strong>{title}</strong>
        {sub && <span className="muted">{sub}</span>}
      </div>
    </div>
  );
}
