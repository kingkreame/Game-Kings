function readMute(): boolean {
  try {
    return localStorage.getItem('gkc-mute') === '1'
  } catch {
    return false
  }
}

function writeMute(muted: boolean): void {
  try {
    localStorage.setItem('gkc-mute', muted ? '1' : '0')
  } catch {
    /* private mode */
  }
}

export class Sfx {
  muted = readMute()
  private ctx: AudioContext | null = null
  private noise: AudioBuffer | null = null

  toggle(): boolean {
    this.muted = !this.muted
    writeMute(this.muted)
    return this.muted
  }

  /** Create the audio context during a user gesture so later sounds are allowed. */
  unlock(): void {
    this.ac()
  }

  private ac(): AudioContext | null {
    if (this.muted) return null
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    if (!this.ctx) this.ctx = new AC()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private burst(ctx: AudioContext, when: number, dur: number, gain: number, freq: number): void {
    if (!this.noise) {
      const length = Math.floor(ctx.sampleRate * 0.25)
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
      this.noise = buffer
    }
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(freq, when)
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(gain, when)
    amp.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    src.connect(filter)
    filter.connect(amp)
    amp.connect(ctx.destination)
    src.start(when)
    src.stop(when + dur + 0.02)
  }

  private tone(
    ctx: AudioContext,
    freq: number,
    when: number,
    dur: number,
    type: OscillatorType,
    gain: number,
  ): void {
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, when)
    amp.gain.setValueAtTime(0.0001, when)
    amp.gain.exponentialRampToValueAtTime(gain, when + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    osc.connect(amp)
    amp.connect(ctx.destination)
    osc.start(when)
    osc.stop(when + dur + 0.02)
  }

  move(): void {
    const ctx = this.ac()
    if (!ctx) return
    const t = ctx.currentTime
    this.burst(ctx, t, 0.045, 0.18, 1400)
    this.tone(ctx, 210, t, 0.07, 'sine', 0.06)
  }

  capture(): void {
    const ctx = this.ac()
    if (!ctx) return
    const t = ctx.currentTime
    this.burst(ctx, t, 0.16, 0.32, 420)
    this.tone(ctx, 140, t, 0.18, 'triangle', 0.08)
    this.tone(ctx, 90, t + 0.04, 0.2, 'sine', 0.06)
  }

  check(): void {
    const ctx = this.ac()
    if (!ctx) return
    const t = ctx.currentTime
    this.tone(ctx, 660, t, 0.1, 'square', 0.04)
    this.tone(ctx, 880, t + 0.11, 0.14, 'square', 0.04)
  }

  mate(): void {
    const ctx = this.ac()
    if (!ctx) return
    const t = ctx.currentTime
    const notes = [523, 659, 784, 1046]
    notes.forEach((freq, index) => this.tone(ctx, freq, t + index * 0.11, 0.22, 'triangle', 0.07))
  }

  castle(): void {
    const ctx = this.ac()
    if (!ctx) return
    const t = ctx.currentTime
    this.burst(ctx, t, 0.04, 0.16, 900)
    this.burst(ctx, t + 0.07, 0.04, 0.14, 1200)
  }

  promote(): void {
    const ctx = this.ac()
    if (!ctx) return
    const t = ctx.currentTime
    this.tone(ctx, 440, t, 0.1, 'sine', 0.06)
    this.tone(ctx, 660, t + 0.08, 0.14, 'sine', 0.06)
  }
}
