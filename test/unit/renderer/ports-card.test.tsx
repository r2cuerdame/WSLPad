import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { PortInfo, WindowsPortInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import PortsCard from '@renderer/dashboard/PortsCard'

const WSL_PORTS: PortInfo[] = [
  {
    protocol: 'tcp',
    localAddress: '127.0.0.1',
    port: 8080,
    pid: 4242,
    processName: 'node',
    listening: true,
    localhostUrl: 'http://127.0.0.1:8080',
    windowsBound: true,
    windowsProcess: 'wslrelay.exe',
    reachability: 'windows-only',
    reachabilityReason: null
  },
  {
    protocol: 'tcp',
    localAddress: '0.0.0.0',
    port: 22,
    pid: 310,
    processName: 'sshd',
    listening: true,
    localhostUrl: null,
    windowsBound: false,
    windowsProcess: null,
    reachability: 'loopback-only',
    reachabilityReason: null
  },
  {
    protocol: 'udp',
    localAddress: '0.0.0.0',
    port: 5353,
    pid: 610,
    processName: 'avahi-daemon',
    listening: true,
    localhostUrl: null,
    windowsBound: null,
    windowsProcess: null,
    reachability: 'unknown',
    reachabilityReason: null
  }
]

const WINDOWS_PORTS: WindowsPortInfo[] = [
  {
    protocol: 'tcp',
    localAddress: '0.0.0.0',
    port: 8080,
    pid: 7100,
    processName: 'wslrelay.exe',
    listening: true,
    localhostUrl: 'http://localhost:8080',
    fromWsl: true
  },
  {
    protocol: 'tcp',
    localAddress: '0.0.0.0',
    port: 3000,
    pid: 9312,
    processName: 'node.exe',
    listening: true,
    localhostUrl: 'http://localhost:3000',
    fromWsl: false
  }
]

function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null),
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

let api: ReturnType<typeof makeApi>

function FocusProbe(): React.JSX.Element {
  const { focusPid } = useApp()
  return <div data-testid="focus-pid">{focusPid === null ? '' : String(focusPid)}</div>
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderCard(
  ports: PortInfo[] = WSL_PORTS,
  windowsPorts: WindowsPortInfo[] | undefined = WINDOWS_PORTS
): Promise<ReturnType<typeof render>> {
  const view = render(
    <AppStoreProvider>
      <PortsCard ports={ports} windowsPorts={windowsPorts} />
      <FocusProbe />
    </AppStoreProvider>
  )
  await flush()
  return view
}

/** Rows are [source, proto, address, port, pid, process, reaches, actions]. */
function bodyRows(): HTMLElement[] {
  return screen.queryAllByRole('row').filter((r) => r.querySelectorAll('td').length > 0)
}

function cells(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll('td')).map((td) => td.textContent ?? '')
}

function rowFor(port: number): HTMLElement {
  const found = bodyRows().find((r) => cells(r)[3] === String(port))
  if (!found) throw new Error(`no row for port ${port}`)
  return found
}

beforeAll(async () => {
  initRendererI18n('en')
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve())
    })
  }
})

beforeEach(() => {
  window.localStorage.clear()
  api = makeApi()
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PortsCard source column', () => {
  it('labels each row with the side it is bound on', async () => {
    await renderCard()

    expect(cells(rowFor(8080))[0]).toBe('WSL + Windows')
    expect(cells(rowFor(22))[0]).toBe('WSL')
    expect(cells(rowFor(5353))[0]).toBe('WSL')
    expect(cells(rowFor(3000))[0]).toBe('Windows')
  })

  it('names the Windows owner and explains an unknown Windows table', async () => {
    await renderCard()

    expect(rowFor(8080).querySelectorAll('td')[0].getAttribute('title')).toBe(
      'Windows process: wslrelay.exe'
    )
    expect(rowFor(22).querySelectorAll('td')[0].getAttribute('title')).toBe(
      'Not reachable from Windows'
    )
    const unknown = rowFor(5353).querySelectorAll('td')[0]
    expect(unknown.getAttribute('title')).toBe('Windows port table unavailable')
    expect(unknown.className).toBe('dim')
  })

  it('never lists a Windows entry that a WSL listener already explains', async () => {
    await renderCard()
    expect(bodyRows()).toHaveLength(4)
    expect(bodyRows().filter((r) => cells(r)[3] === '8080')).toHaveLength(1)
  })

  it('shows the Windows process name on Windows-only rows', async () => {
    await renderCard()
    expect(cells(rowFor(3000))[5]).toBe('node.exe')
    expect(cells(rowFor(3000))[4]).toBe('9312')
  })
})

