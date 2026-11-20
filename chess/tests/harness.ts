import type { AddressInfo } from 'node:net'
import { createApp, type AppConfig } from '../src/server/app.js'
import { resetSessionLocks } from '../src/server/lock.js'
import { resetPremiumMemory } from '../src/server/premium.js'

export const SECRET = 'test-secret-please-change'

export interface TestClient {
  request: (
    method: string,
    path: string,
    body?: unknown,
    extra?: { origin?: string | null },
  ) => Promise<{
    status: number
    json: Record<string, unknown> | null
    setCookies: string[]
    text: string
    headers: Headers
  }>
  close: () => Promise<void>
  jar: Map<string, string>
}

export async function boot(overrides: Partial<AppConfig> = {}): Promise<TestClient> {
  resetSessionLocks()
  resetPremiumMemory()
  const server = createApp({
    gateEnabled: true,
    checkoutUrl: 'https://shop.example/buy',
    productId: 'prod_test',
    priceLabel: '$4.99',
    sessionSecret: SECRET,
    clientDir: '/tmp/game-kings-chess-missing',
    ...overrides,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${address.port}`
  const jar = new Map<string, string>()
  let closed = false

  return {
    jar,
    async request(method, path, body, extra) {
      const headers: Record<string, string> = {}
      if (extra?.origin !== null) headers.origin = extra?.origin ?? origin
      const cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
      if (cookie) headers.cookie = cookie
      if (body !== undefined) headers['content-type'] = 'application/json'
      const response = await fetch(origin + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
      for (const line of setCookies) {
        const pair = line.split(';')[0] ?? ''
        const eq = pair.indexOf('=')
        if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1))
      }
      const text = await response.text()
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(text) as Record<string, unknown>
      } catch {
        json = null
      }
      return { status: response.status, json, setCookies, text, headers: response.headers }
    },
    close: () =>
      new Promise((resolve, reject) => {
        if (closed) {
          resolve()
          return
        }
        closed = true
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

export function licenseBody(
  purchase: Record<string, unknown> = {},
  uses = 1,
  success = true,
): Record<string, unknown> {
  return {
    success,
    uses,
    purchase: {
      refunded: false,
      chargebacked: false,
      disputed: false,
      product_id: 'prod_test',
      ...purchase,
    },
  }
}
