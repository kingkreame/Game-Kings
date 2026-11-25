import type { LessonId } from './progress.js'

export interface Lesson {
  id: LessonId
  title: string
  fen: string
  prompt: string
  hint: string
  /** UCI of the move the hint highlights. */
  hintMove: string
  /** Moves that finish the lesson, with the reason each one is sound. */
  good: Record<string, string>
  /** Legal ideas that miss the lesson, with the reason. */
  poor: Record<string, string>
  poorFallback: string
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'center',
    title: 'Take the center',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    prompt: 'White to move. Claim the center with a pawn, or develop a knight toward it.',
    hint: '1.e4 opens lines for the queen and the light-squared bishop and takes space.',
    hintMove: 'e2e4',
    good: {
      e2e4: 'e4 claims the center and frees the bishop and the queen. A strong first move.',
      d2d4: 'd4 claims the center and watches e5. A strong first move.',
      g1f3: 'The knight develops toward the center and attacks e5. A solid first move.',
      b1c3: 'The knight develops toward the center and watches d5 and e4.',
    },
    poor: {
      a2a4: 'That pawn does not fight for the center.',
      h2h4: 'That pawn does not fight for the center.',
      a2a3: 'That pawn does not fight for the center.',
      h2h3: 'That pawn does not fight for the center.',
      g2g4: 'The king side is loosened before anything is developed.',
      f2f3: 'f3 takes the knight’s best square and does little for the center.',
      b1a3: 'That knight is on the rim, away from the center.',
      g1h3: 'That knight is on the rim, away from the center.',
    },
    poorFallback: 'Legal, but it does not develop toward the center. Use the hint if you want the idea.',
  },
  {
    id: 'develop',
    title: 'Develop before you hunt',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    prompt: 'Black played e5. Develop a piece. A queen check here is the trap, not the lesson.',
    hint: 'Nf3 develops the knight, attacks the pawn on e5, and prepares castling.',
    hintMove: 'g1f3',
    good: {
      g1f3: 'The knight develops, attacks e5, and clears the way to castle. This is the idea.',
      b1c3: 'The knight develops toward the center and supports d5 and e4.',
      f1c4: 'The bishop develops to an active diagonal and eyes f7. A good developing move.',
      f1b5: 'The bishop develops and can pin a knight that arrives on c6.',
      d2d4: 'd4 challenges e5 at once and opens lines. A direct central move.',
    },
    poor: {
      d1h5: 'Qh5 checks, and it is the move beginners are punished for. Nc6 or g6 develops with tempo and the queen moves again.',
      d1f3: 'The queen steps out early and blocks the knight on g1.',
      d1g4: 'The queen is a target. Develop the minor pieces first.',
    },
    poorFallback: 'Legal, but the lesson is development. Bring a knight or the light-squared bishop out, or strike with d4.',
  },
  {
    id: 'mate',
    title: 'Queen and king mate',
    fen: '7k/8/6K1/8/8/8/1Q6/8 w - - 0 1',
    prompt: 'White to move. Mate in one. Put the queen beside the king, on a square your own king defends.',
    hint: 'Qg7 is check. Your king on g6 defends the queen, and the black king has no flight square.',
    hintMove: 'b2g7',
    good: {
      b2g7: 'Qg7 is checkmate. The queen stands next to the king and your king protects her. h7, g8, and the queen’s square are all covered.',
      b2b8: 'Qb8 is also mate. The queen checks along the eighth rank, and the king on g6 covers the flight squares.',
    },
    poor: {},
    poorFallback: 'That does not mate. Slide the queen to g7, beside the king, where your own king defends her.',
  },
]

export function lessonById(id: string | null): Lesson | null {
  return LESSONS.find((lesson) => lesson.id === id) ?? null
}

export function explainMove(lesson: Lesson, uci: string): { done: boolean; text: string } {
  if (lesson.good[uci]) return { done: true, text: lesson.good[uci] }
  if (lesson.poor[uci]) return { done: false, text: lesson.poor[uci] }
  return { done: false, text: lesson.poorFallback }
}
