import { Mode, ModeContext } from '../core/modes'

export interface MacroAssignment {
  type: 'app' | 'url' | 'path'
  target: string
  label?: string
}

const STORAGE_KEY = 'launchpad.macros'

/**
 * マクロパッド (骨組み): パッドにアクション (アプリ起動 / URL / フォルダ) を割り当てる。
 * 実機のパッドを押すと実行。画面上のクリックは「編集対象の選択」として扱い、
 * UI 側 (main.ts) が selectedPad を通じてエディタと連携する。
 */
class MacroMode implements Mode {
  id = 'macro'
  name = 'マクロパッド'
  description =
    '実機のパッドを押すと割り当てたアクションを実行します。画面のパッドをクリックすると編集対象を選択できます。'

  assignments: Record<number, MacroAssignment> = {}
  selectedPad: number | null = null
  /** UI クリック由来の padDown を「選択」として扱うためのフラグ (main.ts が立てる) */
  uiSelectionSource = false

  onSelectionChanged: (() => void) | null = null

  constructor() {
    try {
      this.assignments = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    } catch {
      this.assignments = {}
    }
  }

  onActivate(ctx: ModeContext): void {
    this.redraw(ctx)
  }

  onPadDown(ctx: ModeContext, pad: number): void {
    if (this.uiSelectionSource) {
      // 画面クリック → 編集対象の選択
      this.selectedPad = pad
      this.redraw(ctx)
      this.onSelectionChanged?.()
      return
    }
    const assignment = this.assignments[pad]
    if (!assignment) return
    ctx.frame.set(pad, 127, 127, 127)
    ctx.log(`実行: pad=${pad} → [${assignment.type}] ${assignment.target}`)
    window.api
      .runMacro({ type: assignment.type, target: assignment.target })
      .then((result) => {
        if (result !== 'ok') ctx.log(`実行エラー: ${result}`)
      })
  }

  onPadUp(ctx: ModeContext, pad: number): void {
    this.redraw(ctx)
    void pad
  }

  assign(ctx: ModeContext, pad: number, assignment: MacroAssignment): void {
    this.assignments[pad] = assignment
    this.save()
    this.redraw(ctx)
    ctx.log(`割当: pad=${pad} → [${assignment.type}] ${assignment.target}`)
  }

  unassign(ctx: ModeContext, pad: number): void {
    delete this.assignments[pad]
    this.save()
    this.redraw(ctx)
    ctx.log(`割当解除: pad=${pad}`)
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.assignments))
  }

  private redraw(ctx: ModeContext): void {
    ctx.frame.clear()
    for (const key of Object.keys(this.assignments)) {
      const pad = Number(key)
      ctx.frame.set(pad, 0, 90, 20)
    }
    if (this.selectedPad !== null) {
      const [r, g, b] = ctx.frame.get(this.selectedPad)
      // 選択中パッドは青みを足して区別する
      ctx.frame.set(this.selectedPad, r, g, Math.max(b, 110))
    }
  }
}

export const macroMode = new MacroMode()
