import { app } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import { parseSettings } from '@shared/schemas'
import { WslPadApp } from './app'

// Isolated userData for E2E runs (set before any path use).
if (process.env.WSLPAD_USER_DATA) {
  app.setPath('userData', process.env.WSLPAD_USER_DATA)
}

if (process.argv.includes('--mcp-stdio')) {
  // Stdio bridge mode: spawned by MCP clients (e.g. Claude Desktop). No GUI,
  // no single-instance lock — proxies stdio to the resident app's HTTP server.
  void (async () => {
    try {
      const settingsPath = join(app.getPath('userData'), 'settings.json')
      const settings = parseSettings(JSON.parse(readFileSync(settingsPath, 'utf8')))
      const { runStdioBridge } = await import('./mcp/bridge')
      await runStdioBridge(settings.mcp.port, settings.mcp.token)
    } catch (err) {
      process.stderr.write(`wslpad --mcp-stdio failed: ${String(err)}\n`)
      app.exit(1)
    }
  })()
} else {
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
}
