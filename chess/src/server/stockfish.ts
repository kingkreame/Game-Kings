import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptEngineMove, readBestMove, type StockfishLimit } from '../shared/engine.js'

let child: ChildProcess | null = null
let chain: Promise<unknown> = Promise.resolve()
let booted: Promise<void> | null = null
let waiters: ((line: string) => void)[] = []

function write(command: string): void {
  child?.stdin?.write(command + '\n')
}

function runnerFile(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(here, '../client/engine/engine-runner.cjs'),
    path.join(here, '../../public/engine/engine-runner.cjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function boot(): Promise<void> {
  if (booted) return booted
  const file = runnerFile()
  if (!file) return Promise.reject(new Error('Stockfish is not installed.'))
  const proc = spawn(process.execPath, [file], { stdio: ['pipe', 'pipe', 'ignore'] })
  child = proc
  proc.unref()
  let buffer = ''
  proc.stdout?.setEncoding('utf8')
  proc.stdout?.on('data', (chunk: string) => {
    buffer += chunk
    let split = buffer.indexOf('\n')
    while (split >= 0) {
      const line = buffer.slice(0, split).trim()
      buffer = buffer.slice(split + 1)
      if (line) {
        for (const waiter of waiters) waiter(line)
      }
      split = buffer.indexOf('\n')
    }
  })
  proc.once('exit', () => {
    child = null
    booted = null
    waiters = []
  })
  const attempt = send('uci', (line) => line === 'uciok', 8000).then(() => {
    write('setoption name Hash value 16')
    write('setoption name Threads value 1')
    return send('isready', (line) => line === 'readyok', 8000)
  })
  booted = attempt.catch((error: unknown) => {
    booted = null
    child?.kill()
    child = null
    throw error
  })
  return booted
}

function send(command: string, done: (line: string) => boolean, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((waiter) => waiter !== onLine)
      reject(new Error('Stockfish timed out.'))
    }, ms)
    const onLine = (line: string) => {
      if (!done(line)) return
      clearTimeout(timer)
      waiters = waiters.filter((waiter) => waiter !== onLine)
      resolve()
    }
    waiters.push(onLine)
    write(command)
  })
}

async function search(fen: string, limit: StockfishLimit): Promise<string | null> {
  try {
    await boot()
  } catch {
    return null
  }
  if (!child) return null
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      write('stop')
    }, limit.movetime + 500)
    const onLine = (line: string) => {
      if (!line.startsWith('bestmove')) return
      clearTimeout(timer)
      waiters = waiters.filter((waiter) => waiter !== onLine)
      resolve(acceptEngineMove(fen, readBestMove(line)))
    }
    waiters.push(onLine)
    write(`setoption name Skill Level value ${limit.skill}`)
    write(`position fen ${fen}`)
    write(`go movetime ${limit.movetime} depth ${limit.depth}`)
  })
}

/** One Stockfish process, one search at a time, kept off the request thread's fetch global. */
export function searchStockfish(fen: string, limit: StockfishLimit): Promise<string | null> {
  const run = chain.then(() => search(fen, limit), () => search(fen, limit))
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function stopStockfish(): void {
  child?.stdin?.end()
  child?.kill()
  child = null
  booted = null
  waiters = []
}
