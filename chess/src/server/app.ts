import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { isEffectId, isPieceStyleId, isThemeId } from '../shared/themes.js'
import {
  TERMS,
  type Color,
  type EffectPackId,
  type PassStatus,
  type PieceStyleId,
  isPremiumDifficulty,
  type PremiumDifficulty,
  type Session,
  type ThemeId,
} from '../shared/types.js'
import { HttpError } from './errors.js'
import { verifyLicense } from './gumroad.js'
import { lockLicense, lockSession } from './lock.js'
import {
  defaultChooser,
  expireIfIdle,
  playPremiumMove,
  resignPremium,
  restylePremium,
  startPremium,
  undoPremium,
  viewGame,
  type AiChooser,
} from './premium.js'
import { COOKIE_NAME, sessionCookie, sessionFromRequest } from './session.js'

export interface AppConfig {
  gateEnabled: boolean
  checkoutUrl: string
  productId: string
  priceLabel: string
  sessionSecret: string
  clientDir: string
  fetchImpl?: typeof fetch
  now?: () => number
  chooseAiMove?: AiChooser
  unlockLimit?: number
  unlockWindowMs?: number
}

const BANNED_FIELDS = ['result', 'winner', 'credits', 'settled', 'fen', 'moves', 'outcome', 'status']

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

interface Bucket {
  n: number
  reset: number
}

function securityHeaders(req: IncomingMessage, res: ServerResponse): void {
  const forwarded = String(req.headers['x-forwarded-proto'] || '')
  const secure =
    forwarded.split(',')[0].trim() === 'https' ||
    Boolean((req.socket as { encrypted?: boolean }).encrypted)
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ]
  if (secure) policy.push('upgrade-insecure-requests')
  res.setHeader('Content-Security-Policy', policy.join('; '))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
}

function displayPrice(raw: string): string {
  const trimmed = raw.trim().slice(0, 40)
  return trimmed || '$4.99'
}

function safeHttpUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return url.toString()
  } catch {
    return ''
  }
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim().slice(0, 80)
  return req.socket.remoteAddress || 'unknown'
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !origin || origin === 'null') return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  const forwardedHost = req.headers['x-forwarded-host']
  const host = String((typeof forwardedHost === 'string' && forwardedHost) || req.headers.host || '')
    .split(',')[0]
    .trim()
  return Boolean(host) && url.host === host
}

function allow(buckets: Map<string, Bucket>, key: string, limit: number, windowMs: number, now: number): boolean {
  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.reset) {
    buckets.set(key, { n: 1, reset: now + windowMs })
    return true
  }
  if (bucket.n >= limit) return false
  bucket.n += 1
  return true
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buf.length
    if (size > 8192) throw new HttpError(413, 'Body too large.')
    chunks.push(buf)
  }
  if (size === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'Invalid JSON.')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'Invalid JSON.')
  }
}

function rejectClientResult(body: Record<string, unknown>): void {
  for (const field of BANNED_FIELDS) {
    if (field in body) throw new HttpError(400, 'Client result is not accepted.')
  }
}

function asDifficulty(value: unknown): PremiumDifficulty | null {
  if (typeof value === 'string' && isPremiumDifficulty(value)) return value
  return null
}

function asColor(value: unknown, fallback: Color): Color | null {
  if (value === undefined) return fallback
  if (value === 'w' || value === 'b') return value
  return null
}

function asChoice<T extends string>(value: unknown, fallback: T, check: (id: string) => id is T): T | null {
  if (value === undefined) return fallback
  if (typeof value === 'string' && check(value)) return value
  return null
}

function normalizeKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (key.length < 6 || key.length > 80) return null
  if (!/^[A-Za-z0-9-]+$/.test(key)) return null
  return key
}

function sendJson(res: ServerResponse, status: number, body: unknown, cookie?: string): void {
  if (cookie) res.setHeader('Set-Cookie', cookie)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function serveStatic(res: ServerResponse, clientDir: string, pathname: string): Promise<void> {
  let rel = 'index.html'
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  } catch {
    sendJson(res, 400, { error: 'Bad path.' })
    return
  }
  if (!rel || rel.includes('\0')) {
    sendJson(res, 400, { error: 'Bad path.' })
    return
  }
  const root = path.resolve(clientDir)
  const resolved = path.resolve(root, rel)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    sendJson(res, 403, { error: 'Forbidden.' })
    return
  }
  let target = resolved
  let found = false
  try {
    const info = await stat(target)
    if (info.isDirectory()) target = path.join(target, 'index.html')
    found = true
  } catch {
    found = false
  }
  if (!found) {
    if (path.extname(rel)) {
      sendJson(res, 404, { error: 'Not found.' })
      return
    }
    target = path.join(root, 'index.html')
  }
  try {
    await stat(target)
  } catch {
    sendJson(res, 404, { error: 'Not found.' })
    return
  }
  const ext = path.extname(target)
  const cache = ext === '.html' ? 'no-cache' : 'public, max-age=86400'
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cache,
  })
  createReadStream(target).pipe(res)
}

