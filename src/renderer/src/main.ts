import { LaunchpadDevice, RgbEntry } from './midi/launchpad'
import { FrameBuffer } from './core/frame'
import { ModeManager, ModeContext } from './core/modes'
import { othelloMode } from './modes/othello'

// ---- DOM 参照 ----
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const gridEl = $('grid')
const logEl = $('log')
const statusDot = $('status-dot')
const statusText = $('status-text')
const portInSel = $<HTMLSelectElement>('port-in')
const portOutSel = $<HTMLSelectElement>('port-out')
const firstColorSel = $<HTMLSelectElement>('first-color')
const secondColorSel = $<HTMLSelectElement>('second-color')
const opponentSel = $<HTMLSelectElement>('opponent-mode')
const jevProvider = $<HTMLSelectElement>('jev-provider')
const jevStatus = $('jev-status')
const jevKey = $<HTMLInputElement>('jev-key')
const jevKeyLink = $<HTMLAnchorElement>('jev-key-link')
let configuredJevProvider: 'openrouter' | 'typesafe' | null = null

const pieceColors: Record<string, [number, number, number]> = {
  blue: [0, 66, 127],
  sky: [0, 105, 127],
  cyan: [0, 127, 127],
  aqua: [0, 127, 72],
  green: [0, 127, 28],
  lime: [82, 127, 0],
  purple: [90, 0, 127],
  violet: [118, 0, 127],
  orange: [127, 72, 0],
  amber: [127, 100, 0],
  yellow: [127, 127, 0],
  red: [127, 0, 0],
  coral: [127, 26, 8],
  salmon: [127, 55, 24],
  white: [127, 127, 127]
}

// ---- ログ ----
function log(message: string): void {
  const line = document.createElement('div')
  line.className = 'line'
  const t = new Date().toLocaleTimeString('ja-JP', { hour12: false })
  line.textContent = `[${t}] ${message}`
  logEl.appendChild(line)
  while (logEl.childElementCount > 200) logEl.firstElementChild?.remove()
  logEl.scrollTop = logEl.scrollHeight
}

// ---- グリッドミラー DOM ----
const cells = new Map<number, HTMLDivElement>()

function buildGrid(): void {
  // 上段 (row=9, CC 行) から下へ描画。右列 (col=9) と上段は丸ボタン
  for (let row = 9; row >= 1; row--) {
    for (let col = 1; col <= 9; col++) {
      const pad = row * 10 + col
      const cell = document.createElement('div')
      cell.className = 'cell' + (row === 9 || col === 9 ? ' round' : '')
      cell.title = `pad ${pad}`
      cell.addEventListener('mousedown', () => manager.padDown(pad, 127))
      cell.addEventListener('mouseup', () => manager.padUp(pad))
      cell.addEventListener('mouseleave', () => manager.padUp(pad))
      gridEl.appendChild(cell)
      cells.set(pad, cell)
    }
  }
}

function mirror(pad: number, r: number, g: number, b: number): void {
  const cell = cells.get(pad)
  if (!cell) return
  if (r === 0 && g === 0 && b === 0) {
    cell.style.background = ''
    return
  }
  // 0-127 → 0-255。暗い色も画面で見えるよう下駄を履かせる
  const scale = (v: number): number => Math.min(255, Math.round(v * 1.7 + (v > 0 ? 40 : 0)))
  cell.style.background = `rgb(${scale(r)}, ${scale(g)}, ${scale(b)})`
}

// ---- デバイス / コア ----
const device = new LaunchpadDevice()
const frame = new FrameBuffer()
const ctx: ModeContext = { frame, device, log }
const manager = new ModeManager(ctx, mirror)

let celebrationRun = 0
function celebrate(color: [number, number, number]): void {
  const run = ++celebrationRun
  let step = 0
  const waveSteps = 28
  const finaleSteps = 6
  const play = (): void => {
    if (run !== celebrationRun) return
    const entries: RgbEntry[] = []
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        // 斜めに走る光の波。最後は盤面全体を勝者色で点滅させる。
        const wave = (Math.sin(x * 0.95 + y * 0.7 - step * 0.72) + 1) / 2
        const bright = step < waveSteps ? 0.14 + wave * 0.86 : step % 2 === 0 ? 1 : 0.18
        entries.push({
          pad: (y + 1) * 10 + x + 1,
          r: Math.round(color[0] * bright),
          g: Math.round(color[1] * bright),
          b: Math.round(color[2] * bright)
        })
      }
    }
    device.sendRgb(entries)
    step++
    if (step < waveSteps + finaleSteps) setTimeout(play, 105)
    else frame.invalidate()
  }
  play()
}

othelloMode.onGameEnd = celebrate
othelloMode.onReset = () => {
  celebrationRun++
}
othelloMode.onJevMove = (board, legalMoves) => window.api.chooseJevMove({ board, legalMoves })
othelloMode.onOpponentStatus = (message) => {
  jevStatus.textContent = message
}

device.onPadDown = (pad, vel) => manager.padDown(pad, vel)
device.onPadUp = (pad) => manager.padUp(pad)
device.onLog = log

device.onStateChange = () => {
  updateStatus()
  updatePortSelectors()
  if (device.connected) {
    connectFlourish()
  }
}

function updateStatus(): void {
  statusDot.className = 'dot ' + (device.connected ? 'connected' : 'disconnected')
  statusText.textContent = device.connected ? `接続中: ${device.portName}` : 'Launchpad 未検出'
}

