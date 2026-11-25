import { describe, expect, it } from 'vitest'
import {
  WINS_FOR_EXOTIC,
  badgesFor,
  chooseLook,
  completeLesson,
  emptyProgress,
  parseProgress,
  recordComputerWin,
  titleFor,
} from '../src/shared/progress.js'

describe('earned rewards', () => {
  it('starts locked on the marble set', () => {
    const progress = emptyProgress()
    expect(progress.exoticUnlocked).toBe(false)
    expect(progress.look).toBe('classic')
    expect(chooseLook(progress, 'exotic').look).toBe('classic')
    expect(titleFor(progress)).toBe('Player')
    expect(badgesFor(progress)).toEqual([])
  })

  it('unlocks the jeweled set after three distinct computer wins and ignores a replay', () => {
    let progress = emptyProgress()
    progress = recordComputerWin(progress, 'e4 e5')
    progress = recordComputerWin(progress, 'e4 e5')
    expect(progress.computerWins).toBe(1)
    expect(progress.exoticUnlocked).toBe(false)
    expect(titleFor(progress)).toBe('Contender')
    progress = recordComputerWin(progress, 'd4 d5')
    progress = recordComputerWin(progress, 'Nf3 d5')
    expect(progress.computerWins).toBe(WINS_FOR_EXOTIC)
    expect(progress.exoticUnlocked).toBe(true)
    expect(badgesFor(progress)).toEqual(['First win', 'Three wins'])
    expect(titleFor(progress)).toBe('Rival')
    expect(chooseLook(progress, 'exotic').look).toBe('exotic')
  })

  it('also unlocks when every training lesson is finished', () => {
    let progress = emptyProgress()
    progress = completeLesson(progress, 'center')
    progress = completeLesson(progress, 'center')
    progress = completeLesson(progress, 'develop')
    expect(progress.exoticUnlocked).toBe(false)
    progress = completeLesson(progress, 'mate')
    expect(progress.exoticUnlocked).toBe(true)
    expect(titleFor(progress)).toBe('Scholar')
    progress = recordComputerWin(progress, 'e4')
    progress = recordComputerWin(progress, 'd4')
    progress = recordComputerWin(progress, 'c4')
    expect(titleFor(progress)).toBe('Game King')
    expect(badgesFor(progress)).toContain('Training complete')
  })

  it('drops a tampered exotic flag when the player has not earned it', () => {
    const progress = parseProgress(
      JSON.stringify({ v: 1, computerWins: 2, winLines: ['a', 'b'], lessonsDone: [], look: 'exotic' }),
    )
    expect(progress.computerWins).toBe(2)
    expect(progress.exoticUnlocked).toBe(false)
    expect(progress.look).toBe('classic')
  })
})
