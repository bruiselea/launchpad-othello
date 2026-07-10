import { Mode } from '../core/modes'
import { padToXY } from '../midi/launchpad'

/** 入力モニタ: 押したパッドをベロシティに応じた明るさで光らせ、ログに出す */
export const monitorMode: Mode = {
  id: 'monitor',
  name: '入力モニタ',
  description: 'パッドを押すとベロシティに応じた明るさで光り、イベントがログに流れます。',

  onPadDown(ctx, pad, velocity) {
    const { x, y } = padToXY(pad)
    const v = Math.max(20, velocity)
    ctx.frame.set(pad, v, v, v)
    ctx.log(`↓ pad=${pad} (x=${x}, y=${y}) vel=${velocity}`)
  },

  onPadUp(ctx, pad) {
    ctx.frame.set(pad, 0, 0, 0)
    ctx.log(`↑ pad=${pad}`)
  }
}
