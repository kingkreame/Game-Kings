export type Color = 'w' | 'b'
export type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'
export type PremiumDifficulty = Exclude<Difficulty, 'easy'>
export type ThemeId = 'classic' | 'amethyst' | 'emerald' | 'rose'
export type PieceStyleId = 'classic' | 'line' | 'stained' | 'marble'
export type EffectPackId = 'core' | 'lightning' | 'coins'
export type SettleResult = 'win' | 'loss' | 'draw' | 'resign' | 'timeout'
export type DrawReason = 'stalemate' | 'threefold' | 'insufficient' | 'fifty-move'

export const PREMIUM_DIFFICULTIES: readonly PremiumDifficulty[] = ['medium', 'hard', 'expert']
export const IDLE_MS = 30 * 60 * 1000
export const MAX_CREDITS = 20
export const TERMS =
  '$4.99 per premium game. Win and your next game is free. No cash prizes. Play money only.'

export interface SessionGame {
  id: string
  difficulty: PremiumDifficulty
  player: Color
  moves: string[]
  lastActivity: number
  settled: SettleResult | null
  theme: ThemeId
  pieceStyle: PieceStyleId
  effect: EffectPackId
}

export interface Session {
  v: 1
  sid: string
  credits: number
  game: SessionGame | null
}

export interface GameView {
  id: string
  fen: string
  turn: Color
  player: Color
  difficulty: PremiumDifficulty
  movesSan: string[]
  movesUci: string[]
  inCheck: boolean
  over: boolean
  result: SettleResult | null
  winner: Color | null
  drawReason: DrawReason | null
  lastMove: { from: string; to: string } | null
  legal: string[]
  theme: ThemeId
  pieceStyle: PieceStyleId
  effect: EffectPackId
  captured: { w: PieceSymbol[]; b: PieceSymbol[] }
}

export interface PassStatus {
  ok: true
  gateEnabled: boolean
  comingSoon: boolean
  priceLabel: string
  checkoutUrl: string
  terms: string
  credits: number
  game: GameView | null
}
