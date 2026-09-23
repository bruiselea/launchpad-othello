import { Mode, ModeContext } from '../core/modes'
import { xyToPad } from '../midi/launchpad'

type Cell = 0 | 1 | 2 // 0=空, 1=黒, 2=白
type Opponent = 'jev' | 'human'

const SIZE = 8
const RESET_CHORD = [44, 45, 54, 55]
const DIRECTIONS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1]
]

const EMPTY_COLOR: [number, number, number] = [0, 0, 0]
const FLIP_COLOR: [number, number, number] = [127, 122, 0]

/**
 * オセロ: Launchpad X の 8x8 パッドグリッドをそのまま盤面として使う。
 * 先手/後手の対戦。合法手が無いプレイヤーは自動パス。
 * 双方パス、または全マス埋まったらゲーム終了として得点をログに出す。
 */
class OthelloMode implements Mode {
  id = 'othello'
  name = 'オセロ'
  description = '実機または画面のパッドで石を置きます。Jev 対戦ではあなたが先手です。'

  private board: Cell[][] = []
  private turn: Cell = 1 // 1=黒, 2=白
  private flipping: { x: number; y: number }[] = []
  private flipTimer = 0
  private gameOver = false
  private firstColor: [number, number, number] = [0, 66, 127]
  private secondColor: [number, number, number] = [127, 72, 0]
  private heldPads = new Set<number>()
  private opponent: Opponent = 'jev'
  private jevPending = false
  private gameVersion = 0

  onGameEnd: ((color: [number, number, number]) => void) | null = null
  onReset: (() => void) | null = null
  onJevMove: ((board: number[][], legalMoves: { pad: number; flips: number }[]) => Promise<number>) | null = null
  onOpponentStatus: ((message: string) => void) | null = null

  onActivate(ctx: ModeContext): void {
    this.reset(ctx)
  }

  onPadDown(ctx: ModeContext, pad: number): void {
    this.heldPads.add(pad)
    if (this.gameOver) {
      if (RESET_CHORD.every((resetPad) => this.heldPads.has(resetPad))) this.reset(ctx)
      return
    }
    if (this.flipping.length > 0) return
    if (this.opponent === 'jev' && this.turn === 2) return

    // 何らかの理由で手番のプレイヤーに合法手がない状態になった場合も、
    // 次のクリックで確実にパスさせる。
    if (!this.hasLegalMove(this.turn)) {
      this.advanceTurn(ctx)
      this.render(ctx)
      if (this.gameOver || this.flipping.length > 0) return
      if (this.opponent === 'jev' && this.turn === 2) {
        this.requestJevMove(ctx)
        return
      }
    }

    const { x, y } = padToXY8(pad)
    if (x === null || y === null) return

    const flips = this.legalFlips(x, y, this.turn)
    if (flips.length === 0) return

    this.playMove(ctx, x, y, flips)
  }

  private playMove(ctx: ModeContext, x: number, y: number, flips: [number, number][]): void {
    this.board[y][x] = this.turn
    for (const [fx, fy] of flips) this.board[fy][fx] = this.turn
    this.flipping = flips.map(([fx, fy]) => ({ x: fx, y: fy }))
    this.flipTimer = 0.35

    ctx.log(
      `${this.turn === 1 ? '黒' : '白'}: (${x},${y}) に着手、${flips.length}枚ひっくり返す`
    )

    this.advanceTurn(ctx)
    this.render(ctx)
    if (!this.gameOver && this.flipping.length === 0 && this.opponent === 'jev') {
      this.requestJevMove(ctx)
    }
  }

  onFrame(ctx: ModeContext, dt: number): void {
    if (this.flipping.length === 0) return
    this.flipTimer -= dt
    if (this.flipTimer <= 0) {
      this.flipping = []
      this.render(ctx)
      if (this.opponent === 'jev') this.requestJevMove(ctx)
    } else {
      this.render(ctx, true)
    }
  }

