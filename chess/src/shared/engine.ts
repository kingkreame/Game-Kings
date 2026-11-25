import { Chess } from 'chess.js'
import { applyUci } from './game.js'
import type { Difficulty } from './types.js'

/**
 * Stockfish 19 lite, single-threaded. GPL-3.0.
 * Source: https://github.com/official-stockfish/Stockfish
 * WASM port: https://github.com/nmrugg/stockfish.js
 *
 * Easy stays on the small built-in search so a free game stays beatable and
 * does not load the engine. Higher levels use Stockfish with a rising skill,
 * depth, and time cap. Nothing thinks longer than a few seconds.
 */
export interface StockfishLimit {
  skill: number
  depth: number
  movetime: number
}

export interface EngineLevel {
  id: Difficulty
  name: string
  premium: boolean
  stockfish: StockfishLimit | null
}

export const ENGINE_LEVELS: Record<Difficulty, EngineLevel> = {
  easy: { id: 'easy', name: 'Easy', premium: false, stockfish: null },
  medium: { id: 'medium', name: 'Medium', premium: true, stockfish: { skill: 2, depth: 6, movetime: 350 } },
  hard: { id: 'hard', name: 'Hard', premium: true, stockfish: { skill: 8, depth: 10, movetime: 700 } },
  expert: { id: 'expert', name: 'Expert', premium: true, stockfish: { skill: 16, depth: 14, movetime: 1400 } },
  master: { id: 'master', name: 'Game King', premium: true, stockfish: { skill: 20, depth: 20, movetime: 2500 } },
}

/** Hints and lesson grades use a full-skill search, capped so the phone stays responsive. */
export const HINT_LIMIT: StockfishLimit = { skill: 20, depth: 16, movetime: 900 }

const MOVE_TIME_CAP = 3000
const CLOSE_CP = 40

export function stockfishLimit(level: Difficulty): StockfishLimit | null {
  return ENGINE_LEVELS[level].stockfish
}

/** Keep an engine move only when it is legal in the position. */
export function acceptEngineMove(fen: string, uci: string | null | undefined): string | null {
  if (!uci) return null
  const token = uci.trim().split(/\s+/)[0] ?? ''
  if (token === '(none)' || token === '0000') return null
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)) return null
  try {
    const chess = new Chess(fen)
    return applyUci(chess, token) ? token : null
  } catch {
    return null
  }
}

export function readInfoScore(line: string): { cp: number | null; mate: number | null } | null {
  if (!line.startsWith('info ') || line.includes(' lowerbound') || line.includes(' upperbound')) return null
  const mate = / score mate (-?\d+)/.exec(line)
  if (mate) return { cp: null, mate: Number(mate[1]) }
  const cp = / score cp (-?\d+)/.exec(line)
  if (cp) return { cp: Number(cp[1]), mate: null }
  return null
}

export function readBestMove(line: string): string | null {
  const match = /^bestmove (\S+)/.exec(line.trim())
  if (!match) return null
  const move = match[1] ?? ''
  if (!move || move === '(none)' || move === '0000') return null
  return move
}

export function formatScore(cp: number | null, mate: number | null): string {
  if (mate !== null) {
    if (mate > 0) return `mate in ${mate}`
    if (mate < 0) return `mate against in ${Math.abs(mate)}`
    return 'mate'
  }
  if (cp === null) return ''
  const pawns = cp / 100
  const sign = pawns > 0 ? '+' : ''
  return `${sign}${pawns.toFixed(1)}`
}

export function describeEngineHint(bestSan: string, cp: number | null, mate: number | null): string {
  const score = formatScore(cp, mate)
  return score ? `Stockfish: ${bestSan} is the best move (${score}).` : `Stockfish: ${bestSan} is the best move.`
}

export function describeEngineMove(input: {
  playedUci: string
  bestUci: string
  playedSan: string
  bestSan: string
  bestCp: number | null
  playedCp: number | null
  bestMate: number | null
  playedMate: number | null
}): { done: boolean; text: string } {
  const bestLabel = formatScore(input.bestCp, input.bestMate)
  const playedLabel = formatScore(input.playedCp, input.playedMate)
  if (input.playedUci === input.bestUci) {
    return {
      done: true,
      text: `Stockfish agrees: ${input.playedSan} is the best move${bestLabel ? ` (${bestLabel})` : ''}.`,
    }
  }
  if (
    input.bestMate !== null &&
    input.bestMate > 0 &&
    input.playedMate !== null &&
    input.playedMate > 0 &&
    input.playedMate <= input.bestMate + 1
  ) {
    return { done: true, text: `That also mates. Stockfish's fastest is ${input.bestSan} (${bestLabel}).` }
  }
  if (input.bestCp !== null && input.playedCp !== null) {
    const loss = input.bestCp - input.playedCp
    if (loss <= CLOSE_CP) {
      return {
        done: true,
        text: `Close. Stockfish prefers ${input.bestSan} (${bestLabel}). ${input.playedSan} is ${playedLabel}.`,
      }
    }
    return {
      done: false,
      text: `Stockfish wanted ${input.bestSan} (${bestLabel}). ${input.playedSan} leaves ${playedLabel}.`,
    }
  }
  return {
    done: false,
    text: `Stockfish wanted ${input.bestSan}${bestLabel ? ` (${bestLabel})` : ''}.`,
  }
}

export function limitsAreOrdered(): boolean {
  const ladder = [ENGINE_LEVELS.medium, ENGINE_LEVELS.hard, ENGINE_LEVELS.expert, ENGINE_LEVELS.master]
  for (const level of ladder) {
    if (!level.stockfish) return false
    if (level.stockfish.movetime > MOVE_TIME_CAP || level.stockfish.movetime < 1) return false
    if (level.stockfish.skill < 0 || level.stockfish.skill > 20) return false
  }
  for (let i = 1; i < ladder.length; i++) {
    const prev = ladder[i - 1]?.stockfish
    const next = ladder[i]?.stockfish
    if (!prev || !next) return false
    if (next.skill < prev.skill || next.movetime < prev.movetime || next.depth < prev.depth) return false
  }
  return ENGINE_LEVELS.easy.stockfish === null && ENGINE_LEVELS.master.stockfish?.skill === 20
}
