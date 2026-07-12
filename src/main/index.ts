import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, session } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let rendererQuitReady = false

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

// ---- マクロアクション実行 ----

type MacroAction =
  | { type: 'app'; target: string; args?: string[] }
  | { type: 'url'; target: string }
  | { type: 'path'; target: string }

ipcMain.handle('macro:run', async (_e, action: MacroAction): Promise<string> => {
  try {
    switch (action.type) {
      case 'url':
        await shell.openExternal(action.target)
        return 'ok'
      case 'path': {
        const err = await shell.openPath(action.target)
        return err === '' ? 'ok' : err
      }
      case 'app': {
        const child = spawn(action.target, action.args ?? [], {
          detached: true,
          stdio: 'ignore',
          shell: true
        })
        child.unref()
        return 'ok'
      }
      default:
        return 'unknown action type'
    }
  } catch (err) {
    return String(err)
  }
})
