import { Mode, ModeContext } from '../core/modes'

export interface PaintColor {
  r: number
  g: number
  b: number
}

/** ペイント: 選択色でパッドをトグル塗り。実機・画面どちらからでも描ける */
class PaintMode implements Mode {
  id = 'paint'
  name = 'ペイント'
  description = 'パッド (実機/画面どちらでも) を押すと選択中の色で塗れます。同じ色をもう一度押すと消えます。'

  color: PaintColor = { r: 127, g: 40, b: 0 }

  onPadDown(ctx: ModeContext, pad: number): void {
    const [r, g, b] = ctx.frame.get(pad)
    const c = this.color
    if (r === c.r && g === c.g && b === c.b) {
      ctx.frame.set(pad, 0, 0, 0)
    } else {
      ctx.frame.set(pad, c.r, c.g, c.b)
    }
  }

  clear(ctx: ModeContext): void {
    ctx.frame.clear()
  }
}

export const paintMode = new PaintMode()
