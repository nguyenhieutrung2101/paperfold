import { useStore } from './store.ts';

/**
 * Paper sounds and touch haptics (Phase 2). Synthesized with Web Audio (filtered noise and a
 * low thump), so there are no sound files to load: a soft swish when a fold lands, a fingernail
 * scrape when it's creased, a whoosh when the model turns over, and a quiet thump when the
 * paper refuses. On phones and tablets a short vibration goes with each.
 *
 * APPROXIMATION: the sounds are a look-alike, not recordings of paper.
 */
export type Cue = 'fold' | 'crease' | 'turn' | 'refuse';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = b.getChannelData(0);
  // Brownish noise: paper rustle sits low.
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.06 * (Math.random() * 2 - 1)) / 1.06;
    d[i] = last * 3.5;
  }
  noise = b;
  return b;
}

function burst(c: AudioContext, o: { dur: number; gain: number; type: BiquadFilterType; freq: number; to?: number; q?: number; tremolo?: number }) {
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  f.Q.value = o.q ?? 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.gain, t + Math.min(0.04, o.dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g);
  if (o.tremolo) {
    // A fingernail catches on the fibers as it runs.
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = o.tremolo;
    depth.gain.value = o.gain * 0.5;
    lfo.connect(depth).connect(g.gain);
    lfo.start(t);
    lfo.stop(t + o.dur);
  }
  g.connect(c.destination);
  src.start(t, Math.random() * 0.5);
  src.stop(t + o.dur);
}

function thump(c: AudioContext) {
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
  const g = c.createGain();
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.13);
}

const VIBRATE: Record<Cue, number | number[]> = { fold: 12, crease: [6, 30, 6, 30, 6], turn: 10, refuse: 28 };

/** Play a cue (if sound is on) and buzz a touch device. */
export function cue(kind: Cue, touch = false): void {
  if (!useStore.getState().sound) return;
  if (touch && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(VIBRATE[kind]);
  const c = audio();
  if (!c) return;
  switch (kind) {
    case 'fold':
      burst(c, { dur: 0.22, gain: 0.22, type: 'bandpass', freq: 1800, to: 900, q: 0.7 });
      break;
    case 'crease':
      burst(c, { dur: 0.42, gain: 0.16, type: 'highpass', freq: 2600, q: 0.6, tremolo: 38 });
      break;
    case 'turn':
      burst(c, { dur: 0.5, gain: 0.18, type: 'lowpass', freq: 400, to: 2400, q: 0.5 });
      break;
    case 'refuse':
      thump(c);
      break;
  }
}

/** Browsers start audio only after a gesture: unlock on the first press. */
export function unlockAudioOnFirstPress(): void {
  if (typeof window === 'undefined') return;
  const go = () => {
    audio();
    window.removeEventListener('pointerdown', go, true);
    window.removeEventListener('keydown', go, true);
  };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}
