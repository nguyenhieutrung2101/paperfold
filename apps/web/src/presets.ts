import type { SheetOptions } from '@paperfold/kernel';
import type { PaperLook } from '@paperfold/render';

export type PresetId = 'kami' | 'washi' | 'printer' | 'foil' | 'duo';

export interface PaperPreset {
  readonly id: PresetId;
  readonly sheet: Required<Pick<SheetOptions, 'thicknessMm' | 'stiffness' | 'frontColor' | 'backColor'>>;
  readonly look: Omit<PaperLook, 'front' | 'back'>;
  readonly fibers: { readonly count: number; readonly length: number };
}

/**
 * Paper presets (brief, section 4). Numbers are plausible, not measured:
 * kami ~0.07 mm, washi ~0.09 mm and soft, printer paper ~0.1 mm and stiff,
 * foil holds any shape.
 */
export const PRESETS: Record<PresetId, PaperPreset> = {
  kami: {
    id: 'kami',
    sheet: { thicknessMm: 0.07, stiffness: 0.35, frontColor: '#c8553d', backColor: '#f3efe6' },
    look: { translucency: 0.35, roughness: 0.8, fiberStrength: 0.3 },
    fibers: { count: 900, length: 14 },
  },
  washi: {
    id: 'washi',
    sheet: { thicknessMm: 0.09, stiffness: 0.2, frontColor: '#e8dcc4', backColor: '#efe6d3' },
    look: { translucency: 0.6, roughness: 0.9, fiberStrength: 0.45 },
    fibers: { count: 2600, length: 46 },
  },
  printer: {
    id: 'printer',
    sheet: { thicknessMm: 0.1, stiffness: 0.75, frontColor: '#f7f7f4', backColor: '#f7f7f4' },
    look: { translucency: 0.2, roughness: 0.85, fiberStrength: 0.12 },
    fibers: { count: 700, length: 10 },
  },
  foil: {
    id: 'foil',
    sheet: { thicknessMm: 0.06, stiffness: 0.05, frontColor: '#9aa7b3', backColor: '#f1ece2' },
    look: { translucency: 0.05, roughness: 0.55, fiberStrength: 0.1 },
    fibers: { count: 500, length: 10 },
  },
  duo: {
    id: 'duo',
    sheet: { thicknessMm: 0.08, stiffness: 0.4, frontColor: '#2f6f8f', backColor: '#e9b44c' },
    look: { translucency: 0.25, roughness: 0.8, fiberStrength: 0.2 },
    fibers: { count: 900, length: 14 },
  },
};

export const PRESET_ORDER: readonly PresetId[] = ['kami', 'washi', 'printer', 'foil', 'duo'];
