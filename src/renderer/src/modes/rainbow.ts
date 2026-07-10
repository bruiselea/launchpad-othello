import { Mode, ModeContext } from '../core/modes'
import { padToXY } from '../midi/launchpad'

interface Ripple {
  x: number
  y: number
  start: number
}

/** レインボーウェーブ + 押した場所から波紋が広がるデモ */
class RainbowMode implements Mode {
  id = 'rainbow'
  name = 'レインボー'
  description = '虹色の波が流れます。パッドを押すとそこから白い波紋が広がります。'

  private ripples: Ripple[] = []

  onActivate(): void {
    this.ripples = []
  }

  onPadDown(_ctx: ModeContext, pad: number): void {
    const { x, y } = padToXY(pad)
    this.ripples.push({ x, y, start: performance.now() / 1000 })
    if (this.ripples.length > 16) this.ripples.shift()
  }

  onFrame(ctx: ModeContext, _dt: number, t: number): void {
    const now = performance.now() / 1000
    this.ripples = this.ripples.filter((r) => now - r.start < 1.5)

    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const hue = ((x + y) / 18 + t * 0.12) % 1
        let [r, g, b] = hsvToRgb(hue, 1, 0.35)

        // 波紋: リング上のセルを白く持ち上げる
        for (const rp of this.ripples) {
          const age = now - rp.start
          const radius = age * 7
          const dist = Math.hypot(x - rp.x, y - rp.y)
          const ring = Math.max(0, 1 - Math.abs(dist - radius) * 1.2) * Math.max(0, 1 - age / 1.5)
          if (ring > 0) {
            r = Math.min(1, r + ring)
            g = Math.min(1, g + ring)
            b = Math.min(1, b + ring)
          }
        }

        ctx.frame.setXY(x, y, r * 127, g * 127, b * 127)
      }
    }
  }
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (i % 6) {
    case 0: return [v, t, p]
    case 1: return [q, v, p]
    case 2: return [p, v, t]
    case 3: return [p, q, v]
    case 4: return [t, p, v]
    default: return [v, p, q]
  }
}

export const rainbowMode = new RainbowMode()
