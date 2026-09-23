declare global {
  interface Window {
    api: {
      jevAvailable: () => Promise<'openrouter' | 'typesafe' | null>
      setJevKey: (provider: 'openrouter' | 'typesafe', key: string) => Promise<void>
      chooseJevMove: (request: { board: number[][]; legalMoves: { pad: number; flips: number }[] }) => Promise<number>
      onShutdown: (cb: () => void) => void
      quitReady: () => void
    }
  }
}

export {}
