export interface MacroActionPayload {
  type: 'app' | 'url' | 'path'
  target: string
  args?: string[]
}

declare global {
  interface Window {
    api: {
      runMacro: (action: MacroActionPayload) => Promise<string>
      onShutdown: (cb: () => void) => void
      quitReady: () => void
    }
  }
}

export {}
