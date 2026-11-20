import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { chooseAiMove } from '../src/shared/ai.js'
import { applyUci } from '../src/shared/game.js'
import type { Difficulty } from '../src/shared/types.js'

function legal(fen: string, uci: string | null): boolean {
  if (!uci) return false
  const chess = new Chess(fen)
  return applyUci(chess, uci) !== null
}

describe('computer moves', () => {
  const levels: Difficulty[] = ['easy', 'medium', 'hard', 'expert']

  it.each(levels)('%s returns a legal move from the opening', (level) => {
    const fen = new Chess().fen()
    const uci = chooseAiMove(fen, level, () => 0.1)
    expect(legal(fen, uci)).toBe(true)
  }, 30000)

  it('returns null when the side to move is checkmated', () => {
    const chess = new Chess()
    for (const uci of ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']) {
      expect(applyUci(chess, uci)).not.toBeNull()
    }
    expect(chess.isCheckmate()).toBe(true)
    expect(chooseAiMove(chess.fen(), 'medium')).toBeNull()
    expect(chooseAiMove(chess.fen(), 'expert')).toBeNull()
  })

  it('easy stays inside the legal move list across random samples', () => {
    const fen = new Chess().fen()
    for (let i = 0; i < 12; i++) {
      const uci = chooseAiMove(fen, 'easy', () => (i + 1) / 13)
      expect(legal(fen, uci)).toBe(true)
    }
  })
})
