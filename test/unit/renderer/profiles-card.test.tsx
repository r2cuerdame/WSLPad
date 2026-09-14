import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_SPECS } from '@shared/constants'
import type { Settings, SettingsPatch, ToolInfo } from '@shared/types'
import type { WslPadApi } from '@shared/ipc'
import { defaultSettings, parseSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import ProfilesCard from '@renderer/dashboard/ProfilesCard'

/**
 * The settings mock behaves like the real store: a patch is validated through
 * the schema, persisted in memory and pushed back through onChange, so the
 * card sees custom profiles exactly the way the app would deliver them.
 */
function makeApi(initial: Settings = defaultSettings()) {
  let current = initial
  let listener: ((s: Settings) => void) | null = null
  return {
    getSnapshot: vi.fn(async () => null),
    copyToClipboard: vi.fn(async () => undefined),
    terminal: { input: vi.fn(async () => undefined), ensure: vi.fn(async () => undefined) },
    settings: {
      get: vi.fn(async () => current),
      set: vi.fn(async (patch: SettingsPatch) => {
        current = parseSettings({ ...current, ...patch })
        listener?.(current)
        return current
      }),
      onChange: vi.fn((cb: (s: Settings) => void) => {
        listener = cb
        return () => {
          listener = null
        }
      })
    },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

let api: ReturnType<typeof makeApi>

function PreparedProbe(): React.JSX.Element {
  const { preparedCommand } = useApp()
  return <div data-testid="prepared">{preparedCommand?.text ?? ''}</div>
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderCard(tools: ToolInfo[], onDiscover = vi.fn()): Promise<typeof onDiscover> {
  render(
    <AppStoreProvider>
      <ProfilesCard tools={tools} onDiscover={onDiscover} />
      <PreparedProbe />
    </AppStoreProvider>
  )
  await flush()
  return onDiscover
}

function tool(id: string, installed: boolean, version: string | null = null): ToolInfo {
  const spec = TOOL_SPECS.find((s) => s.id === id)
  return {
    id,
    displayName: spec?.displayName ?? id,
    installed,
    executablePath: installed ? `/usr/bin/${id}` : null,
    version: installed ? version : null,
    installMethod: installed ? 'apt' : null,
    configPaths: [],
    runningProcesses: 0,
    services: [],
    side: installed ? 'ext4' : 'unknown',
    shadowedByWindows: false
  }
}

function catalog(installed: Record<string, string | null>): ToolInfo[] {
  return TOOL_SPECS.map((spec) =>
    spec.id in installed ? tool(spec.id, true, installed[spec.id]) : tool(spec.id, false)
  )
}

/** apt and npm detected; a typical partially set-up Web machine. */
const TOOLS = catalog({
  apt: '2.7.14',
  npm: '10.8.0',
  node: '22.1.0',
  git: '2.43.0',
  jq: '1.7.1'
})

const detail = (): HTMLElement => screen.getByTestId('profile-detail')
const row = (needId: string): HTMLElement => screen.getByTestId(`profile-tool-${needId}`)

beforeAll(async () => {
  initRendererI18n('en')
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve())
    })
  }
})

