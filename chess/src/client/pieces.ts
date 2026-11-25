import type { LookId } from '../shared/progress.js'
import type { Color, PieceSymbol } from '../shared/types.js'

/** Painted piece art. Classic is marble and walnut. Exotic is the earned jeweled set. */
export function pieceHtml(type: PieceSymbol, color: Color, look: LookId): string {
  const src = `/art/${look}/${color}${type}.webp`
  return `<img class="piece-art" alt="" draggable="false" src="${src}" />`
}
