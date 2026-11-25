import { Chess } from 'chess.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUci } from '../src/shared/game.js'
import type { AiChooser } from '../src/server/premium.js'
import { COOKIE_NAME, readSession, signSession } from '../src/server/session.js'
import { IDLE_MS } from '../src/shared/types.js'
import { SECRET, boot, licenseBody, type TestClient } from './harness.js'

let client: TestClient | null = null

afterEach(async () => {
  await client?.close()
  client = null
})

function scripted(replies: string[]): AiChooser {
  let index = 0
  return () => replies[index++] ?? null
}

function gumroad(body: unknown, status = 200) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://api.gumroad.com/v2/licenses/verify')
    expect(init?.method).toBe('POST')
    const params = new URLSearchParams(String(init?.body ?? ''))
    expect(params.get('product_id')).toBe('prod_test')
    expect(params.get('increment_uses_count')).toBe('true')
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
}

async function credited(fetchImpl: ReturnType<typeof gumroad>, choose?: AiChooser): Promise<TestClient> {
  client = await boot({ fetchImpl: fetchImpl as unknown as typeof fetch, chooseAiMove: choose })
  const unlocked = await client.request('POST', '/api/pass/unlock', { licenseKey: 'GOOD-KEY-1111' })
  expect(unlocked.status).toBe(200)
  expect(unlocked.json?.credits).toBe(1)
  expect(unlocked.setCookies[0]).toContain('HttpOnly')
  expect(unlocked.setCookies[0]).toContain('SameSite=Lax')
  expect(unlocked.setCookies[0]).toContain('Secure')
  const token = client.jar.get(COOKIE_NAME) ?? ''
  expect(JSON.stringify(readSession(token, SECRET))).not.toContain('GOOD-KEY')
  return client
}

