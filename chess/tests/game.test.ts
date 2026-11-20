import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { applyUci, positionStatus, replayMoves, undoPlayerPly } from '../src/shared/game.js'

function play(moves: string[], fen?: string): Chess {
  const chess = fen ? new Chess(fen) : new Chess()
  for (const uci of moves) {
    const move = applyUci(chess, uci)
    expect(move, uci).not.toBeNull()
  }
  return chess
}

describe('game state', () => {
  it('starts at the standard position and rejects an illegal move', () => {
    const chess = new Chess()
    const start = chess.fen()
    expect(applyUci(chess, 'e2e5')).toBeNull()
    expect(chess.fen()).toBe(start)
    expect(applyUci(chess, 'e2e4')?.san).toBe('e4')
    expect(chess.history()).toEqual(['e4'])
  })

  it('castles and moves the rook', () => {
    const chess = play(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1'])
    expect(chess.get('g1')?.type).toBe('k')
    expect(chess.get('f1')?.type).toBe('r')
    expect(chess.get('e1')).toBeUndefined()
    expect(chess.get('h1')).toBeUndefined()
    expect(chess.history()).toContain('O-O')
  })

  it('plays en passant', () => {
    const chess = play(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6'])
    expect(chess.get('d6')?.type).toBe('p')
    expect(chess.get('d5')).toBeUndefined()
    expect(chess.get('e5')).toBeUndefined()
  })

  it('requires a promotion piece and promotes', () => {
    const blocked = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1')
    expect(applyUci(blocked, 'a7a8')).toBeNull()
    const chess = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1')
    expect(applyUci(chess, 'a7a8q')?.promotion).toBe('q')
    expect(chess.get('a8')?.type).toBe('q')
    const knight = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1')
    expect(applyUci(knight, 'a7a8n')?.promotion).toBe('n')
  })

  it('detects check, checkmate, stalemate, and draws', () => {
    const check = play(['d2d8'], '7k/8/8/8/8/8/3Q4/3K4 w - - 0 1')
    expect(positionStatus(check)).toMatchObject({ inCheck: true, checkmate: false, over: false })

    const mate = play(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'])
    expect(positionStatus(mate)).toMatchObject({ checkmate: true, winner: 'w', over: true })

    const stale = new Chess('k7/8/1QK5/8/8/8/8/8 b - - 0 1')
    expect(positionStatus(stale).drawReason).toBe('stalemate')

    const bare = new Chess('8/8/8/8/8/4k3/8/4K3 w - - 0 1')
    expect(positionStatus(bare).drawReason).toBe('insufficient')

    const fifty = new Chess('8/8/8/4k3/8/4P3/4K3/8 w - - 100 80')
    expect(positionStatus(fifty).drawReason).toBe('fifty-move')

    const repeated = play(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'])
    expect(positionStatus(repeated).drawReason).toBe('threefold')
  })

  it('undoes to the previous player move and keeps the move list', () => {
    const chess = play(['e2e4', 'e7e5', 'g1f3'])
    expect(chess.history()).toEqual(['e4', 'e5', 'Nf3'])
    chess.undo()
    expect(chess.history()).toEqual(['e4', 'e5'])
    const undone = undoPlayerPly(['e2e4', 'e7e5', 'g1f3', 'b8c6'], 'w')
    expect(undone).toEqual(['e2e4', 'e7e5'])
    expect(replayMoves(undone ?? [])?.history()).toEqual(['e4', 'e5'])
  })
})
