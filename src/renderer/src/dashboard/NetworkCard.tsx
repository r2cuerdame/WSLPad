import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DnsInfo, FirewallInfo, PortProxyInfo, PortProxyRule } from '@shared/types'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { PlugIcon } from '../components/Icons'

/** WSL's fixed VM creator id — the same GUID src/main/wsl/firewall.ts reads. */
const WSL_VM_CREATOR_ID = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'

/**
 * Copyable text and nothing else. It needs an elevated PowerShell, so it can
 * never be a Console-prepared command, and WSLPad never runs it: the user
 * copies it, reads it and decides (goal.md §2.2).
 */
const ALLOW_INBOUND_COMMAND = [
  'Set-NetFirewallHyperVVMSetting',
  `-Name '${WSL_VM_CREATOR_ID}'`,
  '-DefaultInboundAction Allow'
].join(' ')

function Kv({
  k,
  mono,
  children
}: {
  k: string
  mono?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className={mono ? 'kv-val mono' : 'kv-val'}>{children}</span>
    </div>
  )
}

/** Inbound is blocked unless the firewall says otherwise; null stays unknown. */
export function firewallBlocksInbound(firewall: FirewallInfo | null): boolean {
  if (firewall === null || firewall.enabled === false) return false
  return /^block/i.test(firewall.defaultInbound ?? '')
}

/**
 * The resolver is inconsistent only when WSL has stopped maintaining the file
 * AND Windows is handing out servers it does not list. A generated file that
 * merely lags behind is a timing artefact, not a misconfiguration.
 */
export function dnsMismatch(dns: DnsInfo | null): boolean {
  if (dns === null || dns.windowsAdapterDns.length === 0) return false
  const managed = dns.generateResolvConf !== false && dns.isGeneratedSymlink !== false
  if (managed) return false
  return dns.windowsAdapterDns.some((server) => !dns.nameservers.includes(server))
}

export function networkNeedsAttention(firewall: FirewallInfo | null, dns: DnsInfo | null): boolean {
  return firewallBlocksInbound(firewall) || dnsMismatch(dns)
}

export interface NetworkCardProps {
  firewall: FirewallInfo | null
  dns: DnsInfo | null
  /** Windows forwarding rules; null until the table has been read. */
  portProxy?: PortProxyInfo | null
  /** Jumps to the Ports section, where the same rules decide reachability. */
  onShowPorts: () => void
}

/**
 * Why traffic does or does not reach this distribution (0.1.3 §network): the
 * Windows firewall on one side, the resolver configuration on the other. Both
 * are read-only — WSLPad never creates a rule and never rewrites resolv.conf.
 */
/** Only 'live' is healthy; a rule that forwards nowhere is an error, not a note. */
const PROXY_TONE: Record<PortProxyRule['verdict'], string> = {
  live: 'badge badge-ok',
  stale: 'badge badge-err',
  elsewhere: 'badge badge-dim',
  unknown: 'badge badge-dim'
}

