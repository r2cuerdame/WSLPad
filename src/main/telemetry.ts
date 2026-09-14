import { app } from 'electron'
import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

const PROJECT_ID = 'pp_wslpad_74c8a7f1'
const ENDPOINT = 'https://pulse-api.purpleshiphub.workers.dev/api/v1/ping'
const TIMEOUT_MS = 2000

type TelemetryState = {
  installId: string
  lastAttemptDate?: string
}

function localDateKey(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function loadState(path: string): Promise<TelemetryState> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<TelemetryState>
    if (typeof parsed.installId === 'string' && parsed.installId.length > 0) {
      return { installId: parsed.installId, lastAttemptDate: parsed.lastAttemptDate }
    }
  } catch {
    // Missing/corrupt telemetry state is repaired below without affecting startup.
  }
  return { installId: randomUUID() }
}

async function saveState(path: string, state: TelemetryState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state), 'utf8')
}

export async function sendPurplePulseHeartbeat(): Promise<void> {
  // Development/QA runs must not contaminate production telemetry.
  if (!app.isPackaged) return

  try {
    const statePath = join(app.getPath('userData'), 'purplepulse.json')
    const state = await loadState(statePath)
    const today = localDateKey()

    if (state.lastAttemptDate === today) return

    // Mark before sending so repeated launches cannot create a retry storm.
    state.lastAttemptDate = today
    await saveState(statePath, state)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: PROJECT_ID,
          install_id: state.installId,
          version: app.getVersion(),
          os: process.platform === 'win32' ? 'windows' : process.platform,
          platform: 'electron'
        }),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    // Telemetry is best-effort and must never interfere with app startup.
  }
}
