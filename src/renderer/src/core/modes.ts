import { FrameBuffer } from './frame'
import { LaunchpadDevice } from '../midi/launchpad'

export interface ModeContext {
  frame: FrameBuffer
  device: LaunchpadDevice
  log: (message: string) => void
}

/**
 * 「モード」= Launchpad の使い方 1 つ分のプラグイン。
 * LED デモ・ゲーム・マクロパッド・MIDI 用途をすべてこの形で載せる。
 * 描画は ctx.frame にのみ行い、実機への送信はフレームループが面倒を見る。
 */
export interface Mode {
  id: string
  name: string
  description: string
  onActivate?(ctx: ModeContext): void
  onDeactivate?(ctx: ModeContext): void
  onPadDown?(ctx: ModeContext, pad: number, velocity: number): void
  onPadUp?(ctx: ModeContext, pad: number): void
  /** 毎フレーム呼ばれる。dt/t は秒 */
  onFrame?(ctx: ModeContext, dt: number, t: number): void
}

export class ModeManager {
  private modes = new Map<string, Mode>()
  private active: Mode | null = null
  private lastTime = 0
  private startTime = 0
  private running = false

  onModeChanged: ((mode: Mode) => void) | null = null

  constructor(
    private ctx: ModeContext,
    private mirror: (pad: number, r: number, g: number, b: number) => void
  ) {}

  register(mode: Mode): void {
    this.modes.set(mode.id, mode)
  }

  list(): Mode[] {
    return [...this.modes.values()]
  }

  get activeMode(): Mode | null {
    return this.active
  }

  activate(id: string): void {
    const mode = this.modes.get(id)
    if (!mode || mode === this.active) return
    this.active?.onDeactivate?.(this.ctx)
    this.ctx.frame.clear()
    this.active = mode
    this.startTime = performance.now() / 1000
    mode.onActivate?.(this.ctx)
    this.ctx.log(`モード切替: ${mode.name}`)
    this.onModeChanged?.(mode)
  }

  padDown(pad: number, velocity: number): void {
    this.active?.onPadDown?.(this.ctx, pad, velocity)
  }

  padUp(pad: number): void {
    this.active?.onPadUp?.(this.ctx, pad)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now() / 1000
    const loop = (): void => {
      if (!this.running) return
      const now = performance.now() / 1000
      const dt = Math.min(now - this.lastTime, 0.1)
      this.lastTime = now
      this.active?.onFrame?.(this.ctx, dt, now - this.startTime)
      this.ctx.frame.flush(this.ctx.device, this.mirror)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  stop(): void {
    this.running = false
  }
}
