import { chooseAiMove } from '../shared/ai.js'

self.onmessage = (event: MessageEvent<{ fen: string }>) => {
  const uci = chooseAiMove(event.data.fen, 'easy')
  self.postMessage({ uci })
}
