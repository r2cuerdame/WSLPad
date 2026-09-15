import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsbInventory, UsbDeviceInfo } from '@shared/types'
import { buildUsbCommands } from '@shared/usb'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { RefreshIcon, SearchIcon } from '../components/Icons'

type ViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; value: UsbInventory }
  | { kind: 'error'; message: string }

export default function UsbCard({
  distro,
  onDiscover
}: {
  distro: string
  onDiscover: (query: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewState>({ kind: 'idle' })

  const scan = async (): Promise<void> => {
    setView({ kind: 'loading' })
    try {
      setView({ kind: 'done', value: await window.wslpad.usb.inventory() })
    } catch (error) {
      setView({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const actions = (
    <button className="btn btn-small" type="button" onClick={() => void scan()} disabled={view.kind === 'loading'} data-testid="usb-scan">
      <RefreshIcon size={13} />
      {view.kind === 'done' ? t('usb.refresh') : t('usb.scan')}
    </button>
  )

  return (
    <Card titleKey="usb.title" actions={actions}>
      <p className="dim">{t('usb.intro', { distro })}</p>
      <div className="notice-warn usb-safety">{t('usb.safety')}</div>
      {view.kind === 'idle' && <div className="dim" data-testid="usb-idle">{t('usb.idle')}</div>}
      {view.kind === 'loading' && <div className="dim" role="status">{t('usb.loading')}</div>}
      {view.kind === 'error' && <div className="notice-warn" role="alert">{view.message}</div>}
      {view.kind === 'done' && <UsbInventoryView inventory={view.value} onDiscover={onDiscover} />}
    </Card>
  )
}

function UsbInventoryView({ inventory, onDiscover }: { inventory: UsbInventory; onDiscover: (query: string) => void }): React.JSX.Element {
  const { t } = useTranslation()
  if (!inventory.installed) {
    return (
      <div className="usb-missing" data-testid="usb-missing">
        <div className="notice-warn">{t('usb.missing')}{inventory.error ? ` ${inventory.error}` : ''}</div>
        <button className="btn btn-small" type="button" onClick={() => onDiscover('usbipd')} data-testid="usb-discover">
          <SearchIcon size={13} /> {t('usb.find')}
        </button>
      </div>
    )
  }

  return (
    <div data-testid="usb-inventory">
      <p className="dim">{t('usb.version', { version: inventory.version ?? t('common.unknown') })}</p>
      {inventory.error && <div className="notice-warn" role="alert">{inventory.error}</div>}
      {!inventory.error && inventory.devices.length === 0 && <div className="dim">{t('usb.empty')}</div>}
      {inventory.devices.length > 0 && (
        <div className="dash-table-wrap dash-scroll">
          <table className="dash-table usb-table">
            <thead><tr><th>{t('usb.busId')}</th><th>{t('usb.vidPid')}</th><th>{t('usb.device')}</th><th>{t('usb.state')}</th><th><span className="sr-only">{t('common.details')}</span></th></tr></thead>
            <tbody>{inventory.devices.map((device) => <UsbDeviceRow key={device.busId} device={device} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function UsbDeviceRow({ device }: { device: UsbDeviceInfo }): React.JSX.Element {
  const { t } = useTranslation()
  const commands = buildUsbCommands(device.busId)
  return (
    <tr data-testid={`usb-device-${device.busId}`}>
      <td className="mono">{device.busId}</td>
      <td className="mono">{device.vidPid}</td>
      <td>{device.device}</td>
      <td><span className={`badge usb-state usb-state-${device.state}`} title={device.rawState}>{t(`usb.states.${device.state}`)}</span></td>
      <td><div className="usb-command-actions">
        {device.state === 'windows-only' && <CommandCopy label={t('usb.bind')} command={commands.bind} testId={`usb-bind-${device.busId}`} />}
        {(device.state === 'windows-only' || device.state === 'bound' || device.state === 'available') && <CommandCopy label={t('usb.attach')} command={commands.attach} testId={`usb-attach-${device.busId}`} />}
        {device.state === 'attached' && <CommandCopy label={t('usb.detach')} command={commands.detach} testId={`usb-detach-${device.busId}`} />}
      </div></td>
    </tr>
  )
}

function CommandCopy({ label, command, testId }: { label: string; command: string; testId: string }): React.JSX.Element {
  return <CopyButton text={command} toastKey="toast.copiedCommand" labelKey="common.copy" className="btn btn-small" children={<span data-testid={testId}>{label}</span>} />
}
