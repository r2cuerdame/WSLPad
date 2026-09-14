import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '@shared/format'
import type { LocaleCode, WindowsPlace } from '@shared/types'
import {
  buildBackupCommand,
  buildBackupVerificationCommand,
  buildCloneCommands,
  buildImportCommand,
  buildVerificationCommands,
  recoveryHeadroom,
  type RecoveryHistoryEntry,
  type RecoveryOperation
} from '@shared/recovery-workflows'
import { useApp } from '../store'
import CopyButton from '../components/CopyButton'
import MigrationTab from '../migration/MigrationTab'
import './recovery.css'

type Section = 'backup' | 'restore' | 'clone' | 'relocation' | 'history'
const SECTIONS: readonly Section[] = ['backup', 'restore', 'clone', 'relocation', 'history']

function driveForPath(path: string, drives: WindowsPlace[]): WindowsPlace | null {
  const match = /^([A-Za-z]):\\/.exec(path.trim())
  if (!match) return null
  return drives.find((drive) => drive.kind === 'drive' && drive.label.toUpperCase().startsWith(`${match[1].toUpperCase()}:`)) ?? null
}

function commandOrError(builder: () => string): { command: string | null; error: string | null } {
  try {
    return { command: builder(), error: null }
  } catch (error) {
    return { command: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function CommandBox({ text, testId }: { text: string; testId?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="recovery-command" data-testid={testId}>
      <pre className="mono">{text}</pre>
      <CopyButton text={text} toastKey="toast.copiedCommand" className="btn btn-small">
        {t('common.copy')}
      </CopyButton>
    </div>
  )
}

export default function RecoveryTab(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { snapshot } = useApp()
  const [section, setSection] = useState<Section>('backup')
  const [drives, setDrives] = useState<WindowsPlace[]>([])
  const [history, setHistory] = useState<RecoveryHistoryEntry[]>([])

  const selected = snapshot?.selectedDistro ?? ''
  const selectedInfo = snapshot?.distros.find((d) => d.name === selected) ?? null
  const existingNames = useMemo(
    () => snapshot?.distros.map((d) => d.name) ?? [],
    [snapshot?.distros]
  )
  const disk = snapshot?.dashboard?.disk ?? null
  const imageBytes = disk?.allocatedBytes ?? disk?.vhdxBytes ?? null

  const [backupPath, setBackupPath] = useState('D:\\WSL\\Backups\\distro.tar')
  const [restoreTar, setRestoreTar] = useState('D:\\WSL\\Backups\\distro.tar')
  const [restoreName, setRestoreName] = useState('distro-restored')
  const [restoreDir, setRestoreDir] = useState('D:\\WSL\\distro-restored')
  const [cloneTar, setCloneTar] = useState('D:\\WSL\\Backups\\distro-clone.tar')
  const [cloneName, setCloneName] = useState('distro-clone')
  const [cloneDir, setCloneDir] = useState('D:\\WSL\\distro-clone')

  useEffect(() => {
    let active = true
    void window.wslpad.windows.places().then((places) => {
      if (active) setDrives(places.filter((place) => place.kind === 'drive'))
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!selected) return
    setBackupPath(`D:\\WSL\\Backups\\${selected}.tar`)
    setRestoreTar(`D:\\WSL\\Backups\\${selected}.tar`)
    setRestoreName(`${selected}-restored`)
    setRestoreDir(`D:\\WSL\\${selected}-restored`)
    setCloneTar(`D:\\WSL\\Backups\\${selected}-clone.tar`)
    setCloneName(`${selected}-clone`)
    setCloneDir(`D:\\WSL\\${selected}-clone`)
  }, [selected])

  const backup = useMemo(() => commandOrError(() => buildBackupCommand(selected, backupPath)), [selected, backupPath])
  const backupVerify = useMemo(
    () => commandOrError(() => buildBackupVerificationCommand(backupPath)),
    [backupPath]
  )
  const backupDrive = driveForPath(backupPath, drives)
  const headroom = recoveryHeadroom(imageBytes, backupDrive?.freeBytes ?? null)

  const restore = useMemo(
    () => commandOrError(() => buildImportCommand(restoreName, restoreDir, restoreTar, existingNames)),
    [restoreName, restoreDir, restoreTar, existingNames]
  )
  const restoreVerify = useMemo(() => commandOrError(() => buildVerificationCommands(restoreName).join('\n')), [restoreName])

  const clone = useMemo(() => {
    try {
      return { value: buildCloneCommands(selected, cloneName, cloneDir, cloneTar, existingNames), error: null as string | null }
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [selected, cloneName, cloneDir, cloneTar, existingNames])

  const addHistory = (operation: RecoveryOperation, target: string, newName: string | null): string => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setHistory((rows) => [{
      id,
      operation,
      sourceDistro: selected,
      target,
      newDistroName: newName,
      createdAt: new Date().toISOString(),
      format: 'tar',
      sizeBytes: imageBytes,
      wslVersion: selectedInfo?.wslVersion ?? null,
      verification: 'unverified'
    }, ...rows])
    return id
  }

  const verifyHistory = (id: string): void => {
    setHistory((rows) => rows.map((row) => row.id === id ? { ...row, verification: 'verified' } : row))
  }

  const latest = (operation: RecoveryOperation): RecoveryHistoryEntry | undefined => history.find((row) => row.operation === operation)

  return (
    <div className="recovery-tab" data-testid="recovery-tab">
      <div className="recovery-heading">
        <div>
          <h2>{t('recovery.title')}</h2>
          <p className="dim">{t('recovery.subtitle')}</p>
        </div>
        <div className="notice-warn recovery-safety">{t('recovery.safety')}</div>
      </div>

      <nav className="recovery-nav" aria-label={t('recovery.title')}>
        {SECTIONS.map((id) => (
          <button key={id} type="button" className={section === id ? 'btn btn-accent' : 'btn'} onClick={() => setSection(id)} data-testid={`recovery-nav-${id}`}>
            {t(`recovery.${id}`)}
          </button>
        ))}
      </nav>

      {section === 'backup' && (
        <section className="recovery-panel" data-testid="recovery-backup">
          <h3>{t('recovery.backup')}</h3>
          <p className="dim">{t('recovery.backupHint', { distro: selected || '—' })}</p>
          <label className="recovery-field">{t('recovery.backupPath')}<input className="input-text" value={backupPath} onChange={(e) => setBackupPath(e.target.value)} /></label>
          <div className={`recovery-headroom notice-${headroom.status === 'ok' ? 'ok' : 'warn'}`} data-testid="recovery-headroom">
            {headroom.status === 'unknown' ? t('recovery.headroomUnknown') : t('recovery.headroom', {
              free: formatBytes(locale, headroom.freeBytes),
              required: formatBytes(locale, headroom.requiredBytes),
              recommended: formatBytes(locale, headroom.recommendedBytes)
            })}
          </div>
          {backup.error ? <div className="notice-warn" role="alert">{backup.error}</div> : backup.command ? <CommandBox text={backup.command} testId="recovery-backup-command" /> : null}
          {backupVerify.command && !backup.error ? <CommandBox text={backupVerify.command} testId="recovery-backup-verify-command" /> : null}
          <div className="recovery-actions">
            <button type="button" className="btn btn-primary" data-testid="recovery-confirm-backup" disabled={!backup.command || headroom.status === 'critical'} onClick={() => addHistory('backup', backupPath, null)}>{t('recovery.confirmRan')}</button>
            {latest('backup')?.verification === 'unverified' && <button type="button" className="btn" data-testid="recovery-verify-backup" onClick={() => verifyHistory(latest('backup')!.id)}>{t('recovery.markVerified')}</button>}
          </div>
          {latest('backup') && <div data-testid="recovery-backup-status" className="dim">{t(`recovery.${latest('backup')!.verification}`)}</div>}
        </section>
      )}

      {section === 'restore' && (
        <section className="recovery-panel" data-testid="recovery-restore">
          <h3>{t('recovery.restore')}</h3>
          <p className="dim">{t('recovery.newNameOnly')}</p>
          <label className="recovery-field">{t('recovery.sourceTar')}<input className="input-text" value={restoreTar} onChange={(e) => setRestoreTar(e.target.value)} /></label>
          <label className="recovery-field">{t('recovery.newDistroName')}<input className="input-text" data-testid="recovery-restore-name" value={restoreName} onChange={(e) => setRestoreName(e.target.value)} /></label>
          <label className="recovery-field">{t('recovery.installFolder')}<input className="input-text" value={restoreDir} onChange={(e) => setRestoreDir(e.target.value)} /></label>
          {restore.error ? <div className="notice-warn" role="alert" data-testid="recovery-restore-error">{restore.error}</div> : restore.command ? <CommandBox text={restore.command} testId="recovery-restore-command" /> : null}
          {restoreVerify.command && !restore.error && <CommandBox text={restoreVerify.command} testId="recovery-restore-verify" />}
          <div className="recovery-actions"><button type="button" className="btn btn-primary" disabled={!restore.command} onClick={() => addHistory('restore', restoreTar, restoreName)}>{t('recovery.confirmRan')}</button>{latest('restore')?.verification === 'unverified' && <button type="button" className="btn" onClick={() => verifyHistory(latest('restore')!.id)}>{t('recovery.markVerified')}</button>}</div>
        </section>
      )}

      {section === 'clone' && (
        <section className="recovery-panel" data-testid="recovery-clone">
          <h3>{t('recovery.clone')}</h3>
          <p className="dim">{t('recovery.cloneHint', { distro: selected || '—' })}</p>
          <label className="recovery-field">{t('recovery.backupPath')}<input className="input-text" value={cloneTar} onChange={(e) => setCloneTar(e.target.value)} /></label>
          <label className="recovery-field">{t('recovery.newDistroName')}<input className="input-text" value={cloneName} onChange={(e) => setCloneName(e.target.value)} /></label>
          <label className="recovery-field">{t('recovery.installFolder')}<input className="input-text" value={cloneDir} onChange={(e) => setCloneDir(e.target.value)} /></label>
          {clone.error ? <div className="notice-warn" role="alert">{clone.error}</div> : clone.value ? <>
            <CommandBox text={clone.value.exportCommand} testId="recovery-clone-export" />
            <CommandBox text={clone.value.importCommand} testId="recovery-clone-import" />
            <CommandBox text={clone.value.verificationCommands.join('\n')} testId="recovery-clone-verify" />
          </> : null}
          <div className="recovery-actions"><button type="button" className="btn btn-primary" disabled={!clone.value} onClick={() => addHistory('clone', cloneDir, cloneName)}>{t('recovery.confirmRan')}</button>{latest('clone')?.verification === 'unverified' && <button type="button" className="btn" onClick={() => verifyHistory(latest('clone')!.id)}>{t('recovery.markVerified')}</button>}</div>
        </section>
      )}

      {section === 'relocation' && <section data-testid="recovery-relocation"><MigrationTab /></section>}

      {section === 'history' && (
        <section className="recovery-panel" data-testid="recovery-history">
          <h3>{t('recovery.history')}</h3>
          {history.length === 0 ? <div className="dim">{t('recovery.historyEmpty')}</div> : <div className="dash-table-wrap"><table className="dash-table"><thead><tr><th>{t('recovery.operation')}</th><th>{t('recovery.source')}</th><th>{t('recovery.target')}</th><th>{t('recovery.created')}</th><th>{t('recovery.verification')}</th><th /></tr></thead><tbody>{history.map((row) => <tr key={row.id} data-testid={`recovery-history-${row.id}`}><td>{t(`recovery.${row.operation}`)}</td><td>{row.sourceDistro}</td><td className="mono">{row.newDistroName ?? row.target}</td><td>{row.createdAt}</td><td>{t(`recovery.${row.verification}`)}</td><td>{row.verification === 'unverified' && <button type="button" className="btn btn-small" onClick={() => verifyHistory(row.id)}>{t('recovery.markVerified')}</button>}</td></tr>)}</tbody></table></div>}
        </section>
      )}
    </div>
  )
}