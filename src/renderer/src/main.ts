import { LaunchpadDevice, padToXY, RgbEntry } from './midi/launchpad'
import { FrameBuffer } from './core/frame'
import { ModeManager, ModeContext } from './core/modes'
import { monitorMode } from './modes/monitor'
import { paintMode, PaintColor } from './modes/paint'
import { rainbowMode } from './modes/rainbow'
import { macroMode } from './modes/macro'
import { othelloMode } from './modes/othello'

// ---- DOM 参照 ----
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const gridEl = $('grid')
const logEl = $('log')
const statusDot = $('status-dot')
const statusText = $('status-text')
const portInSel = $<HTMLSelectElement>('port-in')
const portOutSel = $<HTMLSelectElement>('port-out')

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
      cell.addEventListener('mousedown', () => uiPadDown(pad))
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

function uiPadDown(pad: number): void {
  // マクロモードでは画面クリック = 編集対象の選択
  if (manager.activeMode === macroMode) {
    macroMode.uiSelectionSource = true
    manager.padDown(pad, 127)
    macroMode.uiSelectionSource = false
    return
  }
  manager.padDown(pad, 127)
}

device.onPadDown = (pad, vel) => manager.padDown(pad, vel)
device.onPadUp = (pad) => manager.padUp(pad)
device.onLog = log

device.onStateChange = () => {
  updateStatus()
  updatePortSelectors()
  if (device.connected) {
    frame.invalidate()
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
      frame.invalidate() // アクティブモードの表示に戻す
      flourishRunning = false
    }
  }
  step()
}

// ---- モードタブ ----
const panels: Record<string, string | null> = {
  monitor: null,
  paint: 'paint-panel',
  rainbow: null,
  macro: 'macro-panel',
  othello: null
}

function buildModeTabs(): void {
  const tabs = $('mode-tabs')
  for (const mode of manager.list()) {
    const btn = document.createElement('button')
    btn.textContent = mode.name
    btn.dataset.mode = mode.id
    btn.addEventListener('click', () => manager.activate(mode.id))
    tabs.appendChild(btn)
  }
  manager.onModeChanged = (mode) => {
    for (const btn of tabs.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.mode === mode.id)
    }
    $('mode-desc').textContent = mode.description
    for (const [id, panelId] of Object.entries(panels)) {
      if (panelId) $(panelId).hidden = id !== mode.id
    }
    // モード切替でミラーもリセット
    for (const cell of cells.values()) cell.style.background = ''
  }
}

// ---- ペイントパネル ----
const PALETTE: PaintColor[] = [
  { r: 127, g: 0, b: 0 },
  { r: 127, g: 40, b: 0 },
  { r: 127, g: 110, b: 0 },
  { r: 30, g: 127, b: 0 },
  { r: 0, g: 127, b: 60 },
  { r: 0, g: 90, b: 127 },
  { r: 20, g: 0, b: 127 },
  { r: 90, g: 0, b: 127 },
  { r: 127, g: 0, b: 80 },
  { r: 127, g: 127, b: 127 },
  { r: 60, g: 60, b: 60 },
  { r: 127, g: 80, b: 40 },
  { r: 80, g: 127, b: 90 },
  { r: 100, g: 100, b: 0 },
  { r: 0, g: 40, b: 80 },
  { r: 127, g: 20, b: 20 }
]

function buildPalette(): void {
  const paletteEl = $('palette')
  PALETTE.forEach((c, i) => {
    const sw = document.createElement('div')
    sw.className = 'swatch' + (i === 1 ? ' selected' : '')
    sw.style.background = `rgb(${c.r * 2}, ${c.g * 2}, ${c.b * 2})`
    sw.addEventListener('click', () => {
      paintMode.color = c
      for (const el of paletteEl.querySelectorAll('.swatch')) el.classList.remove('selected')
      sw.classList.add('selected')
    })
    paletteEl.appendChild(sw)
  })
  $('paint-clear').addEventListener('click', () => paintMode.clear(ctx))
}

// ---- マクロパネル ----
function buildMacroPanel(): void {
  const selectedEl = $('macro-selected')
  const typeSel = $<HTMLSelectElement>('macro-type')
  const targetInput = $<HTMLInputElement>('macro-target')

  const refresh = (): void => {
    const pad = macroMode.selectedPad
    if (pad === null) {
      selectedEl.textContent = 'パッド未選択 (画面のパッドをクリック)'
      targetInput.value = ''
      return
    }
    const { x, y } = padToXY(pad)
    const a = macroMode.assignments[pad]
    selectedEl.textContent = `選択中: pad ${pad} (x=${x}, y=${y})` + (a ? ' [割当あり]' : '')
    if (a) {
      typeSel.value = a.type
      targetInput.value = a.target
    } else {
      targetInput.value = ''
    }
  }

  macroMode.onSelectionChanged = refresh

  $('macro-save').addEventListener('click', () => {
    const pad = macroMode.selectedPad
    const target = targetInput.value.trim()
    if (pad === null || target === '') return
    macroMode.assign(ctx, pad, {
      type: typeSel.value as 'app' | 'url' | 'path',
      target
    })
    refresh()
  })

  $('macro-delete').addEventListener('click', () => {
    const pad = macroMode.selectedPad
    if (pad === null) return
    macroMode.unassign(ctx, pad)
    refresh()
  })
}

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

  manager.register(monitorMode)
  manager.register(paintMode)
  manager.register(rainbowMode)
  manager.register(macroMode)
  manager.register(othelloMode)
  buildModeTabs()
  buildPalette()
  buildMacroPanel()

  manager.activate('monitor')
  manager.start()

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