beforeEach(() => {
  api = makeApi()
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ProfilesCard (issue #90)', () => {
  it('lists the built-in profiles with installed/total counts and opens Web first', async () => {
    await renderCard(TOOLS)
    for (const [id, name, count] of [
      ['web', 'Web', '4/8'],
      ['python', 'Python', '0/6'],
      ['rust', 'Rust', '0/5'],
      ['ai', 'AI', '3/8'],
      ['containers', 'Containers / Kubernetes', '0/5']
    ]) {
      const chip = screen.getByTestId(`profile-${id}`)
      expect(chip.textContent).toContain(name)
      expect(chip.textContent).toContain(count)
    }
    expect(screen.getByTestId('profile-web').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('profile-summary').textContent).toContain('4 installed')
    expect(screen.getByTestId('profile-summary').textContent).toContain('4 missing')
    expect(screen.getByTestId('profile-summary').textContent).toContain(
      '4 of 4 missing can be prepared'
    )
  })

  it('explains why each tool is recommended and which provider resolves a missing one', async () => {
    await renderCard(TOOLS)
    const node = row('node')
    expect(node.textContent).toContain('Node.js')
    expect(node.textContent).toContain('22.1.0')
    expect(within(node).getByText('Installed')).toBeTruthy()
    expect(node.textContent).toContain('Runs JavaScript and TypeScript tooling')

    const docker = row('docker')
    expect(within(docker).getByText('Missing')).toBeTruthy()
    expect(docker.textContent).toContain('apt: docker.io')
    expect(docker.textContent).toContain('the same way CI and production do')

    // pnpm/npm is one need satisfied by npm.
    const pm = row('node-package-manager')
    expect(pm.textContent).toContain('pnpm / npm')
    expect(within(pm).getByText('Installed')).toBeTruthy()
  })

  it('prepares a single missing install in the Console and never submits it', async () => {
    await renderCard(TOOLS)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare install command for Docker' }))
    expect(screen.getByTestId('prepared').textContent).toBe("sudo apt install -- 'docker.io'")
    expect(api.terminal.input).not.toHaveBeenCalled()
    expect(api.terminal.ensure).not.toHaveBeenCalled()
  })

  it('prepares every resolvable missing install as one reviewable line', async () => {
    await renderCard(TOOLS)
    const button = screen.getByTestId('profiles-prepare-all')
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    expect(screen.getByTestId('prepared').textContent).toBe(
      "sudo apt install -- 'docker.io' 'gh' 'ripgrep' && npm install --global 'playwright'"
    )
    expect(api.terminal.input).not.toHaveBeenCalled()
  })

  it('hands a tool no detected provider carries to Discover instead of guessing', async () => {
    // Only cargo is around: docker has no cargo candidate, ripgrep does.
    const onDiscover = await renderCard(catalog({ cargo: '1.80.0', node: '22.1.0' }))
    const docker = row('docker')
    expect(docker.textContent).toContain('No detected provider carries it')
    expect(
      within(docker).queryByRole('button', { name: 'Prepare install command for Docker' })
    ).toBeNull()
    fireEvent.click(within(docker).getByRole('button', { name: 'Search Discover for Docker' }))
    expect(onDiscover).toHaveBeenCalledWith('docker.io')

    expect(row('ripgrep').textContent).toContain('cargo: ripgrep')
    expect(screen.getByTestId('profiles-prepare-all').hasAttribute('disabled')).toBe(false)
  })

  it('disables bulk preparation and shows unknown when the catalog said nothing', async () => {
    await renderCard([])
    expect(screen.getByTestId('profile-summary').textContent).toContain('0 installed')
    expect(screen.getByTestId('profile-summary').textContent).toContain('0 missing')
    expect(screen.getByTestId('profile-summary').textContent).toContain('8 unknown')
    expect(within(row('docker')).getByText('Unknown')).toBeTruthy()
    expect(screen.getByTestId('profiles-prepare-all').hasAttribute('disabled')).toBe(true)
    expect(screen.queryAllByRole('button', { name: /Search Discover for/ })).toHaveLength(0)
  })

  it('switches profiles on click', async () => {
    await renderCard(TOOLS)
    fireEvent.click(screen.getByTestId('profile-containers'))
    expect(screen.getByTestId('profile-containers').getAttribute('aria-pressed')).toBe('true')
    expect(detail().textContent).toContain('Docker / Podman')
    expect(row('local-cluster').textContent).toContain('kind / k3d / minikube')
    // kind, k3d and minikube are brew-only; brew is not detected here.
    expect(row('local-cluster').textContent).toContain('No detected provider carries it')
  })

  it('creates, evaluates and deletes a lightweight custom profile through settings', async () => {
    await renderCard(TOOLS)
    fireEvent.click(screen.getByTestId('profiles-new-custom'))
    fireEvent.change(screen.getByTestId('profile-custom-name'), { target: { value: 'Mine' } })
    fireEvent.change(screen.getByLabelText('Filter catalog'), { target: { value: 'jq' } })
    fireEvent.click(screen.getByLabelText('jq'))
    fireEvent.change(screen.getByLabelText('Filter catalog'), { target: { value: 'ripgrep' } })
    fireEvent.click(screen.getByLabelText('ripgrep'))
    expect(screen.getByText('2 selected')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByTestId('profile-custom-save'))
      await Promise.resolve()
    })
    expect(api.settings.set).toHaveBeenCalledTimes(1)
    const patch = api.settings.set.mock.calls[0][0] as SettingsPatch
    expect(patch.profiles?.custom).toHaveLength(1)
    expect(patch.profiles?.custom?.[0]).toMatchObject({ name: 'Mine', toolIds: ['jq', 'ripgrep'] })
    expect(patch.profiles?.custom?.[0].id).toMatch(/^custom-/)

    // The new profile is selected and evaluated like a built-in one.
    const chip = screen.getByText('Mine').closest('button')!
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(chip.textContent).toContain('1/2')
    expect(row('jq').textContent).toContain('Chosen by you for this profile.')
    expect(row('ripgrep').textContent).toContain('apt: ripgrep')
    expect(screen.queryByTestId('profile-custom-form')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByTestId('profile-delete-custom'))
      await Promise.resolve()
    })
    expect(api.settings.set).toHaveBeenLastCalledWith({ profiles: { custom: [] } })
    expect(screen.queryByText('Mine')).toBeNull()
    expect(screen.getByTestId('profile-web').getAttribute('aria-pressed')).toBe('true')
  })

  it('shows custom profiles that already live in settings', async () => {
    api = makeApi(
      parseSettings({
        profiles: { custom: [{ id: 'custom-saved', name: 'Saved', toolIds: ['git', 'helm'] }] }
      })
    )
    ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
    await renderCard(TOOLS)
    const chip = screen.getByTestId('profile-custom-saved')
    expect(chip.textContent).toContain('Saved')
    expect(chip.textContent).toContain('1/2')
  })
})
