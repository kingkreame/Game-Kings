import type { Session } from '../shared/types.js'

interface Entry {
  session: Session
  chain: Promise<void>
}

const sessions = new Map<string, Entry>()
const keyChains = new Map<string, Promise<void>>()

export function resetSessionLocks(): void {
  sessions.clear()
  keyChains.clear()
}

/** Serialize mutations for one signed session so a replayed cookie cannot double-grant. */
export function lockSession(incoming: Session, fn: (current: Session) => Promise<Session>): Promise<Session> {
  const id = incoming.sid
  let entry = sessions.get(id)
  if (!entry) {
    entry = { session: structuredClone(incoming), chain: Promise.resolve() }
    sessions.set(id, entry)
  }
  const run = entry.chain.then(async () => {
    const current = structuredClone(sessions.get(id)!.session)
    const next = await fn(current)
    const saved = sessions.get(id)
    if (saved) saved.session = structuredClone(next)
    return next
  })
  entry.chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function lockLicense(keyHash: string, fn: () => Promise<void>): Promise<void> {
  const prev = keyChains.get(keyHash) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  keyChains.set(
    keyHash,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}
