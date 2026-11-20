import { randomBytes } from 'node:crypto'
import { Chess } from 'chess.js'
import { chooseAiMove } from '../shared/ai.js'
import {
  applyUci,
  capturedBy,
  moveToUci,
  outcomeForPlayer,
  positionStatus,
  replayMoves,
  undoPlayerPly,
} from '../shared/game.js'
import type {
  Color,
  EffectPackId,
  GameView,
  PieceStyleId,
  PremiumDifficulty,
  Session,
  SettleResult,
  ThemeId,
} from '../shared/types.js'
import { IDLE_MS, MAX_CREDITS } from '../shared/types.js'
import { HttpError } from './errors.js'

export type AiChooser = (fen: string, difficulty: PremiumDifficulty) => string | null

const winsGranted = new Set<string>()

export function resetPremiumMemory(): void {
  winsGranted.clear()
}

export function expireIfIdle(session: Session, now: number): boolean {
  const game = session.game
  if (!game || game.settled) return false
  if (now - game.lastActivity <= IDLE_MS) return false
  game.settled = 'timeout'
  return true
}

function settlePosition(session: Session, fenReady: Chess): void {
  const game = session.game
  if (!game || game.settled) return
  const outcome = outcomeForPlayer(positionStatus(fenReady), game.player)
  if (!outcome) return
  if (outcome === 'win' && !winsGranted.has(game.id)) {
    winsGranted.add(game.id)
    session.credits = Math.min(MAX_CREDITS, session.credits + 1)
  }
  game.settled = outcome
}

function pushAi(chess: Chess, gameDifficulty: PremiumDifficulty, choose: AiChooser): string {
  const uci = choose(chess.fen(), gameDifficulty)
  if (!uci || !applyUci(chess, uci)) {
    throw new HttpError(500, 'The computer could not move.')
  }
  return uci
}

export function viewGame(session: Session): GameView | null {
  const game = session.game
  if (!game) return null
  const chess = replayMoves(game.moves)
  if (!chess) return null
  const status = positionStatus(chess)
  const verbose = chess.history({ verbose: true })
  const last = verbose[verbose.length - 1]
  const playable = !game.settled && !status.over && status.turn === game.player
  return {
    id: game.id,
    fen: chess.fen(),
    turn: status.turn,
    player: game.player,
    difficulty: game.difficulty,
    movesSan: chess.history(),
    movesUci: [...game.moves],
    inCheck: status.inCheck && !status.over,
    over: Boolean(game.settled) || status.over,
    result: game.settled,
    winner: status.winner,
    drawReason: status.drawReason,
    lastMove: last ? { from: last.from, to: last.to } : null,
    legal: playable ? chess.moves({ verbose: true }).map((move) => moveToUci(move)) : [],
    theme: game.theme,
    pieceStyle: game.pieceStyle,
    effect: game.effect,
    captured: capturedBy(chess),
  }
}

export interface StartInput {
  difficulty: PremiumDifficulty
  player: Color
  theme: ThemeId
  pieceStyle: PieceStyleId
  effect: EffectPackId
}

export function startPremium(session: Session, input: StartInput, now: number, choose: AiChooser): string[] {
  expireIfIdle(session, now)
  if (session.game && !session.game.settled) {
    throw new HttpError(409, 'Finish or resign the current premium game first.')
  }
  if (session.credits < 1) throw new HttpError(402, 'You need a premium credit for this game.')
  session.credits -= 1
  const applied: string[] = []
  session.game = {
    id: randomBytes(16).toString('hex'),
    difficulty: input.difficulty,
    player: input.player,
    moves: [],
    lastActivity: now,
    settled: null,
    theme: input.theme,
    pieceStyle: input.pieceStyle,
    effect: input.effect,
  }
  if (input.player === 'b') {
    const chess = new Chess()
    const uci = pushAi(chess, input.difficulty, choose)
    session.game.moves.push(uci)
    applied.push(uci)
    settlePosition(session, chess)
  }
  return applied
}

export function playPremiumMove(session: Session, uci: string, now: number, choose: AiChooser): string[] {
  const game = session.game
  if (!game) throw new HttpError(409, 'No premium game is in progress.')
  if (expireIfIdle(session, now) || game.settled === 'timeout') return []
  if (game.settled) throw new HttpError(409, 'This premium game is already over.')
  const chess = replayMoves(game.moves)
  if (!chess) throw new HttpError(400, 'This game could not be read.')
  if (chess.turn() !== game.player) throw new HttpError(409, 'It is not your turn.')
  if (!applyUci(chess, uci)) throw new HttpError(400, 'That move is not legal.')
  const applied = [uci]
  game.moves = [...game.moves, uci]
  game.lastActivity = now
  if (!chess.isGameOver()) {
    const reply = pushAi(chess, game.difficulty, choose)
    game.moves = [...game.moves, reply]
    applied.push(reply)
  }
  settlePosition(session, chess)
  return applied
}

export function resignPremium(session: Session, now: number): void {
  const game = session.game
  if (!game) throw new HttpError(409, 'No premium game is in progress.')
  if (expireIfIdle(session, now)) return
  if (game.settled) return
  game.settled = 'resign' satisfies SettleResult
  game.lastActivity = now
}

export function undoPremium(session: Session, now: number): void {
  const game = session.game
  if (!game) throw new HttpError(409, 'No premium game is in progress.')
  if (expireIfIdle(session, now) || game.settled === 'timeout') return
  if (game.settled) throw new HttpError(409, 'This premium game is already over.')
  const next = undoPlayerPly(game.moves, game.player)
  if (!next) throw new HttpError(400, 'Nothing to undo.')
  game.moves = next
  game.lastActivity = now
}

export function restylePremium(
  session: Session,
  look: { theme: ThemeId; pieceStyle: PieceStyleId; effect: EffectPackId },
  now: number,
): void {
  const game = session.game
  if (!game) throw new HttpError(409, 'No premium game is in progress.')
  if (expireIfIdle(session, now) || game.settled === 'timeout') return
  if (game.settled) throw new HttpError(409, 'This premium game is already over.')
  game.theme = look.theme
  game.pieceStyle = look.pieceStyle
  game.effect = look.effect
  game.lastActivity = now
}

export function defaultChooser(fen: string, difficulty: PremiumDifficulty): string | null {
  return chooseAiMove(fen, difficulty)
}
