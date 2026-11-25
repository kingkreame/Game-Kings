import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import {
  ENGINE_LEVELS,
  HINT_LIMIT,
  acceptEngineMove,
  describeEngineHint,
  describeEngineMove,
  limitsAreOrdered,
  readBestMove,
  readInfoScore,
} from '../src/shared/engine.js'
import { applyUci } from '../src/shared/game.js'

describe('engine levels', () => {
  it('keeps Easy off Stockfish and ranks the paid levels up to Game King', () => {
    expect(ENGINE_LEVELS.easy.stockfish).toBeNull()
    expect(ENGINE_LEVELS.easy.premium).toBe(false)
    expect(ENGINE_LEVELS.master.name).toBe('Game King')
    expect(ENGINE_LEVELS.master.premium).toBe(true)
    expect(limitsAreOrdered()).toBe(true)
    expect(HINT_LIMIT.movetime).toBeLessThanOrEqual(3000)
    expect(HINT_LIMIT.skill).toBe(20)
    for (const level of [ENGINE_LEVELS.medium, ENGINE_LEVELS.hard, ENGINE_LEVELS.expert, ENGINE_LEVELS.master]) {
      expect(level.stockfish?.movetime).toBeLessThanOrEqual(3000)
    }
  })
})

describe('engine moves', () => {
  const fen = new Chess().fen()

  it('accepts a legal engine move and rejects an illegal one', () => {
    expect(acceptEngineMove(fen, 'e2e4')).toBe('e2e4')
    expect(acceptEngineMove(fen, 'bestmove e2e4 ponder e7e5'.includes('e2e4') ? 'e2e4' : '')).toBe('e2e4')
    expect(acceptEngineMove(fen, 'e2e5')).toBeNull()
    expect(acceptEngineMove(fen, '(none)')).toBeNull()
    expect(acceptEngineMove(fen, 'e7e8q')).toBeNull()
    const played = acceptEngineMove(fen, 'e2e4')
    expect(played && applyUci(new Chess(fen), played)?.san).toBe('e4')
  })

  it('reads UCI scores and best moves', () => {
    expect(readInfoScore('info depth 8 score cp 34 pv e2e4')).toEqual({ cp: 34, mate: null })
    expect(readInfoScore('info depth 8 score mate -2 pv e7e5')).toEqual({ cp: null, mate: -2 })
    expect(readInfoScore('info depth 8 score cp 10 lowerbound pv e2e4')).toBeNull()
    expect(readBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4')
    expect(readBestMove('bestmove (none)')).toBeNull()
  })

  it('explains a best move, a close move, and a mistake', () => {
    expect(
      describeEngineMove({
        playedUci: 'e2e4',
        bestUci: 'e2e4',
        playedSan: 'e4',
        bestSan: 'e4',
        bestCp: 30,
        playedCp: 30,
        bestMate: null,
        playedMate: null,
      }).done,
    ).toBe(true)
    expect(
      describeEngineMove({
        playedUci: 'd2d4',
        bestUci: 'e2e4',
        playedSan: 'd4',
        bestSan: 'e4',
        bestCp: 30,
        playedCp: 10,
        bestMate: null,
        playedMate: null,
      }).done,
    ).toBe(true)
    const miss = describeEngineMove({
      playedUci: 'a2a4',
      bestUci: 'e2e4',
      playedSan: 'a4',
      bestSan: 'e4',
      bestCp: 40,
      playedCp: -180,
      bestMate: null,
      playedMate: null,
    })
    expect(miss.done).toBe(false)
    expect(miss.text).toContain('e4')
    expect(describeEngineHint('Nf3', 40, null)).toContain('+0.4')
    expect(describeEngineHint('Qg7', null, 1)).toContain('mate in 1')
  })
})