  onPadUp(_ctx: ModeContext, pad: number): void {
    this.heldPads.delete(pad)
  }

  reset(ctx: ModeContext): void {
    this.gameVersion++
    this.jevPending = false
    this.onReset?.()
    this.heldPads.clear()
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
    this.onOpponentStatus?.(this.opponent === 'jev' ? 'あなたの手番（先手）' : '2人対戦')
  }

  setOpponent(ctx: ModeContext, opponent: Opponent): void {
    this.opponent = opponent
    this.reset(ctx)
  }

  retryJevMove(ctx: ModeContext): void {
    this.requestJevMove(ctx)
  }

  private requestJevMove(ctx: ModeContext): void {
    if (this.opponent !== 'jev' || this.turn !== 2 || this.gameOver ||
        this.flipping.length > 0 || this.jevPending || !this.onJevMove) return

    const legalMoves: { pad: number; flips: number }[] = []
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const flips = this.legalFlips(x, y, 2)
        if (flips.length > 0) legalMoves.push({ pad: xyToPad(x, y), flips: flips.length })
      }
    }
    if (legalMoves.length === 0) {
      this.advanceTurn(ctx)
      this.render(ctx)
      this.onOpponentStatus?.(this.gameOver ? '対局終了' : 'あなたの手番（Jev はパス）')
      return
    }

    if (legalMoves.length === 1) {
      const pad = legalMoves[0].pad
      const x = pad % 10 - 1
      const y = Math.floor(pad / 10) - 1
      this.playMove(ctx, x, y, this.legalFlips(x, y, 2))
      return
    }

    this.jevPending = true
    this.onOpponentStatus?.('Jev が考えています…')
    const version = this.gameVersion
    const board = this.board.map((row) => [...row])
    this.onJevMove(board, legalMoves).then((pad) => {
      if (version !== this.gameVersion || this.opponent !== 'jev') return
      this.jevPending = false
      if (!legalMoves.some((move) => move.pad === pad)) throw new Error('Jev が合法手以外を選びました')
      const x = pad % 10 - 1
      const y = Math.floor(pad / 10) - 1
      const flips = this.legalFlips(x, y, 2)
      if (flips.length === 0) throw new Error('Jev の着手を適用できません')
      this.playMove(ctx, x, y, flips)
      if (!this.gameOver) {
        this.onOpponentStatus?.(this.turn === 1 ? 'あなたの手番' : 'Jev の連続手番')
      }
    }).catch((error) => {
      if (version !== this.gameVersion) return
      this.jevPending = false
      const message = error instanceof Error ? error.message : String(error)
      ctx.log(`Jev エラー: ${message}`)
      this.onOpponentStatus?.(`Jev エラー: ${message}（再試行できます）`)
    })
  }

  setPieceColors(
    ctx: ModeContext,
    firstColor: [number, number, number],
    secondColor: [number, number, number]
  ): void {
    this.firstColor = firstColor
    this.secondColor = secondColor
    this.render(ctx)
  }

  /** セレブレーションと終局後の操作を確認するためのデバッグ用盤面。 */
  debugEndGame(ctx: ModeContext): void {
    this.board = Array.from({ length: SIZE }, (_, y) =>
      Array.from({ length: SIZE }, (_, x): Cell => ((x + y * 3) % 5 === 0 ? 2 : 1))
    )
    this.turn = 1
    this.flipping = []
    this.gameOver = false
    this.endGame(ctx)
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
    ctx.log(`対局終了: 黒 ${black} - 白 ${white} → ${result}（中央4パッド同時押しで新規対局）`)
    this.onOpponentStatus?.('対局終了')
    this.onGameEnd?.(black === white ? [127, 112, 0] : black > white ? this.firstColor : this.secondColor)
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
          color = flipPulse ? FLIP_COLOR : cell === 1 ? this.firstColor : this.secondColor
        } else if (cell === 1) {
          color = this.firstColor
        } else if (cell === 2) {
          color = this.secondColor
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