describe('PortsCard Windows-only toggle', () => {
  it('lists Windows-only rows by default and remembers being switched off', async () => {
    const view = await renderCard()
    expect(bodyRows()).toHaveLength(4)

    fireEvent.click(screen.getByLabelText('Include Windows-only ports'))
    expect(bodyRows()).toHaveLength(3)
    expect(bodyRows().some((r) => cells(r)[3] === '3000')).toBe(false)
    expect(window.localStorage.getItem('wslpad.dashboard.ports.windowsOnly')).toBe('0')

    view.unmount()
    await renderCard()
    expect((screen.getByLabelText('Include Windows-only ports') as HTMLInputElement).checked).toBe(
      false
    )
    expect(bodyRows()).toHaveLength(3)
  })

  it('hides the toggle when there is nothing Windows-only to show', async () => {
    await renderCard(WSL_PORTS, [])
    expect(screen.queryByLabelText('Include Windows-only ports')).toBeNull()
    expect(bodyRows()).toHaveLength(3)
  })
})

describe('PortsCard actions', () => {
  it('opens and copies the exact localhost url for WSL and Windows rows', async () => {
    await renderCard()

    fireEvent.click(within(rowFor(8080)).getByRole('button', { name: 'Open in browser' }))
    expect(api.openExternal).toHaveBeenCalledWith('http://127.0.0.1:8080')

    fireEvent.click(within(rowFor(3000)).getByRole('button', { name: 'Open in browser' }))
    expect(api.openExternal).toHaveBeenCalledWith('http://localhost:3000')

    await act(async () => {
      fireEvent.click(within(rowFor(3000)).getByRole('button', { name: 'Copy URL' }))
      await Promise.resolve()
    })
    expect(api.copyToClipboard).toHaveBeenCalledWith('http://localhost:3000')
  })

  it('hands a WSL pid to the processes card but disables it for Windows rows', async () => {
    await renderCard()

    fireEvent.click(within(rowFor(8080)).getByRole('button', { name: 'Show process' }))
    expect(screen.getByTestId('focus-pid').textContent).toBe('4242')

    const windowsButton = within(rowFor(3000)).getByRole('button', { name: 'Show process' })
    expect((windowsButton as HTMLButtonElement).disabled).toBe(true)
    expect(windowsButton.getAttribute('title')).toBe('Windows processes are not listed here')
  })
})

describe('PortsCard sorting', () => {
  it('sorts by port ascending and flips on a second click', async () => {
    await renderCard()
    expect(bodyRows().map((r) => cells(r)[3])).toEqual(['22', '3000', '5353', '8080'])

    fireEvent.click(screen.getByRole('button', { name: /^Port/ }))
    expect(bodyRows().map((r) => cells(r)[3])).toEqual(['8080', '5353', '3000', '22'])

    fireEvent.click(screen.getByRole('button', { name: /^Source/ }))
    expect(bodyRows().map((r) => cells(r)[0])).toEqual(['WSL + Windows', 'WSL', 'WSL', 'Windows'])
  })
})

