import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 3000)
const host = '0.0.0.0'
const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client')

const server = createApp({
  gateEnabled: process.env.PASS_GATE_ENABLED === 'true',
  checkoutUrl: process.env.CHECKOUT_URL ?? '',
  productId: process.env.GUMROAD_PRODUCT_ID ?? '',
  priceLabel: process.env.PRICE_LABEL ?? '',
  sessionSecret: process.env.SESSION_SECRET ?? '',
  clientDir,
})

server.listen(port, host, () => {
  console.log(`Game Kings Chess listening on ${host}:${port}`)
})

function shutdown(): void {
  server.close(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
