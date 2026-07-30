import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { DnsInfo, FirewallInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
import NetworkCard, {
  dnsMismatch,
  firewallBlocksInbound,
  networkNeedsAttention
} from '@renderer/dashboard/NetworkCard'

const ALLOW_INBOUND_COMMAND =
  "Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' " +
  '-DefaultInboundAction Allow'

function firewall(over: Partial<FirewallInfo> = {}): FirewallInfo {
  return {
    enabled: true,
    defaultInbound: 'Block',
    defaultOutbound: 'Allow',
    loopbackEnabled: true,
    ruleCount: 3,
    error: null,
    ...over
  }
}

function dns(over: Partial<DnsInfo> = {}): DnsInfo {
  return {
    resolvConfPath: '/etc/resolv.conf',
    isGeneratedSymlink: true,
    generateResolvConf: true,
    dnsTunneling: true,
    nameservers: ['10.255.255.254'],
    windowsAdapterDns: ['192.168.1.1'],
    error: null,
    ...over
  }
}

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
let showPorts: ReturnType<typeof vi.fn>

async function renderCard(
  fw: FirewallInfo | null = firewall(),
  resolver: DnsInfo | null = dns()
): Promise<void> {
  render(
    <AppStoreProvider>
      <NetworkCard firewall={fw} dns={resolver} onShowPorts={showPorts} />
    </AppStoreProvider>
  )
  await act(async () => {
    await Promise.resolve()
  })
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
  api = makeApi()
  showPorts = vi.fn()
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('firewallBlocksInbound', () => {
  it('only says blocked when an enabled firewall really blocks by default', () => {
    expect(firewallBlocksInbound(firewall())).toBe(true)
    expect(firewallBlocksInbound(firewall({ defaultInbound: 'Allow' }))).toBe(false)
    expect(firewallBlocksInbound(firewall({ enabled: false }))).toBe(false)
    expect(firewallBlocksInbound(firewall({ defaultInbound: null }))).toBe(false)
    expect(firewallBlocksInbound(null)).toBe(false)
  })
})

describe('dnsMismatch', () => {
  it('flags only a file WSL no longer maintains whose servers Windows does not use', () => {
    const stale = dns({ generateResolvConf: false, isGeneratedSymlink: false })
    expect(dnsMismatch(stale)).toBe(true)
    // Same servers on both sides is not a mismatch, however it is maintained.
    expect(dnsMismatch(dns({ ...stale, nameservers: ['192.168.1.1'] }))).toBe(false)
    // A generated file that merely lags is a timing artefact, not a fault.
    expect(dnsMismatch(dns())).toBe(false)
    expect(dnsMismatch(null)).toBe(false)
    expect(networkNeedsAttention(null, stale)).toBe(true)
    expect(networkNeedsAttention(null, null)).toBe(false)
  })
})

describe('NetworkCard firewall block', () => {
  it('names the Hyper-V layer the Windows firewall window never shows', async () => {
    await renderCard()

    expect(
      screen.getByText(/Hyper-V firewall that the Windows Defender Firewall window never shows/)
    ).toBeTruthy()
  })

  it('states plainly that inbound is blocked by default', async () => {
    await renderCard()

    expect(screen.getByText(/Inbound traffic is blocked by default/)).toBeTruthy()
    expect(screen.getByText('Block')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('offers the elevated command as copyable text and nothing else', async () => {
    await renderCard()

    expect(screen.getByText(ALLOW_INBOUND_COMMAND)).toBeTruthy()
    expect(screen.getByText(/needs an administrator PowerShell/)).toBeTruthy()
    // It cannot be prepared in the Console, so no such button may exist here.
    expect(screen.queryByRole('button', { name: 'Prepare in Console' })).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy command line' }))
      await Promise.resolve()
    })
    expect(api.copyToClipboard).toHaveBeenCalledWith(ALLOW_INBOUND_COMMAND)
    expect(api.copyToClipboard).toHaveBeenCalledTimes(1)
  })

  it('offers nothing to copy when inbound is already allowed', async () => {
    await renderCard(firewall({ defaultInbound: 'Allow' }))

    expect(screen.queryByText(ALLOW_INBOUND_COMMAND)).toBeNull()
    expect(screen.queryByText(/Inbound traffic is blocked by default/)).toBeNull()
    // both defaults now read Allow, and neither is a Block
    expect(screen.getAllByText('Allow')).toHaveLength(2)
    expect(screen.queryByText('Block')).toBeNull()
  })

  it('reads an unreadable layer as unknown, never as a firewall that is off', async () => {
    const unread: FirewallInfo = {
      enabled: null,
      defaultInbound: null,
      defaultOutbound: null,
      loopbackEnabled: null,
      ruleCount: null,
      error: 'The Hyper-V firewall cmdlets are missing on this Windows build'
    }
    await renderCard(unread)

    expect(screen.getByText(unread.error as string)).toBeTruthy()
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(2)
    expect(screen.queryByText('Disabled')).toBeNull()
    expect(screen.queryByText(ALLOW_INBOUND_COMMAND)).toBeNull()
  })

  it('says so when the firewall was never read at all', async () => {
    await renderCard(null)

    expect(screen.getByText('The Windows firewall state could not be read.')).toBeTruthy()
    expect(screen.queryByText(ALLOW_INBOUND_COMMAND)).toBeNull()
  })

  it('shows nothing but a note when neither side answered', async () => {
    await renderCard(null, null)

    expect(screen.getByText('No network information for this distribution')).toBeTruthy()
    expect(screen.queryByText(ALLOW_INBOUND_COMMAND)).toBeNull()
  })
})

describe('NetworkCard resolver block', () => {
  it('explains a resolv.conf WSL stopped maintaining', async () => {
    await renderCard(firewall(), dns({ generateResolvConf: false, isGeneratedSymlink: false }))

    expect(screen.getByText(/are not the ones Windows hands out/)).toBeTruthy()
    expect(screen.getByText('10.255.255.254')).toBeTruthy()
    expect(screen.getByText('192.168.1.1')).toBeTruthy()
  })

  it('sends the reader to the ports, where the same rules apply', async () => {
    await renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'See the ports' }))
    expect(showPorts).toHaveBeenCalledTimes(1)
  })
})