describe('premium gate', () => {
  it('serves health with a strict content security policy', async () => {
    client = await boot({ gateEnabled: false })
    const health = await client.request('GET', '/api/health')
    expect(health.status).toBe(200)
    expect(health.json).toEqual({ ok: true })
    const policy = health.headers.get('content-security-policy') ?? ''
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(health.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('never unlocks premium when the gate is disabled', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('gumroad should not be called')
    })
    client = await boot({ gateEnabled: false, fetchImpl: fetchImpl as unknown as typeof fetch })
    const token = signSession(
      { v: 1, sid: 'ab'.repeat(16), credits: 4, game: null },
      SECRET,
    )
    client.jar.set(COOKIE_NAME, token)
    const status = await client.request('GET', '/api/pass/status')
    expect(status.json).toMatchObject({ gateEnabled: false, comingSoon: true, credits: 0, game: null })
    const unlocked = await client.request('POST', '/api/pass/unlock', { licenseKey: 'GOOD-KEY-1111' })
    expect(unlocked.status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
    const started = await client.request('POST', '/api/game/start', { difficulty: 'expert' })
    expect(started.status).toBe(403)
    expect(started.json?.credits).toBeUndefined()
  })

  it('rejects a missing origin and a bad license key', async () => {
    const fetchImpl = gumroad({ success: false })
    client = await boot({ fetchImpl: fetchImpl as unknown as typeof fetch })
    const missing = await client.request('POST', '/api/pass/unlock', { licenseKey: 'GOOD-KEY-1111' }, { origin: null })
    expect(missing.status).toBe(403)
    const bad = await client.request('POST', '/api/pass/unlock', { licenseKey: 'GOOD-KEY-1111' })
    expect(bad.status).toBe(400)
    expect(bad.setCookies).toHaveLength(0)
    const status = await client.request('GET', '/api/pass/status')
    expect(status.json?.credits).toBe(0)
  })

  it.each([
    ['refunded', licenseBody({ refunded: true })],
    ['chargebacked', licenseBody({ chargebacked: true })],
    ['disputed', licenseBody({ disputed: true })],
    ['reused', licenseBody({}, 2)],
    ['unused count', licenseBody({}, 0)],
  ])('rejects a %s key', async (_name, body) => {
    client = await boot({ fetchImpl: gumroad(body) as unknown as typeof fetch })
    const unlocked = await client.request('POST', '/api/pass/unlock', { licenseKey: 'GOOD-KEY-1111' })
    expect(unlocked.status).toBe(400)
    expect(unlocked.setCookies).toHaveLength(0)
    const status = await client.request('GET', '/api/pass/status')
    expect(status.json?.credits).toBe(0)
  })

  it('consumes a credit when a premium game starts', async () => {
    const ctx = await credited(gumroad(licenseBody()))
    const started = await ctx.request('POST', '/api/game/start', { difficulty: 'medium', player: 'w' })
    expect(started.status).toBe(200)
    expect(started.json?.credits).toBe(0)
    const game = started.json?.game as { id: string; movesUci: string[]; result: null }
    expect(game.movesUci).toEqual([])
    expect(game.result).toBeNull()
  })

  it('rejects a client-submitted result and does not grant a credit', async () => {
    const ctx = await credited(gumroad(licenseBody()))
    const started = await ctx.request('POST', '/api/game/start', { difficulty: 'hard', player: 'w' })
    const game = started.json?.game as { id: string; fen: string }
    const fake = await ctx.request('POST', '/api/game/move', { gameId: game.id, uci: 'e2e4', result: 'win' })
    expect(fake.status).toBe(400)
    expect(String(fake.json?.error)).toMatch(/not accepted/i)
    const claimed = await ctx.request('POST', '/api/game/result', { result: 'win', winner: 'w' })
    expect(claimed.status).toBe(404)
    const status = await ctx.request('GET', '/api/pass/status')
    const current = status.json?.game as { movesUci: string[]; result: null; fen: string }
    expect(status.json?.credits).toBe(0)
    expect(current.movesUci).toEqual([])
    expect(current.result).toBeNull()
    expect(current.fen).toBe(game.fen)
  })

  it('grants exactly one free credit when the player checkmates the computer', async () => {
    const ctx = await credited(gumroad(licenseBody()), scripted(['e7e5', 'b8c6', 'g8f6']))
    const started = await ctx.request('POST', '/api/game/start', { difficulty: 'medium', player: 'w' })
    const gameId = (started.json?.game as { id: string }).id
    let last: Awaited<ReturnType<TestClient['request']>> | null = null
    for (const uci of ['e2e4', 'f1c4', 'd1h5', 'h5f7']) {
      last = await ctx.request('POST', '/api/game/move', { gameId, uci })
      expect(last.status).toBe(200)
    }
    expect(last?.json?.credits).toBe(1)
    expect((last?.json?.game as { result: string }).result).toBe('win')
    const again = await ctx.request('GET', '/api/pass/status')
    expect(again.json?.credits).toBe(1)
    const extra = await ctx.request('POST', '/api/game/move', { gameId, uci: 'a2a3', result: 'win' })
    expect(extra.status).toBe(400)
    const after = await ctx.request('GET', '/api/pass/status')
    expect(after.json?.credits).toBe(1)
  })

  it('gives no credit for a loss, a draw, a resign, or an idle forfeit', async () => {
    const loss = await credited(gumroad(licenseBody()), scripted(['e7e5', 'd8h4']))
    const lostStart = await loss.request('POST', '/api/game/start', { difficulty: 'medium', player: 'w' })
    const lostId = (lostStart.json?.game as { id: string }).id
    await loss.request('POST', '/api/game/move', { gameId: lostId, uci: 'f2f3' })
    const lost = await loss.request('POST', '/api/game/move', { gameId: lostId, uci: 'g2g4' })
    expect((lost.json?.game as { result: string }).result).toBe('loss')
    expect(lost.json?.credits).toBe(0)
    await loss.close()

    client = null
    const draw = await credited(
      gumroad(licenseBody()),
      scripted(['g8f6', 'f6g8', 'g8f6', 'f6g8']),
    )
    const drawStart = await draw.request('POST', '/api/game/start', { difficulty: 'expert', player: 'w' })
    const drawId = (drawStart.json?.game as { id: string }).id
    let drawn: Awaited<ReturnType<TestClient['request']>> | null = null
    for (const uci of ['g1f3', 'f3g1', 'g1f3', 'f3g1']) {
      drawn = await draw.request('POST', '/api/game/move', { gameId: drawId, uci })
    }
    expect((drawn?.json?.game as { result: string }).result).toBe('draw')
    expect(drawn?.json?.credits).toBe(0)
    await draw.close()

    client = null
    const resign = await credited(gumroad(licenseBody()))
    const resignStart = await resign.request('POST', '/api/game/start', { difficulty: 'hard', player: 'w' })
    const resignId = (resignStart.json?.game as { id: string }).id
    const resigned = await resign.request('POST', '/api/game/resign', { gameId: resignId })
    expect((resigned.json?.game as { result: string }).result).toBe('resign')
    expect(resigned.json?.credits).toBe(0)
    await resign.close()

    client = null
    let now = 1_700_000_000_000
    const idleFetch = gumroad(licenseBody())
    client = await boot({
      fetchImpl: idleFetch as unknown as typeof fetch,
      now: () => now,
      chooseAiMove: scripted(['e7e5']),
    })
    expect((await client.request('POST', '/api/pass/unlock', { licenseKey: 'GOOD-KEY-1111' })).status).toBe(200)
    const idleStart = await client.request('POST', '/api/game/start', { difficulty: 'medium', player: 'w' })
    const idleId = (idleStart.json?.game as { id: string }).id
    now += IDLE_MS + 5
    const forfeited = await client.request('POST', '/api/game/move', { gameId: idleId, uci: 'e2e4' })
    expect(forfeited.status).toBe(200)
    expect((forfeited.json?.game as { result: string; movesUci: string[] }).result).toBe('timeout')
    expect((forfeited.json?.game as { movesUci: string[] }).movesUci).toEqual([])
    expect(forfeited.json?.credits).toBe(0)
  })

  it('plays the server AI and only accepts a legal reply', async () => {
    const ctx = await credited(gumroad(licenseBody()))
    const started = await ctx.request('POST', '/api/game/start', { difficulty: 'medium', player: 'w' })
    const gameId = (started.json?.game as { id: string }).id
    const moved = await ctx.request('POST', '/api/game/move', { gameId, uci: 'e2e4' })
    expect(moved.status).toBe(200)
    const applied = moved.json?.applied as string[]
    expect(applied[0]).toBe('e2e4')
    const reply = applied[1]
    const chess = new Chess()
    expect(applyUci(chess, 'e2e4')).not.toBeNull()
    expect(applyUci(chess, reply ?? '')).not.toBeNull()
    const illegal = await ctx.request('POST', '/api/game/move', { gameId, uci: 'e2e5' })
    expect(illegal.status).toBe(400)
  })
})
