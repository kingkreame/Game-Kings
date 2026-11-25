import { existsSync } from 'node:fs'
import path from 'node:path'
import { Chess } from 'chess.js'
import { afterAll, describe, expect, it } from 'vitest'
import { acceptEngineMove } from '../src/shared/engine.js'
import { searchStockfish, stopStockfish } from '../src/server/stockfish.js'

describe('stockfish wasm', () => {
  afterAll(() => {
    stopStockfish()
  })

  it('returns a legal move from the opening within the time cap', async () => {
    expect(existsSync(path.resolve('public/engine/stockfish-19-lite-single.cjs'))).toBe(true)
    expect(existsSync(path.resolve('public/engine/stockfish-19-lite-single.wasm'))).toBe(true)
    const fen = new Chess().fen()
    const uci = await searchStockfish(fen, { skill: 20, depth: 8, movetime: 200 })
    expect(acceptEngineMove(fen, uci)).toBe(uci)
  }, 15000)
})