export default function NetworkCard({
  firewall,
  dns,
  portProxy = null,
  onShowPorts
}: NetworkCardProps): React.JSX.Element {
  const { t } = useTranslation()

  const yesNoUnknown = (v: boolean | null): ReactNode =>
    v === null ? (
      <span className="dim">{t('common.unknown')}</span>
    ) : v ? (
      t('common.yes')
    ) : (
      t('common.no')
    )

  const list = (values: string[]): ReactNode =>
    values.length === 0 ? <span className="dim">{t('common.none')}</span> : values.join(', ')

  const text = (value: string | null): ReactNode =>
    value === null ? <span className="dim">{t('common.unknown')}</span> : value

  const number = (value: number | null): ReactNode =>
    value === null ? <span className="dim">{t('common.unknown')}</span> : String(value)

  if (firewall === null && dns === null) {
    return (
      <Card titleKey="dashboard.network.title">
        <div className="dim">
          {t('dashboard.network.unavailable', {
            defaultValue: 'No network information for this distribution'
          })}
        </div>
      </Card>
    )
  }

  return (
    <Card titleKey="dashboard.network.title">
      <div className="path-label">
        {t('dashboard.network.firewall', { defaultValue: 'Windows firewall' })}
      </div>
      <div className="dim">
        {t('dashboard.network.hyperVLayer', {
          defaultValue:
            'Traffic to this distribution crosses a Hyper-V firewall that the Windows Defender ' +
            'Firewall window never shows. WSLPad only reads it.'
        })}
      </div>
      {firewall === null ? (
        <div className="dim">
          {t('dashboard.network.firewallUnknown', {
            defaultValue: 'The Windows firewall state could not be read.'
          })}
        </div>
      ) : (
        <>
          {firewall.error !== null ? (
            <div className="kv-row">
              <span className="badge badge-warn">{t('common.warning')}</span>
              <span className="kv-val dim">{firewall.error}</span>
            </div>
          ) : null}
          {firewallBlocksInbound(firewall) ? (
            <div className="overview-head">
              <span>
                {t('dashboard.network.inboundBlocked', {
                  defaultValue:
                    'Inbound traffic is blocked by default, so nothing on the network reaches this distribution unless a rule allows it.'
                })}
              </span>
            </div>
          ) : null}
          <Kv k={t('dashboard.network.state', { defaultValue: 'Firewall' })}>
            {firewall.enabled === null ? (
              <span className="badge badge-dim">{t('common.unknown')}</span>
            ) : firewall.enabled ? (
              <span className="badge badge-ok">{t('common.enabled')}</span>
            ) : (
              <span className="badge badge-dim">{t('common.disabled')}</span>
            )}
          </Kv>
          <Kv k={t('dashboard.network.defaultInbound', { defaultValue: 'Default inbound' })}>
            {text(firewall.defaultInbound)}
          </Kv>
          <Kv k={t('dashboard.network.defaultOutbound', { defaultValue: 'Default outbound' })}>
            {text(firewall.defaultOutbound)}
          </Kv>
          <Kv k={t('dashboard.network.loopback', { defaultValue: 'WSL loopback exemption' })}>
            {yesNoUnknown(firewall.loopbackEnabled)}
          </Kv>
          <Kv k={t('dashboard.network.rules', { defaultValue: 'Rules mentioning WSL' })}>
            {number(firewall.ruleCount)}
          </Kv>
          {firewallBlocksInbound(firewall) ? (
            <div className="path-row">
              <div className="row-main">
                <div className="path-line">
                  <span className="path-label">
                    {t('dashboard.network.allowInboundLabel', {
                      defaultValue: 'Open the virtual machine to inbound traffic'
                    })}
                  </span>
                </div>
                <div className="mono dim truncate" title={ALLOW_INBOUND_COMMAND}>
                  {ALLOW_INBOUND_COMMAND}
                </div>
                <div className="dim">
                  {t('dashboard.network.elevatedOnly', {
                    defaultValue:
                      'This one needs an administrator PowerShell, so WSLPad cannot ' +
                      'put it in the Console for you and never runs it. Copy it, read ' +
                      'it, and run it yourself — it lets inbound traffic into the ' +
                      'whole virtual machine, not just one port.'
                  })}
                </div>
              </div>
              <span className="row-actions">
                <CopyButton
                  text={ALLOW_INBOUND_COMMAND}
                  toastKey="toast.copiedCommand"
                  labelKey="dashboard.processes.copyCommand"
                  size={13}
                />
              </span>
            </div>
          ) : null}
        </>
      )}

      <div className="path-label">
        {t('dashboard.network.dns', { defaultValue: 'Name resolution' })}
      </div>
      {dns === null ? (
        <div className="dim">
          {t('dashboard.network.dnsUnknown', {
            defaultValue: 'The resolver configuration could not be read.'
          })}
        </div>
      ) : (
        <>
          {dns.error !== null ? (
            <div className="kv-row">
              <span className="badge badge-warn">{t('common.warning')}</span>
              <span className="kv-val dim">{dns.error}</span>
            </div>
          ) : null}
          {dnsMismatch(dns) ? (
            <div className="overview-head">
              <span>
                {t('dashboard.network.dnsMismatch', {
                  defaultValue:
                    'The servers in {{path}} are not the ones Windows hands out. WSL stopped maintaining this file when generateResolvConf was turned off, so it still lists the network it was written on.',
                  path: dns.resolvConfPath
                })}
              </span>
            </div>
          ) : null}
          <Kv k={t('dashboard.network.resolvConf', { defaultValue: 'Resolver file' })} mono>
            {dns.resolvConfPath}
          </Kv>
          <Kv k={t('dashboard.network.generatedSymlink', { defaultValue: 'Generated by WSL' })}>
            {yesNoUnknown(dns.isGeneratedSymlink)}
          </Kv>
          <Kv
            k={t('dashboard.network.generateResolvConf', {
              defaultValue: 'generateResolvConf'
            })}
          >
            {yesNoUnknown(dns.generateResolvConf)}
          </Kv>
          <Kv k={t('dashboard.network.dnsTunneling', { defaultValue: 'DNS tunneling' })}>
            {yesNoUnknown(dns.dnsTunneling)}
          </Kv>
          <Kv k={t('dashboard.network.nameservers', { defaultValue: 'Nameservers in use' })} mono>
            {list(dns.nameservers)}
          </Kv>
          <Kv k={t('dashboard.network.windowsDns', { defaultValue: 'Windows adapter DNS' })} mono>
            {list(dns.windowsAdapterDns)}
          </Kv>
        </>
      )}

      {/* Port forwarding rules people add once and never revisit. Under NAT the
          distro's address is reassigned on every WSL restart, so a rule that
          was right last week now forwards into nothing — silently. Nothing on
          Windows puts the rule and the current address side by side (#53). */}
      {portProxy === null ? null : (
        <>
          <div className="kv-row">
            <span className="kv-key">{t('dashboard.network.portProxy')}</span>
            <span className="kv-val">
              {portProxy.error !== null ? (
                <span className="dim">{portProxy.error}</span>
              ) : portProxy.rules.length === 0 ? (
                <span className="dim">{t('dashboard.network.noPortProxy')}</span>
              ) : (
                <span className="dim">
                  {t('dashboard.network.portProxyAgainst', {
                    ip: portProxy.distroIp ?? t('common.unknown')
                  })}
                </span>
              )}
            </span>
          </div>
          {portProxy.rules.length === 0 ? null : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th scope="col">{t('dashboard.network.listenOn')}</th>
                    <th scope="col">{t('dashboard.network.forwardsTo')}</th>
                    <th scope="col">{t('dashboard.wslconfig.status')}</th>
                    <th scope="col">
                      <span className="sr-only">{t('common.details')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {portProxy.rules.map((rule) => {
                    const id = `${rule.listenAddress}:${rule.listenPort}`
                    const to = `${rule.connectAddress}:${rule.connectPort}`
                    return (
                      <tr key={`${id}->${to}`}>
                        <td className="mono">{id}</td>
                        <td className="mono">{to}</td>
                        <td>
                          <span className={PROXY_TONE[rule.verdict]}>
                            {t(`dashboard.network.proxyVerdict.${rule.verdict}`)}
                          </span>
                        </td>
                        <td>
                          <span className="row-actions">
                            {/* Editing a rule needs an elevated shell, which
                                cannot be prepared in the Console — so the fix
                                is copyable text and says so. */}
                            {rule.verdict === 'stale' && portProxy.distroIp !== null ? (
                              <CopyButton
                                text={
                                  `netsh interface portproxy set v4tov4 ` +
                                  `listenaddress=${rule.listenAddress} listenport=${rule.listenPort} ` +
                                  `connectaddress=${portProxy.distroIp} connectport=${rule.connectPort}`
                                }
                                toastKey="common.copied"
                                labelKey="dashboard.network.copyRepair"
                              />
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {portProxy.rules.some((r) => r.verdict === 'stale') ? (
            <div className="dim">{t('dashboard.network.portProxyAdmin')}</div>
          ) : null}
        </>
      )}

      <div className="path-row">
        <div className="row-main">
          <div className="dim">
            {t('dashboard.network.portsHint', {
              defaultValue: 'The same rules decide how far each listening port carries.'
            })}
          </div>
        </div>
        <span className="row-actions">
          <button type="button" className="btn btn-small" onClick={onShowPorts}>
            <PlugIcon size={13} />
            {t('dashboard.network.seePorts', { defaultValue: 'See the ports' })}
          </button>
        </span>
      </div>
    </Card>
  )
}
