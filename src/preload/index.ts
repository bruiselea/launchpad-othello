import { contextBridge, ipcRenderer } from 'electron'

const api = {
  runMacro: (action: { type: 'app' | 'url' | 'path'; target: string; args?: string[] }) =>
    ipcRenderer.invoke('macro:run', action) as Promise<string>,
  onShutdown: (cb: () => void) => {
    ipcRenderer.on('app:shutdown', () => cb())
  },
  quitReady: () => ipcRenderer.send('app:quit-ready')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
