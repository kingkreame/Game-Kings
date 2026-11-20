import type { EffectPackId, PieceStyleId, ThemeId } from './types.js'

export interface ThemeDef {
  id: ThemeId
  name: string
  premium: boolean
  light: string
  dark: string
  last: string
  dot: string
  dotDark: string
  frame: string
}

export const THEMES: readonly ThemeDef[] = [
  {
    id: 'classic',
    name: 'Classic Royal',
    premium: false,
    light: '#e7d3a3',
    dark: '#4c326c',
    last: 'rgba(232, 200, 114, 0.55)',
    dot: 'rgba(42, 24, 56, 0.55)',
    dotDark: 'rgba(243, 226, 169, 0.92)',
    frame: '#e8c872',
  },
  {
    id: 'amethyst',
    name: 'Midnight Amethyst',
    premium: true,
    light: '#d9c8f5',
    dark: '#2d1b4e',
    last: 'rgba(196, 160, 255, 0.55)',
    dot: 'rgba(36, 16, 64, 0.55)',
    dotDark: 'rgba(232, 214, 255, 0.92)',
    frame: '#c4b5fd',
  },
  {
    id: 'emerald',
    name: 'Royal Emerald',
    premium: true,
    light: '#d7ead0',
    dark: '#1c4638',
    last: 'rgba(232, 200, 114, 0.5)',
    dot: 'rgba(12, 40, 32, 0.55)',
    dotDark: 'rgba(226, 243, 214, 0.92)',
    frame: '#d4af37',
  },
  {
    id: 'rose',
    name: 'Obsidian Rose',
    premium: true,
    light: '#f3d5dc',
    dark: '#4a2433',
    last: 'rgba(232, 200, 114, 0.48)',
    dot: 'rgba(48, 16, 28, 0.5)',
    dotDark: 'rgba(255, 228, 214, 0.92)',
    frame: '#e8b4b8',
  },
]

export interface StyleDef {
  id: PieceStyleId
  name: string
  premium: boolean
}

export const PIECE_STYLES: readonly StyleDef[] = [
  { id: 'classic', name: 'Classic', premium: false },
  { id: 'line', name: 'Line Gold', premium: true },
  { id: 'stained', name: 'Stained Glass', premium: true },
  { id: 'marble', name: 'Marble', premium: true },
]

export interface EffectDef {
  id: EffectPackId
  name: string
  premium: boolean
}

export const EFFECTS: readonly EffectDef[] = [
  { id: 'core', name: 'Core', premium: false },
  { id: 'lightning', name: 'Lightning capture', premium: true },
  { id: 'coins', name: 'Gold-coin burst', premium: true },
]

export function themeById(id: string): ThemeDef | null {
  return THEMES.find((theme) => theme.id === id) ?? null
}

export function isThemeId(id: string): id is ThemeId {
  return THEMES.some((theme) => theme.id === id)
}

export function isPieceStyleId(id: string): id is PieceStyleId {
  return PIECE_STYLES.some((style) => style.id === id)
}

export function isEffectId(id: string): id is EffectPackId {
  return EFFECTS.some((effect) => effect.id === id)
}