describe('PortsCard reachability column', () => {
  /** The verdict and its reason are computed in main; the card only shows them. */
  const EXPLAINED: PortInfo[] = [
    {
      ...WSL_PORTS[0],
      port: 8080,
      reachability: 'lan',
      reachabilityReason: 'Windows forwards port 8080 and the firewall allows inbound traffic.'
    },
    {
      ...WSL_PORTS[1],
      port: 22,
      reachability: 'loopback-only',
      reachabilityReason: 'Nothing on the Windows side forwards port 22.'
    },
    { ...WSL_PORTS[2], port: 5353, reachability: 'unknown', reachabilityReason: null },
    { ...WSL_PORTS[1], port: 9000, listening: false, reachability: 'unreachable' }
  ]

  it('names how far every WSL listener carries', async () => {
    await renderCard(EXPLAINED, [])

    expect(cells(rowFor(8080))[6]).toBe('The network')
    expect(cells(rowFor(22))[6]).toBe('Inside WSL only')
    expect(cells(rowFor(5353))[6]).toBe('Unknown')
    expect(cells(rowFor(9000))[6]).toBe('Nothing')
  })

  it('puts the reason from the collector on hover', async () => {
    await renderCard(EXPLAINED, [])

    expect(rowFor(8080).querySelectorAll('td')[6].getAttribute('title')).toBe(
      'Windows forwards port 8080 and the firewall allows inbound traffic.'
    )
    expect(rowFor(22).querySelectorAll('td')[6].getAttribute('title')).toBe(
      'Nothing on the Windows side forwards port 22.'
    )
  })

  it('explains an unknown verdict that arrived without a reason', async () => {
    await renderCard(EXPLAINED, [])

    expect(rowFor(5353).querySelectorAll('td')[6].getAttribute('title')).toBe(
      'The Windows port table or the firewall could not be read, so how far this port ' +
        'carries is unknown.'
    )
  })

  it('marks the widest scope and never dresses an unknown up as a good answer', async () => {
    await renderCard(EXPLAINED, [])

    const badgeOf = (port: number): string =>
      rowFor(port).querySelectorAll('td')[6].querySelector('span')?.className ?? ''
    expect(badgeOf(8080)).toContain('badge-accent')
    expect(badgeOf(5353)).toContain('badge-dim')
    expect(badgeOf(9000)).toContain('badge-err')
    expect(badgeOf(22)).not.toContain('badge-ok')
  })

  it('leaves a Windows-only listener out of the WSL verdict', async () => {
    await renderCard(EXPLAINED, WINDOWS_PORTS)

    const cell = rowFor(3000).querySelectorAll('td')[6]
    expect(cell.textContent).toBe('—')
    expect(cell.getAttribute('title')).toBe(
      'A Windows listener: the WSL reachability rules do not apply to it.'
    )
  })
})

describe('PortsCard filters', () => {
  const ports = (): number[] => bodyRows().map((r) => Number(cells(r)[3]))

  it('narrows to a port range, inclusive at both ends', async () => {
    await renderCard()
    fireEvent.change(screen.getByLabelText('Lowest port'), { target: { value: '22' } })
    fireEvent.change(screen.getByLabelText('Highest port'), { target: { value: '3000' } })
    expect(ports().sort((a, b) => a - b)).toEqual([22, 3000])
  })

  it('takes an open-ended range from either side', async () => {
    await renderCard()
    fireEvent.change(screen.getByLabelText('Lowest port'), { target: { value: '5000' } })
    expect(ports().sort((a, b) => a - b)).toEqual([5353, 8080])

    fireEvent.change(screen.getByLabelText('Lowest port'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Highest port'), { target: { value: '100' } })
    expect(ports()).toEqual([22])
  })

  it('searches the process name on either side of the port', async () => {
    await renderCard()
    fireEvent.change(screen.getByLabelText('Filter by process'), { target: { value: 'node' } })
    // 'node' (WSL), 'node.exe' (Windows-only) and the WSL row whose Windows
    // counterpart is wslrelay.exe all matter — the last one only via 'node'.
    expect(ports().sort((a, b) => a - b)).toEqual([3000, 8080])

    fireEvent.change(screen.getByLabelText('Filter by process'), { target: { value: 'RELAY' } })
    expect(ports()).toEqual([8080])
  })

  it('combines the range with the name search', async () => {
    await renderCard()
    fireEvent.change(screen.getByLabelText('Filter by process'), { target: { value: 'node' } })
    fireEvent.change(screen.getByLabelText('Lowest port'), { target: { value: '4000' } })
    expect(ports()).toEqual([8080])
  })

  it('says the filter found nothing rather than claiming there are no ports', async () => {
    await renderCard()
    fireEvent.change(screen.getByLabelText('Filter by process'), { target: { value: 'zzz' } })
    expect(screen.getByText('No port matches the filter')).toBeTruthy()
    expect(screen.queryByText('None')).toBeNull()
  })
})

describe('PortsCard empty state', () => {
  it('shows none when neither side has a listener', async () => {
    await renderCard([], [])
    expect(screen.getByText('None')).toBeTruthy()
  })
})