export function createApp(config: AppConfig): Server {
  const now = config.now ?? (() => Date.now())
  const choose: AiChooser = config.chooseAiMove ?? defaultChooser
  const fetchImpl = config.fetchImpl ?? fetch
  const unlockLimit = config.unlockLimit ?? 5
  const unlockWindow = config.unlockWindowMs ?? 10 * 60 * 1000
  const unlockBuckets = new Map<string, Bucket>()
  const postBuckets = new Map<string, Bucket>()
  const price = displayPrice(config.priceLabel)
  const checkout = safeHttpUrl(config.checkoutUrl)

  function lockedStatus(): PassStatus {
    return {
      ok: true,
      gateEnabled: false,
      comingSoon: true,
      priceLabel: price,
      checkoutUrl: '',
      terms: TERMS,
      credits: 0,
      game: null,
    }
  }

  return createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'Something went wrong.'
      if (!(error instanceof HttpError)) console.error('request failed')
      sendJson(res, status, { error: message })
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    securityHeaders(req, res)
    const url = new URL(req.url || '/', 'http://localhost')
    const pathname = url.pathname
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true })
      return
    }
    if (req.method === 'GET' && pathname === '/api/pass/status') {
      await sendStatus(req, res)
      return
    }
    if (req.method === 'POST' && pathname.startsWith('/api/')) {
      if (!originAllowed(req)) throw new HttpError(403, 'Origin is not allowed.')
      const type = String(req.headers['content-type'] || '')
      if (!type.includes('application/json')) throw new HttpError(415, 'Use application/json.')
      const ip = clientIp(req)
      const stamp = now()
      if (pathname === '/api/pass/unlock') {
        if (!allow(unlockBuckets, ip, unlockLimit, unlockWindow, stamp)) {
          throw new HttpError(429, 'Too many unlock attempts. Wait and try again.')
        }
        await unlock(req, res)
        return
      }
      if (!allow(postBuckets, `${ip}:${pathname}`, 60, 60_000, stamp)) {
        throw new HttpError(429, 'Too many requests.')
      }
      if (pathname === '/api/game/start') return start(req, res)
      if (pathname === '/api/game/move') return move(req, res)
      if (pathname === '/api/game/resign') return resign(req, res)
      if (pathname === '/api/game/undo') return undo(req, res)
      if (pathname === '/api/game/look') return look(req, res)
      throw new HttpError(404, 'Not found.')
    }
    if (req.method === 'GET') {
      await serveStatic(res, config.clientDir, pathname)
      return
    }
    throw new HttpError(405, 'Method not allowed.')
  }

  function requireGate(): void {
    if (!config.gateEnabled) throw new HttpError(403, 'Premium games are coming soon.')
  }

  function requireSecret(): void {
    if (!config.sessionSecret || config.sessionSecret.length < 16) {
      throw new HttpError(503, 'Premium games are not configured.')
    }
  }

  function writeSession(session: Session): string {
    return sessionCookie(session, config.sessionSecret)
  }

  async function sendStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!config.gateEnabled) {
      sendJson(res, 200, lockedStatus())
      return
    }
    requireSecret()
    if (!req.headers.cookie?.includes(COOKIE_NAME)) {
      sendJson(res, 200, {
        ok: true,
        gateEnabled: true,
        comingSoon: false,
        priceLabel: price,
        checkoutUrl: checkout,
        terms: TERMS,
        credits: 0,
        game: null,
      })
      return
    }
    const incoming = sessionFromRequest(req, config.sessionSecret)
    const stamp = now()
    const next = await lockSession(incoming, async (current) => {
      expireIfIdle(current, stamp)
      return current
    })
    const body: PassStatus = {
      ok: true,
      gateEnabled: true,
      comingSoon: false,
      priceLabel: price,
      checkoutUrl: checkout,
      terms: TERMS,
      credits: next.credits,
      game: viewGame(next),
    }
    const changed = JSON.stringify(incoming.game) !== JSON.stringify(next.game) || incoming.credits !== next.credits
    sendJson(res, 200, body, changed ? writeSession(next) : undefined)
  }

  async function unlock(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requireGate()
    requireSecret()
    if (!config.productId) throw new HttpError(503, 'Premium games are not configured.')
    const body = await readJson(req)
    rejectClientResult(body)
    const licenseKey = normalizeKey(body.licenseKey)
    if (!licenseKey) throw new HttpError(400, 'Enter the license key from your purchase.')
    const incoming = sessionFromRequest(req, config.sessionSecret)
    const keyHash = createHash('sha256').update(licenseKey).digest('hex')
    const saved = await lockSession(incoming, async (current) => {
      if (current.credits >= 20) {
        throw new HttpError(409, 'Play your current credits before redeeming another key.')
      }
      let reason = 'License could not be verified.'
      let accepted = false
      await lockLicense(keyHash, async () => {
        const verdict = await verifyLicense({ productId: config.productId, licenseKey, fetchImpl })
        accepted = verdict.ok
        reason = verdict.reason
      })
      if (!accepted) throw new HttpError(400, reason)
      current.credits += 1
      return current
    })
    sendJson(
      res,
      200,
      { ok: true, credits: saved.credits, terms: TERMS, priceLabel: price },
      writeSession(saved),
    )
  }

  async function start(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requireGate()
    requireSecret()
    const body = await readJson(req)
    rejectClientResult(body)
    const difficulty = asDifficulty(body.difficulty)
    const player = asColor(body.player, 'w')
    const theme = asChoice(body.theme, 'classic' as ThemeId, isThemeId)
    const pieceStyle = asChoice(body.pieceStyle, 'classic' as PieceStyleId, isPieceStyleId)
    const effect = asChoice(body.effect, 'core' as EffectPackId, isEffectId)
    if (!difficulty || !player || !theme || !pieceStyle || !effect) {
      throw new HttpError(400, 'Choose a premium difficulty to start.')
    }
    const incoming = sessionFromRequest(req, config.sessionSecret)
    const stamp = now()
    let applied: string[] = []
    const next = await lockSession(incoming, async (current) => {
      applied = await startPremium(current, { difficulty, player, theme, pieceStyle, effect }, stamp, choose)
      return current
    })
    sendJson(
      res,
      200,
      { ok: true, credits: next.credits, applied, game: viewGame(next), terms: TERMS },
      writeSession(next),
    )
  }

  async function move(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requireGate()
    requireSecret()
    const body = await readJson(req)
    rejectClientResult(body)
    if (typeof body.uci !== 'string' || typeof body.gameId !== 'string') {
      throw new HttpError(400, 'Missing move.')
    }
    const incoming = sessionFromRequest(req, config.sessionSecret)
    if (!incoming.game || incoming.game.id !== body.gameId) {
      throw new HttpError(409, 'That premium game is not active.')
    }
    const stamp = now()
    let applied: string[] = []
    const next = await lockSession(incoming, async (current) => {
      if (!current.game || current.game.id !== body.gameId) {
        throw new HttpError(409, 'That premium game is not active.')
      }
      applied = await playPremiumMove(current, body.uci as string, stamp, choose)
      return current
    })
    sendJson(
      res,
      200,
      { ok: true, credits: next.credits, applied, game: viewGame(next) },
      writeSession(next),
    )
  }

  async function resign(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requireGate()
    requireSecret()
    const body = await readJson(req)
    rejectClientResult(body)
    const incoming = sessionFromRequest(req, config.sessionSecret)
    const stamp = now()
    const next = await lockSession(incoming, async (current) => {
      if (body.gameId && current.game && current.game.id !== body.gameId) {
        throw new HttpError(409, 'That premium game is not active.')
      }
      resignPremium(current, stamp)
      return current
    })
    sendJson(res, 200, { ok: true, credits: next.credits, game: viewGame(next) }, writeSession(next))
  }

  async function undo(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requireGate()
    requireSecret()
    const body = await readJson(req)
    rejectClientResult(body)
    const incoming = sessionFromRequest(req, config.sessionSecret)
    const stamp = now()
    const next = await lockSession(incoming, async (current) => {
      if (body.gameId && current.game && current.game.id !== body.gameId) {
        throw new HttpError(409, 'That premium game is not active.')
      }
      undoPremium(current, stamp)
      return current
    })
    sendJson(res, 200, { ok: true, credits: next.credits, game: viewGame(next) }, writeSession(next))
  }

  async function look(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requireGate()
    requireSecret()
    const body = await readJson(req)
    rejectClientResult(body)
    const theme = asChoice(body.theme, 'classic' as ThemeId, isThemeId)
    const pieceStyle = asChoice(body.pieceStyle, 'classic' as PieceStyleId, isPieceStyleId)
    const effect = asChoice(body.effect, 'core' as EffectPackId, isEffectId)
    if (!theme || !pieceStyle || !effect) throw new HttpError(400, 'Unknown look.')
    const incoming = sessionFromRequest(req, config.sessionSecret)
    const stamp = now()
    const next = await lockSession(incoming, async (current) => {
      restylePremium(current, { theme, pieceStyle, effect }, stamp)
      return current
    })
    sendJson(res, 200, { ok: true, credits: next.credits, game: viewGame(next) }, writeSession(next))
  }
}
