import { Chess, type Move } from 'chess.js'
import type { Color, DrawReason, PieceSymbol } from './types.js'

/**
 * Rules helper around chess.js (BSD-2-Clause, Jeff Hlywa).
 * https://github.com/jhlywa/chess.js
 */

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/

export interface ParsedUci {
  from: string
  to: string
  promotion?: string
}

export function parseUci(uci: string): ParsedUci | null {
  if (!UCI.test(uci)) return null
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  const promotion = uci[4]
  return promotion ? { from, to, promotion } : { from, to }
}

export function moveToUci(move: { from: string; to: string; promotion?: string }): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`
}

export function applyUci(chess: Chess, uci: string): Move | null {
  const parsed = parseUci(uci)
  if (!parsed) return null
  try {
    return chess.move(parsed)
  } catch {
    return null
  }
}

export function replayMoves(moves: readonly string[]): Chess | null {
  const chess = new Chess()
  for (const uci of moves) {
    if (!applyUci(chess, uci)) return null
  }
  return chess
}

export interface PositionStatus {
  turn: Color
  inCheck: boolean
  over: boolean
  checkmate: boolean
  winner: Color | null
  drawReason: DrawReason | null
}

export function positionStatus(chess: Chess): PositionStatus {
  const turn = chess.turn()
  const checkmate = chess.isCheckmate()
  let drawReason: DrawReason | null = null
  if (!checkmate && chess.isDraw()) {
    if (chess.isStalemate()) drawReason = 'stalemate'
    else if (chess.isThreefoldRepetition()) drawReason = 'threefold'
    else if (chess.isInsufficientMaterial()) drawReason = 'insufficient'
    else drawReason = 'fifty-move'
  }
  return {
    turn,
    inCheck: chess.isCheck(),
    over: chess.isGameOver(),
    checkmate,
    winner: checkmate ? (turn === 'w' ? 'b' : 'w') : null,
    drawReason,
  }
}

export function capturedBy(chess: Chess): { w: PieceSymbol[]; b: PieceSymbol[] } {
  const w: PieceSymbol[] = []
  const b: PieceSymbol[] = []
  for (const move of chess.history({ verbose: true })) {
    if (!move.captured) continue
    if (move.color === 'w') w.push(move.captured)
    else b.push(move.captured)
  }
  return { w, b }
}

export function kingSquare(chess: Chess, color: Color): string | null {
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) return cell.square
    }
  }
  return null
}

/** Drop the latest player move and any computer reply after it. */
export function undoPlayerPly(moves: readonly string[], player: Color): string[] | null {
  const chess = replayMoves(moves)
  if (!chess) return null
  const verbose = chess.history({ verbose: true })
  let idx = -1
  for (let i = verbose.length - 1; i >= 0; i--) {
    if (verbose[i].color === player) {
      idx = i
      break
    }
  }
  if (idx < 0) return null
  return moves.slice(0, idx)
}

export function epCapturedSquare(move: Move): string | null {
  if (!move.isEnPassant()) return null
  const rank = Number(move.to[1]) + (move.color === 'w' ? -1 : 1)
  return `${move.to[0]}${rank}`
}

export function castleRook(move: Move): { from: string; to: string } | null {
  const rank = move.from[1]
  if (move.isKingsideCastle()) return { from: `h${rank}`, to: `f${rank}` }
  if (move.isQueensideCastle()) return { from: `a${rank}`, to: `d${rank}` }
  return null
}

export function outcomeForPlayer(
  status: PositionStatus,
  player: Color,
): 'win' | 'loss' | 'draw' | null {
  if (!status.over) return null
  if (status.checkmate && status.winner) return status.winner === player ? 'win' : 'loss'
  return 'draw'
}
