import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocaleCode, McpClientKind, McpStatus } from '@shared/types'
import { formatDateTime } from '@shared/format'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'

function Kv({ k, mono, children }: { k: string; mono?: boolean; children: ReactNode }): React.JSX.Element {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className={mono ? 'kv-val mono' : 'kv-val'}>{children}</span>
    </div>
  )
}

export interface McpCardProps {
  mcp: McpStatus
}

export default function McpCard({ mcp }: McpCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { pushToast } = useApp()

  const copyConfig = async (): Promise<void> => {
    try {
      const json = await window.wslpad.mcp.getConfigJson()
      await window.wslpad.copyToClipboard(json)
      pushToast('success', t('common.copied'))
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  const register = async (kind: McpClientKind, client: string): Promise<void> => {
    try {
      const res = await window.wslpad.mcp.registerClient(kind)
      if (res.ok) pushToast('success', t('dashboard.mcp.registered', { client }))
      else pushToast('error', t('dashboard.mcp.registerFailed', { client }))
    } catch {
      pushToast('error', t('dashboard.mcp.registerFailed', { client }))
    }
  }

  const testConnection = async (): Promise<void> => {
    try {
      const res = await window.wslpad.mcp.test()
      if (res.ok) pushToast('success', t('dashboard.mcp.testOk'))
      else pushToast('error', t('dashboard.mcp.testFailed'))
    } catch {
      pushToast('error', t('dashboard.mcp.testFailed'))
    }
  }

  const regenerate = async (): Promise<void> => {
    try {
      await window.wslpad.mcp.regenerateToken()
      pushToast('info', t('settings.mcp.tokenRegenerated'))
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  return (
    <Card titleKey="dashboard.mcp.title">
      <Kv k={t('dashboard.mcp.status')}>
        {mcp.running ? (
          <span className="badge badge-ok">{t('common.running')}</span>
        ) : (
          <span className="badge badge-dim">{t('common.stopped')}</span>
        )}
        <span className="badge badge-accent">{t('dashboard.mcp.readOnlyBadge')}</span>
      </Kv>
      <Kv k={t('dashboard.mcp.transport')} mono>
        {mcp.transport.toUpperCase()}
      </Kv>
      <Kv k={t('dashboard.mcp.endpoint')} mono>
        {mcp.endpoint ? (
          <>
            <span className="truncate" title={mcp.endpoint}>
              {mcp.endpoint}
            </span>
            <CopyButton text={mcp.endpoint} labelKey="dashboard.mcp.copyEndpoint" size={13} />
          </>
        ) : (
          '—'
        )}
      </Kv>
      <Kv k={t('dashboard.mcp.clients')}>{mcp.connectedClients}</Kv>
      <Kv k={t('dashboard.mcp.lastRequest')}>{formatDateTime(locale, mcp.lastRequestAt)}</Kv>
      <Kv k={t('dashboard.mcp.authToken')}>
        {mcp.tokenSet ? t('dashboard.mcp.tokenSet') : t('common.no')}
      </Kv>
      {mcp.error ? (
        <Kv k={t('common.error')}>
          <span className="err-text">{mcp.error}</span>
        </Kv>
      ) : null}
      <div className="mcp-buttons">
        <button type="button" className="btn btn-small" onClick={() => void copyConfig()}>
          {t('dashboard.mcp.copyConfig')}
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => void register('codex', 'Codex')}
        >
          {t('dashboard.mcp.registerCodex')}
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => void register('claude-desktop', 'Claude Desktop')}
        >
          {t('dashboard.mcp.registerClaude')}
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => void register('hermes', 'Hermes')}
        >
          {t('dashboard.mcp.registerHermes')}
        </button>
        <button type="button" className="btn btn-small" onClick={() => void testConnection()}>
          {t('dashboard.mcp.test')}
        </button>
        <button type="button" className="btn btn-small" onClick={() => void regenerate()}>
          {t('dashboard.mcp.regenerateToken')}
        </button>
      </div>
    </Card>
  )
}
