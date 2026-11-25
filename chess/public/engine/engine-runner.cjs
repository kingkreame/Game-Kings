'use strict'

const engine = require('./stockfish-19-lite-single.cjs')()

engine.listener = (line) => {
  process.stdout.write(String(line) + '\n')
}

process.stdin.setEncoding('utf8')
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let split = buffer.indexOf('\n')
  while (split >= 0) {
    const line = buffer.slice(0, split).trim()
    buffer = buffer.slice(split + 1)
    if (line) engine.processCommand(line)
    split = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => {
  try {
    engine.processCommand('quit')
  } catch {
    /* the process is leaving */
  }
  process.exit(0)
})
