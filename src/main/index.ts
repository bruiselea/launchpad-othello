import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, session } from 'electron'
import { join } from 'path'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let rendererQuitReady = false
type JevProvider = 'openrouter' | 'typesafe'
const environmentKey = process.env['OPENROUTER_API_KEY']?.trim()
  ? { provider: 'openrouter' as const, key: process.env['OPENROUTER_API_KEY'].trim() }
  : process.env['TYPESAFE_API_KEY']?.trim() || process.env['JEV_API_KEY']?.trim()
    ? { provider: 'typesafe' as const, key: (process.env['TYPESAFE_API_KEY'] || process.env['JEV_API_KEY'] || '').trim() }
    : null
let jevCredentials: { provider: JevProvider; key: string } | null = environmentKey

type JevMoveRequest = {
  board: number[][]
  legalMoves: { pad: number; flips: number }[]
}

function isJevMoveRequest(value: unknown): value is JevMoveRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<JevMoveRequest>
  return Array.isArray(request.board) && request.board.length === 8 &&
    request.board.every((row) => Array.isArray(row) && row.length === 8 &&
      row.every((cell) => cell === 0 || cell === 1 || cell === 2)) &&
    Array.isArray(request.legalMoves) && request.legalMoves.length > 0 &&
    request.legalMoves.length <= 64 && request.legalMoves.every((move) =>
      Number.isInteger(move?.pad) && move.pad >= 11 && move.pad <= 88 &&
      Number.isInteger(move.flips) && move.flips > 0)
}

function fromMainWindow(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 閉じるボタンは終了ではなく非表示(トレイ常駐)。常駐中もレンダラーは生き続け
  // MIDI 処理が動き続ける
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources/icon.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Launchpad Othello')
  const menu = Menu.buildFromTemplate([
    { label: '開く', click: () => showWindow() },
    {
      label: 'ログイン時に自動起動',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
    },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => showWindow())
}

function showWindow(): void {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
}

app.whenReady().then(() => {
  // WebMIDI (SysEx 込み) の権限をレンダラーに許可する
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'midi' || permission === 'midiSysex')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'midi' || permission === 'midiSysex'
  })

  createWindow()
  createTray()
})

app.on('second-instance', () => showWindow())

// 終了前にレンダラーへ通知し、Launchpad を Live モードに戻す猶予を与える
app.on('before-quit', (e) => {
  quitting = true
  if (rendererQuitReady || !mainWindow || mainWindow.isDestroyed()) return
  e.preventDefault()
  mainWindow.webContents.send('app:shutdown')
  setTimeout(() => {
    rendererQuitReady = true
    app.quit()
  }, 800)
})

ipcMain.on('app:quit-ready', () => {
  rendererQuitReady = true
  app.quit()
})

// ウィンドウ全閉じでも常駐を続ける
app.on('window-all-closed', () => {
  if (quitting) app.quit()
})

ipcMain.handle('jev:status', (event) => {
  if (!fromMainWindow(event)) throw new Error('Invalid window')
  return jevCredentials?.provider ?? null
})

ipcMain.handle('jev:set-key', async (event, provider: unknown, key: unknown) => {
  if (!fromMainWindow(event)) throw new Error('Invalid window')
  if (provider !== 'openrouter' && provider !== 'typesafe') {
    throw new Error('API キーの発行元を選んでください')
  }
  if (typeof key !== 'string' || key.trim().length < 8 || key.length > 512) {
    throw new Error('有効な Jev API キーを入力してください')
  }
  const endpoint = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/key'
    : 'https://api.typesafe.ai/v1/models'
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${key.trim()}` },
    signal: AbortSignal.timeout(10000)
  })
  if (!response.ok) throw new Error(`${provider === 'openrouter' ? 'OpenRouter' : 'TypeSafe'} の API キーを確認できませんでした (${response.status})`)
  if (provider === 'openrouter') {
    const result = await response.json() as { data?: { is_management_key?: boolean } }
    if (!result.data) throw new Error('OpenRouter から API キーの確認結果を取得できませんでした')
    if (result.data?.is_management_key) {
      throw new Error('管理用キーは使用できません。通常の OpenRouter API キーを発行してください')
    }
  }
  jevCredentials = { provider, key: key.trim() }
})

ipcMain.handle('jev:move', async (event, value: unknown): Promise<number> => {
  if (!fromMainWindow(event)) throw new Error('Invalid window')
  if (!jevCredentials) throw new Error('Jev API キーが未設定です')
  if (!isJevMoveRequest(value)) throw new Error('盤面データが不正です')
  const { provider, key } = jevCredentials

  const criteria = Object.fromEntries(value.legalMoves.map(({ pad, flips }) => [
    `pad_${pad}`,
    `Place at x=${pad % 10 - 1}, y=${Math.floor(pad / 10) - 1}; flips ${flips} stones.`
  ]))
  const response = await fetch(provider === 'openrouter'
    ? 'https://openrouter.ai/api/alpha/decisions'
    : 'https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: provider === 'openrouter' ? '~typesafe/jev-latest' : 'jev-latest',
      state: {
        game: 'Othello / Reversi',
        board_orientation: 'Rows are y=0 at the bottom through y=7 at the top; columns are x=0 through x=7.',
        cells: '0=empty, 1=human, 2=Jev',
        board: value.board,
        player_to_move: 2,
        legal_moves: value.legalMoves
      },
      questions: {
        move: {
          type: 'choice',
          instructions: 'Choose the strongest legal Othello move for player 2 (Jev). Prefer winning positions, stable corners, and mobility over raw flips.',
          criteria
        }
      }
    }),
    signal: AbortSignal.timeout(12000)
  })
  if (!response.ok) {
    if (provider === 'openrouter' && response.status === 402) {
      throw new Error('OpenRouter の利用可能なクレジットがありません（402）')
    }
    throw new Error(`Jev API エラー (${response.status})`)
  }
  const result = await response.json() as { answers?: { move?: { type?: string; choice?: string } } }
  const choice = result.answers?.move?.choice
  const selected = value.legalMoves.find((move) => `pad_${move.pad}` === choice)
  if (result.answers?.move?.type !== 'choice' || !selected) {
    throw new Error('Jev が有効な着手を返しませんでした')
  }
  return selected.pad
})
