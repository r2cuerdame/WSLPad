import { app } from 'electron'
import { join } from 'path'

/** Absolute path to a bundled static resource (icons, rc scripts). */
export function resourcePath(...parts: string[]): string {
  const base = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources')
  return join(base, ...parts)
}