function updatePortSelectors(): void {
  const fill = (sel: HTMLSelectElement, ports: { id: string; name: string }[]): void => {
    sel.innerHTML = ''
    for (const p of ports) {
      const opt = document.createElement('option')
      opt.value = p.id
      opt.textContent = p.name
      sel.appendChild(opt)
    }
  }
  fill(portInSel, device.listInputs())
  fill(portOutSel, device.listOutputs())
  if (device.currentInputId) portInSel.value = device.currentInputId
  if (device.currentOutputId) portOutSel.value = device.currentOutputId
}

/** 接続確認デモ: 下から上へ白い列が走ってから消える */
let flourishRunning = false
function connectFlourish(): void {
  if (flourishRunning) return
  flourishRunning = true
  let row = 1
  const step = (): void => {
    const entries: RgbEntry[] = []
    for (let col = 1; col <= 9; col++) {
      if (row <= 9) entries.push({ pad: row * 10 + col, r: 80, g: 80, b: 100 })
      if (row - 2 >= 1) entries.push({ pad: (row - 2) * 10 + col, r: 0, g: 0, b: 0 })
    }
    device.sendRgb(entries)
    row++
    if (row <= 11) {
      setTimeout(step, 45)
    } else {
      device.clearAll()
      frame.invalidate() // オセロ盤の表示に戻す
      flourishRunning = false
    }
  }
  step()
}

// ---- 新規対局ボタン ----
$('othello-reset').addEventListener('click', () => {
  othelloMode.reset(ctx)
})

opponentSel.addEventListener('change', () => {
  othelloMode.setOpponent(ctx, opponentSel.value === 'human' ? 'human' : 'jev')
  jevProvider.disabled = opponentSel.value === 'human'
  jevKey.disabled = opponentSel.value === 'human'
  $('jev-connect').toggleAttribute('disabled', opponentSel.value === 'human')
  $('jev-retry').toggleAttribute('disabled', opponentSel.value === 'human')
})

jevProvider.addEventListener('change', () => {
  const openrouter = jevProvider.value === 'openrouter'
  jevKey.value = ''
  jevKey.placeholder = `${openrouter ? 'OpenRouter' : 'TypeSafe'} API キー`
  jevKeyLink.href = openrouter
    ? 'https://openrouter.ai/workspaces/default/keys'
    : 'https://console.typesafe.ai/'
  jevKeyLink.textContent = `${openrouter ? 'OpenRouter' : 'TypeSafe'} で API キーを取得`
  if (configuredJevProvider && configuredJevProvider !== jevProvider.value) {
    jevStatus.textContent = '発行元を切り替えるには、新しい API キーを入力して「設定」を押してください'
  }
})

$('jev-connect').addEventListener('click', async () => {
  try {
    const provider = jevProvider.value === 'typesafe' ? 'typesafe' : 'openrouter'
    await window.api.setJevKey(provider, jevKey.value)
    configuredJevProvider = provider
    jevKey.value = ''
    othelloMode.reset(ctx)
    log(`${provider === 'openrouter' ? 'OpenRouter' : 'TypeSafe'} の Jev API キーを設定しました。新規対局を開始します。`)
  } catch (error) {
    jevStatus.textContent = `Jev の設定エラー: ${error instanceof Error ? error.message : String(error)}`
  }
})

$('jev-retry').addEventListener('click', () => othelloMode.retryJevMove(ctx))

function updatePieceColors(): void {
  othelloMode.setPieceColors(
    ctx,
    pieceColors[firstColorSel.value] ?? pieceColors.blue,
    pieceColors[secondColorSel.value] ?? pieceColors.orange
  )
}

firstColorSel.addEventListener('change', updatePieceColors)
secondColorSel.addEventListener('change', updatePieceColors)
$('test-first-celebration').addEventListener('click', () => {
  celebrate(pieceColors[firstColorSel.value] ?? pieceColors.blue)
})
$('test-second-celebration').addEventListener('click', () => {
  celebrate(pieceColors[secondColorSel.value] ?? pieceColors.orange)
})
$('debug-endgame').addEventListener('click', () => othelloMode.debugEndGame(ctx))

// ---- ポート手動選択 ----
$('reconnect').addEventListener('click', () => {
  if (portInSel.value && portOutSel.value) {
    device.selectPorts(portInSel.value, portOutSel.value)
  } else {
    device.autoConnect()
  }
})

// ---- 終了処理: Launchpad を Live モードに戻してから終了 ----
window.api.onShutdown(() => {
  try {
    device.exitProgrammerMode()
  } finally {
    // SysEx 送出の猶予を少しだけ取る
    setTimeout(() => window.api.quitReady(), 150)
  }
})

// ---- 起動 ----
async function start(): Promise<void> {
  buildGrid()

  manager.register(othelloMode)
  $('mode-desc').textContent = othelloMode.description

  manager.activate('othello')
  manager.start()

  try {
    const provider = await window.api.jevAvailable()
    if (provider) {
      configuredJevProvider = provider
      jevProvider.value = provider
      jevProvider.dispatchEvent(new Event('change'))
      jevStatus.textContent = `${provider === 'openrouter' ? 'OpenRouter' : 'TypeSafe'} の API キーを読み込みました`
    } else {
      jevStatus.textContent = 'Jev を使うには API キーを入力してください'
    }
  } catch (error) {
    jevStatus.textContent = `Jev の確認に失敗: ${error instanceof Error ? error.message : String(error)}`
  }

  try {
    await device.init()
    updateStatus()
    updatePortSelectors()
    if (!device.connected) {
      log('Launchpad X が見つかりません。USB 接続を確認してください (抜き差しすれば自動検出されます)')
    }
  } catch (err) {
    statusText.textContent = 'WebMIDI 初期化失敗'
    log(`WebMIDI エラー: ${err}`)
  }
}

start()
