import { chooseAiMove } from '../shared/ai.js'
import type { Difficulty } from '../shared/types.js'

function level(value: unknown): Difficulty {
  if (value === 'medium' || value === 'hard' || value === 'expert') return value
  return 'easy'
}

self.onmessage = (event: MessageEvent<{ fen: string; difficulty?: Difficulty }>) => {
  const uci = chooseAiMove(event.data.fen, level(event.data.difficulty))
  self.postMessage({ uci })
}
