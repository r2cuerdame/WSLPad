import { useTranslation } from 'react-i18next'
import type { PortInfo } from '@shared/types'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { ExternalIcon, SearchIcon } from '../components/Icons'

export interface PortsCardProps {
  ports: PortInfo[]
}

export default function PortsCard({ ports }: PortsCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { setFocusPid } = useApp()

  return (
    <Card titleKey="dashboard.ports.title">
      {ports.length === 0 ? (
        <div className="dim">{t('common.none')}</div>
      ) : (
        <div className="dash-table-wrap dash-scroll">
          <table className="dash-table">
            <thead>
              <tr>
                <th scope="col">{t('dashboard.ports.protocol')}</th>
                <th scope="col">{t('dashboard.ports.address')}</th>
                <th scope="col">{t('dashboard.ports.port')}</th>
                <th scope="col">{t('dashboard.processes.pid')}</th>
                <th scope="col">{t('dashboard.ports.process')}</th>
                <th scope="col">
                  <span className="sr-only">{t('common.details')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ports.map((p) => {
                const url = p.localhostUrl
                const pid = p.pid
                return (
                  <tr key={`${p.protocol}:${p.localAddress}:${p.port}`}>
                    <td className="mono">{p.protocol}</td>
                    <td className="mono">{p.localAddress}</td>
                    <td className="mono">{p.port}</td>
                    <td className="mono">{pid ?? '—'}</td>
                    <td className="truncate" title={p.processName ?? undefined}>
                      {p.processName ?? '—'}
                    </td>
                    <td>
                      <span className="row-actions">
                        {url ? (
                          <>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={t('dashboard.ports.openInBrowser')}
                              title={t('dashboard.ports.openInBrowser')}
                              onClick={() => void window.wslpad.openExternal(url)}
                            >
                              <ExternalIcon size={14} />
                            </button>
                            <CopyButton
                              text={url}
                              toastKey="toast.copiedUrl"
                              labelKey="dashboard.ports.copyUrl"
                              size={14}
                            />
                          </>
                        ) : null}
                        {pid !== null ? (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={t('dashboard.ports.showProcess')}
                            title={t('dashboard.ports.showProcess')}
                            onClick={() => setFocusPid(pid)}
                          >
                            <SearchIcon size={14} />
                          </button>
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
    </Card>
  )
}
