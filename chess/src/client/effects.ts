import type { EffectPackId } from '../shared/types.js'

interface Bit {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  rot: number
  spin: number
  shape: 'rect' | 'circle'
  gravity: number
}

interface Bolt {
  pts: { x: number; y: number }[]
  life: number
  max: number
}

const GOLD = ['#f8e7b0', '#e8c872', '#fff', '#c4b5fd', '#a78bfa']

export class BoardFx {
  private bits: Bit[] = []
  private bolts: Bolt[] = []
  private trail: { x: number; y: number }[] = []
  private frame = 0
  private running = false
  private celebrating = false
  private celebrateUntil = 0
  private ctx: CanvasRenderingContext2D | null

  constructor(
    private canvas: HTMLCanvasElement,
    private streak: HTMLElement,
    private flashEl: HTMLElement,
    private ripples: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d')
  }

  resize(): void {
    const parent = this.canvas.parentElement
    if (!parent) return
    const width = parent.clientWidth
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.floor(width * ratio))
    this.canvas.height = Math.max(1, Math.floor(width * ratio))
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${width}px`
  }

  startTrail(): void {
    this.trail = []
    this.streak.hidden = false
  }

  trailTo(x: number, y: number): void {
    this.trail.push({ x, y })
    if (this.trail.length > 18) this.trail.shift()
    const first = this.trail[0]
    const last = this.trail[this.trail.length - 1]
    if (!first || !last) return
    const dx = last.x - first.x
    const dy = last.y - first.y
    this.streak.style.left = `${first.x}px`
    this.streak.style.top = `${first.y}px`
    this.streak.style.width = `${Math.max(8, Math.hypot(dx, dy))}px`
    this.streak.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`
    this.spawnBit(last.x, last.y, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 16, 3, '#f8e7b0', 'circle', 0)
    this.kick()
  }

  endTrail(): void {
    this.trail = []
    this.streak.hidden = true
    this.streak.style.width = '0px'
  }

  ripple(x: number, y: number): void {
    const dot = document.createElement('div')
    dot.className = 'ripple'
    dot.style.left = `${x}px`
    dot.style.top = `${y}px`
    this.ripples.appendChild(dot)
    window.setTimeout(() => dot.remove(), 650)
  }

  flash(): void {
    this.flashEl.classList.remove('on')
    void this.flashEl.offsetWidth
    this.flashEl.classList.add('on')
  }

  shake(board: HTMLElement): void {
    board.classList.remove('shake')
    void board.offsetWidth
    board.classList.add('shake')
    window.setTimeout(() => board.classList.remove('shake'), 320)
  }

  capture(x: number, y: number, pack: EffectPackId): void {
    for (let i = 0; i < 26; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 1.4 + Math.random() * 4.2
      this.spawnBit(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 1.2,
        34 + Math.random() * 18,
        3 + Math.random() * 5,
        GOLD[i % GOLD.length],
        i % 2 ? 'rect' : 'circle',
        0.08,
      )
    }
    if (pack === 'lightning') {
      for (let i = 0; i < 4; i++) this.bolts.push({ pts: this.bolt(x, y), life: 0, max: 16 })
    }
    if (pack === 'coins') {
      for (let i = 0; i < 16; i++) {
        this.spawnBit(
          x + (Math.random() - 0.5) * 10,
          y,
          (Math.random() - 0.5) * 2.4,
          -3.2 - Math.random() * 3.4,
          46,
          5 + Math.random() * 4,
          i % 2 ? '#f8e7b0' : '#e8c872',
          'circle',
          0.16,
        )
      }
    }
    this.kick()
  }

  celebrate(): void {
    this.celebrating = true
    this.celebrateUntil = performance.now() + 3200
    this.kick()
  }

  stopCelebrate(): void {
    this.celebrating = false
  }

  private bolt(x: number, y: number): { x: number; y: number }[] {
    const pts = [{ x: x + (Math.random() - 0.5) * 80, y: Math.max(0, y - 80 - Math.random() * 40) }]
    let cx = pts[0].x
    let cy = pts[0].y
    while (cy < y) {
      cx += (Math.random() - 0.5) * 28
      cy += 12 + Math.random() * 16
      pts.push({ x: cx, y: cy })
    }
    pts.push({ x, y })
    return pts
  }

  private spawnBit(
    x: number,
    y: number,
    vx: number,
    vy: number,
    max: number,
    size: number,
    color: string,
    shape: 'rect' | 'circle',
    gravity: number,
  ): void {
    this.bits.push({
      x,
      y,
      vx,
      vy,
      life: 0,
      max,
      size,
      color,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      shape,
      gravity,
    })
  }

  private kick(): void {
    if (this.running) return
    this.running = true
    const loop = (time: number) => {
      this.draw(time)
      if (this.bits.length || this.bolts.length || this.celebrating) requestAnimationFrame(loop)
      else this.running = false
    }
    requestAnimationFrame(loop)
  }

  private draw(time: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const width = this.canvas.width
    const height = this.canvas.height
    const ratio = width / Math.max(1, this.canvas.clientWidth)
    ctx.clearRect(0, 0, width, height)
    if (this.celebrating && time < this.celebrateUntil && this.frame % 2 === 0) {
      for (let i = 0; i < 3; i++) {
        this.spawnBit(
          Math.random() * this.canvas.clientWidth,
          -8,
          (Math.random() - 0.5) * 1.4,
          1.6 + Math.random() * 2.4,
          90,
          4 + Math.random() * 6,
          GOLD[Math.floor(Math.random() * GOLD.length)],
          Math.random() > 0.5 ? 'rect' : 'circle',
          0.02,
        )
      }
    } else if (this.celebrating && time >= this.celebrateUntil && this.bits.length === 0) {
      this.celebrating = false
    }
    this.frame++
    ctx.save()
    ctx.scale(ratio, ratio)
    for (const bolt of this.bolts) {
      bolt.life++
      ctx.globalAlpha = Math.max(0, 1 - bolt.life / bolt.max)
      ctx.strokeStyle = '#f8fbff'
      ctx.lineWidth = 2
      ctx.shadowColor = '#e8c872'
      ctx.shadowBlur = 12
      ctx.beginPath()
      bolt.pts.forEach((pt, index) => (index ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
      ctx.stroke()
      ctx.shadowBlur = 0
    }
    this.bolts = this.bolts.filter((bolt) => bolt.life < bolt.max)
    for (const bit of this.bits) {
      bit.life++
      bit.vy += bit.gravity
      bit.x += bit.vx
      bit.y += bit.vy
      bit.rot += bit.spin
      ctx.globalAlpha = Math.max(0, 1 - bit.life / bit.max)
      ctx.fillStyle = bit.color
      ctx.save()
      ctx.translate(bit.x, bit.y)
      ctx.rotate(bit.rot)
      if (bit.shape === 'circle') {
        ctx.beginPath()
        ctx.arc(0, 0, bit.size / 2, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillRect(-bit.size / 2, -bit.size / 2, bit.size, bit.size * 0.62)
      }
      ctx.restore()
    }
    ctx.restore()
    this.bits = this.bits.filter((bit) => bit.life < bit.max)
  }
}
