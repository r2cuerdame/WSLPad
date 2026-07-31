/**
 * Recapture docs/screenshots/* from the current build.
 *
 * Runs the packaged renderer in fixture mode (WSLPAD_FIXTURE_MODE=1) so every
 * shot shows the same invented machine on every run — no real hostnames, paths
 * or ports ever reach the README.
 *
 *   npm run build && node scripts/shoot.mjs [name ...]
 */
import { _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OUT = join(process.cwd(), 'docs', 'screenshots')
const VIEWPORT = { width: 1280, height: 860 }

/** section: id in the dashboard nav; tab: which top-level tab to open first. */
const SHOTS = [
  { name: 'dashboard', section: 'overview' },
  { name: 'memory', section: 'resources' },
  { name: 'disk', section: 'disk' },
  { name: 'wslconfig', section: 'wslconfig' },
  { name: 'network', section: 'network' },
  { name: 'tools', section: 'tools' },
  { name: 'hermes', section: 'hermes' },
  { name: 'services', section: 'services' },
  { name: 'ports', section: 'ports' },
  { name: 'explorer', tab: 'explorer' },
  { name: 'settings', settings: true }
]

const wanted = process.argv.slice(2)
const shots = wanted.length > 0 ? SHOTS.filter((s) => wanted.includes(s.name)) : SHOTS

mkdirSync(OUT, { recursive: true })
const userDataDir = mkdtempSync(join(tmpdir(), 'wslpad-shots-'))
writeFileSync(
  join(userDataDir, 'settings.json'),
  JSON.stringify({
    schemaVersion: 1,
    language: 'en',
    mcp: { enabled: true, port: 20000 + Math.floor(Math.random() * 20000), token: '' }
  })
)

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    WSLPAD_FIXTURE_MODE: '1',
    WSLPAD_USER_DATA: userDataDir,
    NODE_ENV: 'production'
  }
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.setViewportSize(VIEWPORT)
// Let the first snapshot land so no section is caught mid-load.
await page.waitForTimeout(3000)

for (const shot of shots) {
  if (shot.settings) {
    await page.getByRole('button', { name: 'Settings' }).click()
  } else if (shot.tab === 'explorer') {
    await page.getByRole('tab', { name: 'Explorer' }).click()
  } else {
    await page.getByRole('tab', { name: 'Dashboard' }).click()
    await page.getByTestId(`dashboard-nav-${shot.section}`).click()
  }
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(OUT, `${shot.name}.png`) })
  console.log('captured', shot.name)
  if (shot.settings) await page.keyboard.press('Escape')
}

await app.evaluate(({ app: a }) => {
  a.emit('before-quit')
  a.quit()
})
await app.close().catch(() => {})
