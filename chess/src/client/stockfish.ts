import {
  HINT_LIMIT,
  acceptEngineMove,
  readBestMove,
  readInfoScore,
  type StockfishLimit,
} from '../shared/engine.js'

export interface EngineAnalysis {
  best: string
  cp: number | null
  mate: number | null
}

const WORKER_URL = '/engine/stockfish-19-lite-single.js'

let worker: Worker | null = null
let chain: Promise<unknown> = Promise.resolve()
let failed = false

function linesOf(data: unknown): string[] {
  return String(data)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function ensureWorker(): Worker | null {
  if (failed) return null
  if (worker) return worker
  try {
    worker = new Worker(WORKER_URL)
    return worker
  } catch {
    failed = true
    return null
  }
}

async function handshake(current: Worker): Promise<void> {
  await waitFor(current, (line) => line === 'uciok', 8000, () => current.postMessage('uci'))
  current.postMessage('setoption name Hash value 16')
  current.postMessage('setoption name Threads value 1')
  await waitFor(current, (line) => line === 'readyok', 8000, () => current.postMessage('isready'))
}

let ready: Promise<void> | null = null

function waitFor(current: Worker, done: (line: string) => boolean, ms: number, send: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      current.removeEventListener('message', onMessage)
      reject(new Error('Stockfish timed out.'))
    }, ms)
    const onMessage = (event: MessageEvent<unknown>) => {
      for (const line of linesOf(event.data)) {
        if (!done(line)) continue
        window.clearTimeout(timer)
        current.removeEventListener('message', onMessage)
        resolve()
        return
      }
    }
    current.addEventListener('message', onMessage)
    send()
  })
}

async function analyze(fen: string, limit: StockfishLimit): Promise<EngineAnalysis | null> {
  const current = ensureWorker()
  if (!current) return null
  if (!ready) {
    ready = handshake(current).catch((error: unknown) => {
      failed = true
      ready = null
      throw error
    })
  }
  await ready
  return new Promise((resolve) => {
    let cp: number | null = null
    let mate: number | null = null
    const timer = window.setTimeout(() => finish(null), limit.movetime + 1500)
    const finish = (best: string | null) => {
      window.clearTimeout(timer)
      current.removeEventListener('message', onMessage)
      const legal = acceptEngineMove(fen, best)
      resolve(legal ? { best: legal, cp, mate } : null)
    }
    const onMessage = (event: MessageEvent<unknown>) => {
      for (const line of linesOf(event.data)) {
        const score = readInfoScore(line)
        if (score) {
          cp = score.cp
          mate = score.mate
        }
        if (line.startsWith('bestmove')) finish(readBestMove(line))
      }
    }
    current.addEventListener('message', onMessage)
    current.postMessage(`setoption name Skill Level value ${limit.skill}`)
    current.postMessage(`position fen ${fen}`)
    current.postMessage(`go movetime ${limit.movetime} depth ${limit.depth}`)
  })
}

function enqueue(fen: string, limit: StockfishLimit): Promise<EngineAnalysis | null> {
  const run = chain.then(() => analyze(fen, limit), () => analyze(fen, limit))
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function analyzePosition(fen: string, limit: StockfishLimit): Promise<EngineAnalysis | null> {
  return enqueue(fen, limit).catch(() => null)
}

export function analyzeHint(fen: string): Promise<EngineAnalysis | null> {
  return analyzePosition(fen, HINT_LIMIT)
}
