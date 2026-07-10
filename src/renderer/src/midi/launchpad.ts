// Launchpad X デバイス層
// Novation "Launchpad X Programmer's Reference Manual" 準拠
//
// - Programmer モード切替: F0 00 20 29 02 0C 0E <01|00> F7
// - RGB LED 一括更新:      F0 00 20 29 02 0C 03 (03 <pad> <R> <G> <B>)... F7 (各 0-127)
// - パッド入力: 8x8 はノート 11-88 (row*10+col)。周囲のボタンは CC で届く
//   (最上段 = CC 91-98、右列 = CC 19/29/.../89)

const SYSEX_HEADER = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c]

export interface RgbEntry {
  pad: number
  r: number
  g: number
  b: number
}

export interface PortInfo {
  id: string
  name: string
}

type PadHandler = (pad: number, velocity: number) => void
type LogHandler = (message: string) => void
type StateHandler = () => void

export class LaunchpadDevice {
  private access: MIDIAccess | null = null
  private input: MIDIInput | null = null
  private output: MIDIOutput | null = null

  onPadDown: PadHandler | null = null
  onPadUp: PadHandler | null = null
  onLog: LogHandler | null = null
  onStateChange: StateHandler | null = null

  get connected(): boolean {
    return this.input !== null && this.output !== null
  }

  get portName(): string {
    return this.output?.name ?? '(未接続)'
  }

  get currentInputId(): string | null {
    return this.input?.id ?? null
  }

  get currentOutputId(): string | null {
    return this.output?.id ?? null
  }

  async init(): Promise<void> {
    this.access = await navigator.requestMIDIAccess({ sysex: true })
    this.access.onstatechange = () => {
      // 抜き差しに追従: 現在のポートが消えたら再スキャン、未接続なら接続を試みる
      const inputAlive = this.input && this.access!.inputs.get(this.input.id)
      const outputAlive = this.output && this.access!.outputs.get(this.output.id)
      if (!inputAlive || !outputAlive) {
        this.input = null
        this.output = null
      }
      if (!this.connected) {
        this.autoConnect()
      }
      this.onStateChange?.()
    }
    this.logPorts()
    this.autoConnect()
  }

  logPorts(): void {
    const ins = this.listInputs().map((p) => `"${p.name}"`).join(', ') || '(なし)'
    const outs = this.listOutputs().map((p) => `"${p.name}"`).join(', ') || '(なし)'
    this.onLog?.(`検出ポート in: ${ins}`)
    this.onLog?.(`検出ポート out: ${outs}`)
  }

  listInputs(): PortInfo[] {
    return [...(this.access?.inputs.values() ?? [])].map((p) => ({
      id: p.id,
      name: p.name ?? p.id
    }))
  }

  listOutputs(): PortInfo[] {
    return [...(this.access?.outputs.values() ?? [])].map((p) => ({
      id: p.id,
      name: p.name ?? p.id
    }))
  }

  /**
   * MIDI インターフェース (Programmer モード用) を優先して自動接続する。
   * Windows でのポート名は紛らわしく、"LPX MIDI" が DAW ポートで、
   * 本命の MIDI ポートは "MIDIIN2 (LPX MIDI)" / "MIDIOUT2 (LPX MIDI)"。
   * Mac では "LPX MIDI Out" 等が本命で "LPX DAW" が DAW ポート。
   */
  autoConnect(): boolean {
    if (!this.access) return false
    const score = (name: string): number => {
      const n = name.toLowerCase()
      if (n.includes('daw')) return 0
      const isLp = n.includes('lpx') || n.includes('launchpad')
      if (!isLp) return 0
      // Windows の第 2 インターフェース (真の MIDI ポート) を最優先
      if (n.includes('midiin') || n.includes('midiout')) return 4
      if (n.includes('midi')) return 3
      return 1
    }
    const best = <T extends MIDIPort>(ports: Iterable<T>): T | null => {
      let top: T | null = null
      let topScore = 0
      for (const p of ports) {
        const s = score(p.name ?? '')
        if (s > topScore) {
          top = p
          topScore = s
        }
      }
      return top
    }
    const input = best(this.access.inputs.values())
    const output = best(this.access.outputs.values())
    if (!input || !output) return false
    this.usePorts(input, output)
    return true
  }

