import { BrowserWindow, shell } from 'electron'
import { join } from 'path'

export interface MainWindowHost {
  isQuitting(): boolean
  /** false when launched hidden via login autostart (goal.md §4.1). */
  showOnReady?: boolean
}

export function createMainWindow(host: MainWindowHost): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#101014',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => {
    if (host.showOnReady !== false) win.show()
  })

  // Close button hides to tray instead of quitting (goal.md §4.2)
  win.on('close', (e) => {
    if (!host.isQuitting()) {
      e.preventDefault()
      win.hide()
    }
  })

  // Never navigate the app window; open external links in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
