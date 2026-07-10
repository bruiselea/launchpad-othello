import { LaunchpadDevice, RgbEntry, xyToPad } from '../midi/launchpad'

/**
 * 9x9 の仮想フレームバッファ。モードはここに描き、フレームごとに
 * 差分だけを実機 (SysEx 一括 RGB) と画面ミラーへ反映する。
 * 色成分は Launchpad の仕様に合わせて 0-127。
 */
export class FrameBuffer {
  // index = pad ID (11-99)。r,g,b を平坦に持つ
  private next = new Uint8Array(100 * 3)
  private current = new Uint8Array(100 * 3)
  private forceAll = false

  set(pad: number, r: number, g: number, b: number): void {
    if (pad < 11 || pad > 99) return
    const i = pad * 3
    this.next[i] = clamp7(r)
    this.next[i + 1] = clamp7(g)
    this.next[i + 2] = clamp7(b)
  }

  setXY(x: number, y: number, r: number, g: number, b: number): void {
    if (x < 0 || x > 8 || y < 0 || y > 8) return
    this.set(xyToPad(x, y), r, g, b)
  }

  get(pad: number): [number, number, number] {
    const i = pad * 3
    return [this.next[i], this.next[i + 1], this.next[i + 2]]
  }

  clear(): void {
    this.next.fill(0)
  }

  /** 次回 flush で全 LED を強制送信する (再接続直後の同期用) */
  invalidate(): void {
    this.forceAll = true
  }

  /** 差分を実機と画面へ反映する */
  flush(device: LaunchpadDevice, mirror?: (pad: number, r: number, g: number, b: number) => void): void {
    const entries: RgbEntry[] = []
    for (let row = 1; row <= 9; row++) {
      for (let col = 1; col <= 9; col++) {
        const pad = row * 10 + col
        const i = pad * 3
        const changed =
          this.forceAll ||
          this.next[i] !== this.current[i] ||
          this.next[i + 1] !== this.current[i + 1] ||
          this.next[i + 2] !== this.current[i + 2]
        if (changed) {
          entries.push({ pad, r: this.next[i], g: this.next[i + 1], b: this.next[i + 2] })
          mirror?.(pad, this.next[i], this.next[i + 1], this.next[i + 2])
        }
      }
    }
    if (entries.length > 0 && device.connected) device.sendRgb(entries)
    this.current.set(this.next)
    this.forceAll = false
  }
}

function clamp7(v: number): number {
  return Math.max(0, Math.min(127, Math.round(v)))
}
