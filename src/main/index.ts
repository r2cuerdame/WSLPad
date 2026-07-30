import { app } from 'electron'
import { WslPadApp } from './app'

// Single instance lock (goal.md §4.2)
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  const wslpad = new WslPadApp()

  app.on('second-instance', () => {
    wslpad.showMainWindow()
  })

  app.whenReady().then(() => {
    void wslpad.start()
  })

  app.on('window-all-closed', () => {
    // Tray-resident app: closing windows never quits (goal.md §4.2)
  })

  app.on('before-quit', () => {
    wslpad.markQuitting()
  })

  app.on('will-quit', () => {
    wslpad.dispose()
  })
}
