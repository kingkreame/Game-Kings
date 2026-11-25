export const WINS_FOR_EXOTIC = 3
export const LESSON_IDS = ['center', 'develop', 'mate'] as const

export type LookId = 'classic' | 'exotic'
export type LessonId = (typeof LESSON_IDS)[number]

export interface PlayerProgress {
  v: 1
  computerWins: number
  winLines: string[]
  lessonsDone: LessonId[]
  exoticUnlocked: boolean
  look: LookId
}

export function emptyProgress(): PlayerProgress {
  return {
    v: 1,
    computerWins: 0,
    winLines: [],
    lessonsDone: [],
    exoticUnlocked: false,
    look: 'classic',
  }
}

function isLessonId(value: string): value is LessonId {
  return (LESSON_IDS as readonly string[]).includes(value)
}

export function parseProgress(raw: string): PlayerProgress {
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return emptyProgress()
    const record = value as Record<string, unknown>
    const wins = Number.isInteger(record.computerWins) ? Math.max(0, Math.min(99, record.computerWins as number)) : 0
    const winLines = Array.isArray(record.winLines)
      ? record.winLines.filter((line): line is string => typeof line === 'string' && line.length < 400).slice(-40)
      : []
    const lessonsDone = Array.isArray(record.lessonsDone)
      ? record.lessonsDone.filter((id): id is LessonId => typeof id === 'string' && isLessonId(id))
      : []
    const look = record.look === 'exotic' ? 'exotic' : 'classic'
    return settle({
      v: 1,
      computerWins: wins,
      winLines,
      lessonsDone: [...new Set(lessonsDone)],
      exoticUnlocked: false,
      look,
    })
  } catch {
    return emptyProgress()
  }
}

export function badgesFor(progress: PlayerProgress): string[] {
  const badges: string[] = []
  if (progress.computerWins >= 1) badges.push('First win')
  if (progress.computerWins >= WINS_FOR_EXOTIC) badges.push('Three wins')
  if (progress.lessonsDone.length >= LESSON_IDS.length) badges.push('Training complete')
  return badges
}

export function titleFor(progress: PlayerProgress): string {
  const scholar = progress.lessonsDone.length >= LESSON_IDS.length
  const rival = progress.computerWins >= WINS_FOR_EXOTIC
  if (scholar && rival) return 'Game King'
  if (scholar) return 'Scholar'
  if (rival) return 'Rival'
  if (progress.computerWins >= 1) return 'Contender'
  return 'Player'
}

function settle(progress: PlayerProgress): PlayerProgress {
  const exoticUnlocked =
    progress.computerWins >= WINS_FOR_EXOTIC || progress.lessonsDone.length >= LESSON_IDS.length
  return {
    ...progress,
    exoticUnlocked,
    look: exoticUnlocked && progress.look === 'exotic' ? 'exotic' : 'classic',
  }
}

/** One win per distinct game line, so undoing and replaying the same mate does not farm the prize. */
export function recordComputerWin(progress: PlayerProgress, line: string): PlayerProgress {
  const key = line.slice(0, 400)
  if (!key || progress.winLines.includes(key)) return progress
  return settle({
    ...progress,
    computerWins: progress.computerWins + 1,
    winLines: [...progress.winLines, key].slice(-40),
  })
}

export function completeLesson(progress: PlayerProgress, id: LessonId): PlayerProgress {
  if (progress.lessonsDone.includes(id)) return progress
  return settle({ ...progress, lessonsDone: [...progress.lessonsDone, id] })
}

export function chooseLook(progress: PlayerProgress, look: LookId): PlayerProgress {
  if (look === 'exotic' && !progress.exoticUnlocked) return progress
  return { ...progress, look }
}

export const PROGRESS_KEY = 'gk-chess-progress'
