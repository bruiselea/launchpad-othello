import { contextBridge, ipcRenderer } from 'electron'

const api = {
  jevAvailable: () => ipcRenderer.invoke('jev:status') as Promise<'openrouter' | 'typesafe' | null>,
  setJevKey: (provider: 'openrouter' | 'typesafe', key: string) =>
    ipcRenderer.invoke('jev:set-key', provider, key) as Promise<void>,
  chooseJevMove: (request: { board: number[][]; legalMoves: { pad: number; flips: number }[] }) =>
    ipcRenderer.invoke('jev:move', request) as Promise<number>,
  onShutdown: (cb: () => void) => {
    ipcRenderer.on('app:shutdown', () => cb())
  },
  quitReady: () => ipcRenderer.send('app:quit-ready')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
