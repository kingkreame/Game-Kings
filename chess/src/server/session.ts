import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { isEffectId, isPieceStyleId, isThemeId } from '../shared/themes.js'
import { isPremiumDifficulty, MAX_CREDITS, type Session, type SessionGame } from '../shared/types.js'

export const COOKIE_NAME = 'gkc_session'
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/

export function emptySession(): Session {
  return { v: 1, sid: randomBytes(16).toString('hex'), credits: 0, game: null }
}

function isGame(value: unknown): value is SessionGame {
  if (!value || typeof value !== 'object') return false
  const game = value as Record<string, unknown>
  if (typeof game.id !== 'string' || !/^[a-f0-9]{32}$/.test(game.id)) return false
  if (typeof game.difficulty !== 'string' || !isPremiumDifficulty(game.difficulty)) return false
  if (game.player !== 'w' && game.player !== 'b') return false
  if (!Array.isArray(game.moves) || game.moves.length > 500) return false
  if (!game.moves.every((move) => typeof move === 'string' && UCI.test(move))) return false
  if (typeof game.lastActivity !== 'number' || !Number.isFinite(game.lastActivity)) return false
  if (
    game.settled !== null &&
    game.settled !== 'win' &&
    game.settled !== 'loss' &&
    game.settled !== 'draw' &&
    game.settled !== 'resign' &&
    game.settled !== 'timeout'
  ) {
    return false
  }
  if (typeof game.theme !== 'string' || !isThemeId(game.theme)) return false
  if (typeof game.pieceStyle !== 'string' || !isPieceStyleId(game.pieceStyle)) return false
  if (typeof game.effect !== 'string' || !isEffectId(game.effect)) return false
  return true
}

export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false
  const session = value as Record<string, unknown>
  if (session.v !== 1) return false
  if (typeof session.sid !== 'string' || !/^[a-f0-9]{32}$/.test(session.sid)) return false
  if (!Number.isInteger(session.credits) || (session.credits as number) < 0 || (session.credits as number) > MAX_CREDITS) {
    return false
  }
  if (session.game === null) return true
  return isGame(session.game)
}

export function signSession(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  const token = `${payload}.${sig}`
  if (token.length > 3800) {
    throw new Error('Session is too large')
  }
  return token
}

export function readSession(token: string | undefined, secret: string): Session {
  if (!token || !secret) return emptySession()
  const dot = token.indexOf('.')
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return emptySession()
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  const got = Buffer.from(sig)
  const want = Buffer.from(expected)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return emptySession()
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!isSession(parsed)) return emptySession()
    return parsed
  } catch {
    return emptySession()
  }
}

export function sessionFromRequest(req: IncomingMessage, secret: string): Session {
  const header = req.headers.cookie
  if (!header) return emptySession()
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue
    let raw = part.slice(eq + 1).trim()
    try {
      raw = decodeURIComponent(raw)
    } catch {
      return emptySession()
    }
    return readSession(raw, secret)
  }
  return emptySession()
}

export function sessionCookie(session: Session, secret: string): string {
  const token = signSession(session, secret)
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=15552000`
}
