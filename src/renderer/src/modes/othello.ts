import { Mode, ModeContext } from '../core/modes'
import { xyToPad } from '../midi/launchpad'

type Cell = 0 | 1 | 2 // 0=空, 1=黒, 2=白

const SIZE = 8
const DIRECTIONS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1]
]

const EMPTY_COLOR: [number, number, number] = [0, 12, 0]
const BLACK_COLOR: [number, number, number] = [90, 0, 90]
const WHITE_COLOR: [number, number, number] = [110, 110, 110]
const HINT_COLOR: [number, number, number] = [0, 40, 40]
const FLIP_COLOR: [number, number, number] = [127, 90, 0]

/**
 * オセロ: Launchpad X の 8x8 パッドグリッドをそのまま盤面として使う。
 * 黒(紫) / 白(グレー) の2人対戦。合法手が無いプレイヤーは自動パス。
 * 双方パス、または全マス埋まったらゲーム終了として得点をログに出す。
 */
class OthelloMode implements Mode {
  id = 'othello'
  name = 'オセロ'
  description = '実機/画面のパッドで交互に石を置く2人対戦。合法手はうっすら光ります。'

  private board: Cell[][] = []
  private turn: Cell = 1 // 1=黒, 2=白
  private flipping: { x: number; y: number }[] = []
  private flipTimer = 0
  private gameOver = false

  onActivate(ctx: ModeContext): void {
    this.reset(ctx)
  }

  onPadDown(ctx: ModeContext, pad: number): void {
    if (this.gameOver || this.flipping.length > 0) return
    const { x, y } = padToXY8(pad)
    if (x === null || y === null) return

    const flips = this.legalFlips(x, y, this.turn)
    if (flips.length === 0) return

    this.board[y][x] = this.turn
    for (const [fx, fy] of flips) this.board[fy][fx] = this.turn
    this.flipping = flips.map(([fx, fy]) => ({ x: fx, y: fy }))
    this.flipTimer = 0.35

    ctx.log(
      `${this.turn === 1 ? '黒' : '白'}: (${x},${y}) に着手、${flips.length}枚ひっくり返す`
    )

    this.advanceTurn(ctx)
    this.render(ctx)
  }

  onFrame(ctx: ModeContext, dt: number): void {
    if (this.flipping.length === 0) return
    this.flipTimer -= dt
    if (this.flipTimer <= 0) {
      this.flipping = []
      this.render(ctx)
    } else {
      this.render(ctx, true)
    }
  }

  reset(ctx: ModeContext): void {
    this.board = Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(0))
    const mid = SIZE / 2
    this.board[mid - 1][mid - 1] = 2
    this.board[mid - 1][mid] = 1
    this.board[mid][mid - 1] = 1
    this.board[mid][mid] = 2
    this.turn = 1
    this.flipping = []
    this.gameOver = false
    ctx.log('オセロ: 新規対局開始 (黒 先手)')
    this.render(ctx)
  }

  private advanceTurn(ctx: ModeContext): void {
    const other: Cell = this.turn === 1 ? 2 : 1
    if (this.hasLegalMove(other)) {
      this.turn = other
      return
    }
    if (this.hasLegalMove(this.turn)) {
      ctx.log(`${other === 1 ? '黒' : '白'}: 合法手なし、パス`)
      return
    }
    this.endGame(ctx)
  }

  private endGame(ctx: ModeContext): void {
    this.gameOver = true
    let black = 0
    let white = 0
    for (const row of this.board) {
      for (const cell of row) {
        if (cell === 1) black++
        if (cell === 2) white++
      }
    }
    const result = black === white ? '引き分け' : black > white ? '黒の勝ち' : '白の勝ち'
    ctx.log(`対局終了: 黒 ${black} - 白 ${white} → ${result}（パッドを押すと新規対局）`)
  }

  private hasLegalMove(player: Cell): boolean {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (this.board[y][x] === 0 && this.legalFlips(x, y, player).length > 0) return true
      }
    }
    return false
  }

  private legalFlips(x: number, y: number, player: Cell): [number, number][] {
    if (this.board[y][x] !== 0) return []
    const opponent: Cell = player === 1 ? 2 : 1
    const flips: [number, number][] = []

    for (const [dx, dy] of DIRECTIONS) {
      const line: [number, number][] = []
      let nx = x + dx
      let ny = y + dy
      while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && this.board[ny][nx] === opponent) {
        line.push([nx, ny])
        nx += dx
        ny += dy
      }
      if (
        line.length > 0 &&
        nx >= 0 &&
        nx < SIZE &&
        ny >= 0 &&
        ny < SIZE &&
        this.board[ny][nx] === player
      ) {
        flips.push(...line)
      }
    }
    return flips
  }

  private render(ctx: ModeContext, flipPulse = false): void {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const cell = this.board[y][x]
        const isFlipping = this.flipping.some((f) => f.x === x && f.y === y)
        let color: [number, number, number]

        if (isFlipping) {
          color = flipPulse ? FLIP_COLOR : cell === 1 ? BLACK_COLOR : WHITE_COLOR
        } else if (cell === 1) {
          color = BLACK_COLOR
        } else if (cell === 2) {
          color = WHITE_COLOR
        } else if (!this.gameOver && this.legalFlips(x, y, this.turn).length > 0) {
          color = HINT_COLOR
        } else {
          color = EMPTY_COLOR
        }

        const pad = xyToPad(x, y)
        ctx.frame.set(pad, ...color)
      }
    }
  }
}

/** オセロ盤は左下 8x8 (x,y: 0-7) のみを使う。それ以外のパッドは無視 */
function padToXY8(pad: number): { x: number | null; y: number | null } {
  const x = (pad % 10) - 1
  const y = Math.floor(pad / 10) - 1
  if (x < 0 || x > 7 || y < 0 || y > 7) return { x: null, y: null }
  return { x, y }
}

export const othelloMode = new OthelloMode()
