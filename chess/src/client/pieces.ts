import type { Color, PieceStyleId, PieceSymbol } from '../shared/types.js'

/**
 * Original chess piece artwork for Game Kings Chess.
 * Dedicated to the public domain under CC0 1.0 Universal.
 * https://creativecommons.org/publicdomain/zero/1.0/
 */

const BODY: Record<PieceSymbol, string> = {
  p: `<circle cx="40" cy="18" r="9"/><path d="M28.5 31c2.2 7.5 2.4 13.5.4 22h22.2c-2-8.5-1.8-14.5.4-22-6.4 4.2-16.6 4.2-23 0z"/><path d="M22 55.5h36c1.2 5.2-1.6 8-6.2 8H28.2c-4.6 0-7.4-2.8-6.2-8z"/>`,
  r: `<path d="M16 14h10v8h6v-8h16v8h6v-8h10v12H16z"/><path d="M20 26h40v26H20z"/><path d="M15 54h50v8H15z"/>`,
  n: `<path d="M20 66V44c1-8 6-14 14-18l-6-8 9-3 5 7 9-8 7 9-7 5c7 3 12 10 12 19v5H50l-3 14z"/><circle cx="47" cy="30" r="2.3" fill="#e8c872" stroke="none"/>`,
  b: `<path fill-rule="evenodd" d="M40 7c9 7 17 17 17 28 0 6-3 12-8 16 4 3 6 7 6 11v5H25v-5c0-4 2-8 6-11-5-4-8-10-8-16 0-11 8-21 17-28zM38 18h4v13h-4z"/>`,
  q: `<circle cx="16" cy="22" r="4.2"/><circle cx="28" cy="13" r="4.2"/><circle cx="40" cy="10" r="4.6"/><circle cx="52" cy="13" r="4.2"/><circle cx="64" cy="22" r="4.2"/><path d="M16 24l7 15h34l7-15-9 6-8-9-8 9z"/><path d="M24 41h32l4 14H20z"/><path d="M16 57h48v7H16z"/>`,
  k: `<path d="M36 3h8v8h9v8h-9v7h-8v-7h-9v-8h9z"/><path d="M15 32h50l-5 13H20z"/><path d="M18 47h44l4 12H14z"/><path d="M14 61h52v6H14z"/>`,
}

let serial = 0

function colors(color: Color, style: PieceStyleId): { fill: string; stroke: string } {
  if (style === 'line') {
    return { fill: 'none', stroke: color === 'w' ? '#f6e2a8' : '#e8c872' }
  }
  if (style === 'stained') {
    return { fill: `url(#g${serial})`, stroke: '#f3e2a9' }
  }
  if (style === 'marble') {
    return { fill: `url(#g${serial})`, stroke: color === 'w' ? '#8c7350' : '#e8c872' }
  }
  return {
    fill: color === 'w' ? '#f7f2e7' : '#161018',
    stroke: color === 'w' ? '#3c2c1c' : '#e8c872',
  }
}

function defs(color: Color, style: PieceStyleId, id: string): string {
  if (style === 'stained') {
    const a = color === 'w' ? '#f4d78a' : '#2a1248'
    const b = color === 'w' ? '#7c3aed' : '#c4b5fd'
    const c = color === 'w' ? '#f8f4ea' : '#6d28d9'
    return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.48" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>`
  }
  if (style === 'marble') {
    const a = color === 'w' ? '#fffaf1' : '#2a2433'
    const b = color === 'w' ? '#c8b49a' : '#0e0b12'
    const c = color === 'w' ? '#f3e2c2' : '#5c5348'
    return `<defs><radialGradient id="${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${a}"/><stop offset="0.55" stop-color="${c}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs>`
  }
  return ''
}

export function pieceSvg(type: PieceSymbol, color: Color, style: PieceStyleId): string {
  serial += 1
  const id = `g${serial}`
  const paint = colors(color, style)
  const width = style === 'line' ? 2.4 : 1.4
  return `<svg viewBox="0 0 80 80" width="100%" height="100%" aria-hidden="true" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${width}" stroke-linejoin="round">${defs(color, style, id)}${BODY[type]}</svg>`
}
