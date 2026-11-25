import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ART } from '../src/client/art-metrics.js'

const SYMBOLS = ['k', 'q', 'b', 'n', 'r', 'p']

describe('painted boards', () => {
  it('keeps a1 dark and h1 light on both sets, with the pieces on disk', () => {
    for (const look of ['classic', 'exotic'] as const) {
      expect(ART[look].a1).toBeLessThan(ART[look].h1)
      expect(ART[look].w).toBeGreaterThan(0.75)
      expect(ART[look].h).toBeGreaterThan(0.75)
      expect(existsSync(`public/art/${look}/board.webp`)).toBe(true)
      for (const color of ['w', 'b']) {
        for (const symbol of SYMBOLS) {
          expect(existsSync(`public/art/${look}/${color}${symbol}.webp`)).toBe(true)
        }
      }
    }
  })
})
