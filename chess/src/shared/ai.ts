import { Chess, type Move } from 'chess.js'
import type { Difficulty, PieceSymbol } from './types.js'
import { moveToUci } from './game.js'

/**
 * Minimax with alpha-beta. Easy is a noisy 1-ply search used by the browser
 * worker. Medium, Hard, and Expert run on the server for premium games.
 */

const MATE = 29000

const MATERIAL: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
}

/** Piece-square tables from White's view. Index 0 is a1. */
const PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0,
  20, 20, 0, 0, 0, 5, 5, 10, 25, 25, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50,
  50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0,
]
const KNIGHT = [
  -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40, -30, 5, 10, 15, 15, 10,
  5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10, 0,
  -30, -40, -20, 0, 0, 0, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
]
const BISHOP = [
  -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
]
const ROOK = [
  0, 0, 5, 10, 10, 5, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0,
  0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0,
  0, 5, 5, 0, 0, 0,
]
const QUEEN = [
  -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0,
  5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
]
const KING = [
  20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20, -20, -20, -20, -20, -10,
  -20, -30, -30, -40, -40, -30, -30, -20, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40,
  -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40,
  -40, -30,
]

const TABLES: Record<PieceSymbol, number[]> = {
  p: PAWN,
  n: KNIGHT,
  b: BISHOP,
  r: ROOK,
  q: QUEEN,
  k: KING,
}

class AbortSearch extends Error {}

function mirror(index: number): number {
  const rank = Math.floor(index / 8)
  const file = index % 8
  return (7 - rank) * 8 + file
}

export function evaluateWhite(chess: Chess): number {
  const board = chess.board()
  let score = 0
  for (let rankFromTop = 0; rankFromTop < 8; rankFromTop++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[rankFromTop][file]
      if (!piece) continue
      const index = (7 - rankFromTop) * 8 + file
      const tableIndex = piece.color === 'w' ? index : mirror(index)
      const value = MATERIAL[piece.type] + TABLES[piece.type][tableIndex]
      score += piece.color === 'w' ? value : -value
    }
  }
  return score
}

function evaluateSide(chess: Chess): number {
  const white = evaluateWhite(chess)
  return chess.turn() === 'w' ? white : -white
}

function orderMoves(moves: Move[]): Move[] {
  return moves
    .map((move, index) => {
      let score = 0
      if (move.captured) score += 10 * MATERIAL[move.captured] - MATERIAL[move.piece]
      if (move.promotion) score += MATERIAL[move.promotion]
      if (move.isKingsideCastle() || move.isQueensideCastle()) score += 50
      return { move, score, index }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.move)
}

function play(chess: Chess, move: Move): void {
  chess.move({ from: move.from, to: move.to, promotion: move.promotion })
}

function negamax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  nodes: { n: number; cap: number },
  ply: number,
  useQuiescence: boolean,
): number {
  nodes.n++
  if (nodes.n > nodes.cap) throw new AbortSearch()
  if (chess.isDrawByFiftyMoves() || chess.isThreefoldRepetition()) return 0
  if (depth === 0) {
    return useQuiescence ? quiesce(chess, alpha, beta, 2, nodes, ply) : evaluateSide(chess)
  }
  const moves = orderMoves(chess.moves({ verbose: true }))
  if (moves.length === 0) return chess.isCheck() ? -MATE + ply : 0
  let best = -Infinity
  for (const move of moves) {
    play(chess, move)
    const score = -negamax(chess, depth - 1, -beta, -alpha, nodes, ply + 1, useQuiescence)
    chess.undo()
    if (score > best) best = score
    if (score > alpha) alpha = score
    if (alpha >= beta) break
  }
  return best
}

function quiesce(
  chess: Chess,
  alpha: number,
  beta: number,
  qdepth: number,
  nodes: { n: number; cap: number },
  ply: number,
): number {
  nodes.n++
  if (nodes.n > nodes.cap) throw new AbortSearch()
  if (chess.isDrawByFiftyMoves() || chess.isThreefoldRepetition()) return 0
  const stand = evaluateSide(chess)
  if (qdepth <= 0 || stand >= beta) return stand
  const captures = orderMoves(
    chess.moves({ verbose: true }).filter((move) => move.isCapture() || move.isPromotion()),
  )
  if (captures.length === 0 && chess.moves().length === 0) {
    return chess.isCheck() ? -MATE + ply : 0
  }
  if (stand > alpha) alpha = stand
  for (const move of captures) {
    play(chess, move)
    const score = -quiesce(chess, -beta, -alpha, qdepth - 1, nodes, ply + 1)
    chess.undo()
    if (score >= beta) return score
    if (score > alpha) alpha = score
  }
  return alpha
}

function searchRoot(chess: Chess, depth: number, useQuiescence: boolean, cap: number): string | null {
  const nodes = { n: 0, cap }
  const moves = orderMoves(chess.moves({ verbose: true }))
  if (moves.length === 0) return null
  let best = moves[0]
  let bestScore = -Infinity
  let alpha = -Infinity
  try {
    for (const move of moves) {
      play(chess, move)
      let score = 0
      try {
        score = -negamax(chess, depth - 1, -Infinity, -alpha, nodes, 1, useQuiescence)
      } finally {
        chess.undo()
      }
      if (score > bestScore) {
        bestScore = score
        best = move
      }
      if (score > alpha) alpha = score
    }
  } catch (error) {
    if (error instanceof AbortSearch) return null
    throw error
  }
  return moveToUci(best)
}

function easyChoose(chess: Chess, legal: Move[], rng: () => number): string {
  const nodes = { n: 0, cap: 4000 }
  const moves = orderMoves(legal)
  let best = moves[0]
  let bestScore = -Infinity
  let alpha = -Infinity
  const ranked: { move: Move; score: number }[] = []
  for (const move of moves) {
    play(chess, move)
    let score = 0
    try {
      score = -negamax(chess, 0, -Infinity, -alpha, nodes, 1, false)
    } finally {
      chess.undo()
    }
    score += rng() * 70 - 35
    ranked.push({ move, score })
    if (score > bestScore) {
      bestScore = score
      best = move
    }
    if (score > alpha) alpha = score
  }
  if (rng() < 0.3) {
    ranked.sort((a, b) => b.score - a.score)
    const pool = ranked.slice(0, Math.min(4, ranked.length))
    return moveToUci(pool[Math.floor(rng() * pool.length)].move)
  }
  return moveToUci(best)
}

export function chooseAiMove(
  fen: string,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): string | null {
  let chess: Chess
  try {
    chess = new Chess(fen)
  } catch {
    return null
  }
  const legal = chess.moves({ verbose: true })
  if (legal.length === 0) return null
  if (difficulty === 'easy') return easyChoose(chess, legal, rng)
  // Fallback when Stockfish is unavailable. Expert and Game King share the deepest light search.
  const maxDepth = difficulty === 'medium' ? 2 : difficulty === 'hard' ? 3 : 4
  const useQuiescence = difficulty === 'expert' || difficulty === 'master'
  const cap = difficulty === 'expert' || difficulty === 'master' ? 16000 : 10000
  let best = moveToUci(orderMoves(legal)[0])
  for (let depth = 1; depth <= maxDepth; depth++) {
    const found = searchRoot(chess, depth, useQuiescence, cap)
    if (!found) break
    best = found
  }
  return best
}