  /** UI からの手動ポート選択用 */
  selectPorts(inputId: string, outputId: string): void {
    if (!this.access) return
    const input = this.access.inputs.get(inputId)
    const output = this.access.outputs.get(outputId)
    if (input && output) this.usePorts(input, output)
    this.onStateChange?.()
  }

  private usePorts(input: MIDIInput, output: MIDIOutput): void {
    if (this.input) this.input.onmidimessage = null
    this.input = input
    this.output = output
    input.onmidimessage = (e) => this.handleMessage(e)
    this.onLog?.(`接続: in="${input.name}" out="${output.name}"`)
    this.enterProgrammerMode()
    this.onStateChange?.()
  }

  enterProgrammerMode(): void {
    this.sendSysEx([0x0e, 0x01])
    this.onLog?.('Programmer モードに切替')
  }

  exitProgrammerMode(): void {
    this.clearAll()
    this.sendSysEx([0x0e, 0x00])
    this.onLog?.('Live モードに復帰')
  }

  /** RGB 一括更新。1 メッセージ最大 81 エントリ制限があるためチャンク分割する */
  sendRgb(entries: RgbEntry[]): void {
    if (!this.output || entries.length === 0) return
    const CHUNK = 60
    for (let i = 0; i < entries.length; i += CHUNK) {
      const body: number[] = [0x03]
      for (const e of entries.slice(i, i + CHUNK)) {
        body.push(0x03, e.pad & 0x7f, e.r & 0x7f, e.g & 0x7f, e.b & 0x7f)
      }
      this.sendSysEx(body)
    }
  }

  /** パレット色 (0-127)。flash/pulse は本体側で自動アニメーションされる */
  sendPalette(pad: number, color: number, mode: 'static' | 'flash' | 'pulse' = 'static'): void {
    const kind = mode === 'static' ? 0x00 : mode === 'flash' ? 0x01 : 0x02
    this.sendSysEx([0x03, kind, pad & 0x7f, color & 0x7f])
  }

  clearAll(): void {
    const entries: RgbEntry[] = []
    for (let row = 1; row <= 9; row++) {
      for (let col = 1; col <= 9; col++) {
        entries.push({ pad: row * 10 + col, r: 0, g: 0, b: 0 })
      }
    }
    this.sendRgb(entries)
  }

  private sendSysEx(body: number[]): void {
    if (!this.output) return
    try {
      this.output.send([...SYSEX_HEADER, ...body, 0xf7])
    } catch (err) {
      this.onLog?.(`SysEx 送信失敗: ${err}`)
    }
  }

  private handleMessage(e: MIDIMessageEvent): void {
    const data = e.data
    if (!data || data.length < 3) return
    const status = data[0] & 0xf0
    const key = data[1]
    const value = data[2]

    if (status === 0x90) {
      // Note On (velocity 0 は Note Off 扱い)
      if (value > 0) this.onPadDown?.(key, value)
      else this.onPadUp?.(key, 0)
    } else if (status === 0x80) {
      this.onPadUp?.(key, 0)
    } else if (status === 0xb0 && key >= 11 && key <= 99) {
      // 周囲のボタンは CC で届く: 最上段=91-98、右列=19/29/.../89。
      // CC 番号がそのままパッド ID 空間に載る
      if (value > 0) this.onPadDown?.(key, value)
      else this.onPadUp?.(key, 0)
    }
    // ポリアフタータッチ (0xA0) は現状ログのみ (必要になったら拡張)
  }
}

/** pad ID (11-99) → 0-indexed 座標。col: 0-8 (左→右), row: 0-8 (下→上) */
export function padToXY(pad: number): { x: number; y: number } {
  return { x: (pad % 10) - 1, y: Math.floor(pad / 10) - 1 }
}

export function xyToPad(x: number, y: number): number {
  return (y + 1) * 10 + (x + 1)
}
