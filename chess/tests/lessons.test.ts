import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { LESSONS, explainMove } from '../src/shared/lessons.js'
import { moveToUci } from '../src/shared/game.js'

describe('training lessons', () => {
  it('teaches three short positions with legal hints and honest grades', () => {
    expect(LESSONS).toHaveLength(3)
    for (const lesson of LESSONS) {
      const chess = new Chess(lesson.fen)
      const legal = new Set(chess.moves({ verbose: true }).map((move) => moveToUci(move)))
      expect(legal.has(lesson.hintMove), lesson.id).toBe(true)
      for (const uci of Object.keys(lesson.good)) expect(legal.has(uci), `${lesson.id} ${uci}`).toBe(true)
      for (const uci of Object.keys(lesson.poor)) expect(legal.has(uci), `${lesson.id} ${uci}`).toBe(true)
      expect(explainMove(lesson, lesson.hintMove).done).toBe(true)
      const samplePoor = Object.keys(lesson.poor)[0]
      if (samplePoor) expect(explainMove(lesson, samplePoor).done).toBe(false)
    }
  })

  it('makes the queen-and-king lesson a real mate in one', () => {
    const lesson = LESSONS.find((item) => item.id === 'mate')
    expect(lesson).toBeTruthy()
    const chess = new Chess(lesson?.fen)
    const move = chess.move({ from: 'b2', to: 'g7' })
    expect(move?.san).toBe('Qg7#')
    expect(chess.isCheckmate()).toBe(true)
  })
})
