import type { WslPadApi } from '../shared/ipc'

declare global {
  interface Window {
    wslpad: WslPadApi
  }
}

export {}
