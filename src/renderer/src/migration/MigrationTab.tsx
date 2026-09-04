import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { formatBytes } from '@shared/format'
import type { LocaleCode, WindowsPlace } from '@shared/types'
import { DistroIcon } from '../components/DistroIcon'

export default function MigrationTab(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { snapshot, selectDistro, pushToast } = useApp()

  const distros = snapshot?.distros ?? []
  const selected = snapshot?.selectedDistro ?? ''
  const disk = snapshot?.dashboard?.disk

  const [drives, setDrives] = useState<WindowsPlace[]>([])
  const [step, setStep] = useState<number>(1)
  const [targetFolder, setTargetFolder] = useState<string>('C:\\WSL\\Ubuntu')
  const [verifiedStep2, setVerifiedStep2] = useState<boolean>(false)
  const [verifiedStep3, setVerifiedStep3] = useState<boolean>(false)
  const [verifiedStep4, setVerifiedStep4] = useState<boolean>(false)

  // Fetch real Windows drive info via IPC
  useEffect(() => {
    let active = true
    void window.wslpad.windows.places().then((places) => {
      if (!active) return
      const driveList = places.filter((p) => p.kind === 'drive')
      setDrives(driveList)

      // Pick a secondary drive (D:, E:, etc.) by default if present, else C:
      const secondary = driveList.find((d) => !d.label.toUpperCase().startsWith('C:'))
      const defaultDrive = secondary ? secondary.label.replace(/:+$/, '') : 'C'
      const distroName = selected || 'distro'
      setTargetFolder(`${defaultDrive}:\\WSL\\${distroName}`)
    })
    return () => {
      active = false
    }
  }, [selected])

  const bytes = (v: number | null): string => formatBytes(locale, v)
  const onDiskBytes = disk?.allocatedBytes ?? disk?.vhdxBytes ?? null

  // Extract drive letter from current targetFolder (e.g. "D:\WSL\Ubuntu" -> "D")
  const currentDriveLetter = useMemo(() => {
    const m = targetFolder.trim().match(/^([A-Za-z]):/i)
    return m ? m[1].toUpperCase() : null
  }, [targetFolder])

  // Look up matched drive in real system drives
  const matchedDrive = useMemo(() => {
    if (!currentDriveLetter) return null
    return drives.find((d) => d.label.toUpperCase().startsWith(`${currentDriveLetter}:`)) ?? null
  }, [drives, currentDriveLetter])

  // Headroom & Space check against real disk image
  const spaceVerdict = useMemo(() => {
    if (!currentDriveLetter) {
      return { status: 'invalid', message: t('migration.targetPlaceholder') }
    }
    if (!matchedDrive) {
      return {
        status: 'error',
        message: t('migration.driveNotFound', { drive: `${currentDriveLetter}:` })
      }
    }
    const free = matchedDrive.freeBytes
    if (free === null) {
      return { status: 'unknown', message: t('common.unknown') }
    }
    const minNeeded = onDiskBytes ?? 0
    const needed = Math.round(minNeeded * 1.5)

    if (onDiskBytes !== null && free < minNeeded) {
      return {
        status: 'critical',
        message: t('migration.spaceCritical', {
          free: formatBytes(locale, free),
          minNeeded: formatBytes(locale, minNeeded)
        })
      }
    }

    if (onDiskBytes !== null && free < needed) {
      return {
        status: 'warning',
        message: t('migration.spaceWarning', {
          free: formatBytes(locale, free),
          needed: formatBytes(locale, needed)
        })
      }
    }

    return {
      status: 'ok',
      message: t('migration.spaceSufficient', {
        free: formatBytes(locale, free),
        needed: formatBytes(locale, needed)
      })
    }
  }, [currentDriveLetter, matchedDrive, onDiskBytes, locale, t])

  const step1Ready = spaceVerdict.status === 'ok' || spaceVerdict.status === 'warning'
  const step2Ready = step1Ready && verifiedStep2
  const step3Ready = step2Ready && verifiedStep3
  const step4Ready = step3Ready && verifiedStep4

  // Max allowed step user can jump to
  const maxAllowedStep = useMemo(() => {
    if (step4Ready) return 5
    if (step3Ready) return 4
    if (step2Ready) return 3
    if (step1Ready) return 2
    return 1
  }, [step1Ready, step2Ready, step3Ready, step4Ready])

  // Can user click "Next Step" from the current step?
  const canGoNextFromCurrent = useMemo(() => {
    if (step === 1) return step1Ready
    if (step === 2) return verifiedStep2
    if (step === 3) return verifiedStep3
    if (step === 4) return verifiedStep4
    return false
  }, [step, step1Ready, verifiedStep2, verifiedStep3, verifiedStep4])

  const handleSelectDrive = (letter: string): void => {
    const cleanFolder = targetFolder.replace(/^[A-Za-z]:/i, `${letter}:`)
    setTargetFolder(cleanFolder)
  }

  const handleOpenFolder = async (): Promise<void> => {
    try {
      await window.wslpad.windows.mkdir(targetFolder)
      await window.wslpad.windows.openPath(targetFolder)
      pushToast('info', t('toast.openedInExplorer'))
    } catch {
      await window.wslpad.windows.openPath(targetFolder).catch(() => undefined)
    }
  }

  const backupPath = useMemo(() => {
    const cleanFolder = targetFolder.trim().replace(/\\+$/, '')
    return `${cleanFolder}\\${selected || 'distro'}-backup.tar`
  }, [targetFolder, selected])

  const handleVerifyStep2 = (): void => {
    setVerifiedStep2(true)
    pushToast('success', t('migration.exportVerified'))
  }

  const handleVerifyStep3 = (): void => {
    setVerifiedStep3(true)
    pushToast('success', t('migration.importVerified'))
  }

  const handleVerifyStep4 = (): void => {
    setVerifiedStep4(true)
    pushToast('success', t('migration.bootVerified'))
  }

  const exportCommand = `wsl --terminate ${selected}\nwsl --export ${selected} "${backupPath}"`
  const importCommand = `wsl --import ${selected}-new "${targetFolder}" "${backupPath}" --version 2`

  const hasSecondaryDrive = drives.some((d) => !d.label.toUpperCase().startsWith('C:'))

  return (
    <div className="migration-tab">
      <Card titleKey="migration.title">
        <div className="dim" style={{ marginBottom: 16 }}>
          {t('migration.subtitle')}
        </div>

        {/* Distro & Disk Overview */}
        <div className="migration-overview-box">
          <div className="kv-row">
            <span className="kv-key">{t('migration.selectDistro')}</span>
            <span className="kv-val">
              <DistroIcon distro={selected} size={16} />
              <select
                value={selected}
                onChange={(e) => {
                  void selectDistro(e.target.value)
                  const driveLetter = currentDriveLetter ?? 'C'
                  setTargetFolder(`${driveLetter}:\\WSL\\${e.target.value}`)
                  setVerifiedStep2(false)
                  setVerifiedStep3(false)
                  setVerifiedStep4(false)
                  setStep(1)
                }}
                disabled={distros.length === 0}
              >
                {distros.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </span>
          </div>

          <div className="kv-row">
            <span className="kv-key">{t('migration.currentLocation')}</span>
            <span className="kv-val mono truncate" title={disk?.vhdxPath ?? '—'}>
              {disk?.vhdxPath ?? '—'}
            </span>
          </div>

          <div className="kv-row">
            <span className="kv-key">{t('migration.imageSize')}</span>
            <span className="kv-val">{bytes(onDiskBytes)}</span>
          </div>
        </div>

        {/* Wizard Stepper Progress with Strict Verification Gates */}
        <div className="wizard-steps-nav">
          {[1, 2, 3, 4, 5].map((s) => {
            const isAllowed = s <= maxAllowedStep
            return (
              <button
                key={s}
                type="button"
                className={`wizard-step-btn ${step === s ? 'active' : ''} ${s < step ? 'done' : ''}`}
                style={isAllowed ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
                disabled={!isAllowed}
                onClick={() => {
                  if (isAllowed) setStep(s)
                }}
              >
                <span className="step-num">{s}</span>
                <span className="step-text">
                  {s === 1
                    ? t('migration.step1Title')
                    : s === 2
                      ? t('migration.step2Title')
                      : s === 3
                        ? t('migration.step3Title')
                        : s === 4
                          ? t('migration.step4Title')
                          : t('migration.step5Title')}
                </span>
              </button>
            )
          })}
        </div>

        {/* Step 1: Target Location with Truthful Capacity & Drive Selection */}
        {step === 1 && (
          <div className="wizard-step-panel">
            <h3>{t('migration.step1Title')}</h3>
            <p className="dim">{t('migration.step1Desc')}</p>

            {/* Target Drive Selector */}
            <div className="kv-row" style={{ marginTop: 12 }}>
              <span className="kv-key">{t('migration.targetDrive')}</span>
              <span className="kv-val">
                <select
                  value={currentDriveLetter ?? ''}
                  onChange={(e) => handleSelectDrive(e.target.value)}
                  disabled={drives.length === 0}
                >
                  {drives.map((d) => {
                    const l = d.label.replace(/:+$/, '')
                    const freeStr = d.freeBytes !== null ? formatBytes(locale, d.freeBytes) : '?'
                    const totalStr = d.totalBytes !== null ? formatBytes(locale, d.totalBytes) : '?'
                    return (
                      <option key={d.id} value={l}>
                        {l}: ({freeStr} free / {totalStr} total)
                      </option>
                    )
                  })}
                </select>
              </span>
            </div>

            {!hasSecondaryDrive && (
              <div className="notice-warn" style={{ marginTop: 8 }}>
                {t('migration.noSecondaryDrive')}
              </div>
            )}

            {/* Target Folder Input + Open in Explorer Button */}
            <div className="kv-row" style={{ marginTop: 12 }}>
              <span className="kv-key">{t('migration.targetFolder')}</span>
              <span className="kv-val" style={{ flex: 1, display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="input-text"
                  style={{ flex: 1 }}
                  value={targetFolder}
                  placeholder={t('migration.targetPlaceholder')}
                  onChange={(e) => setTargetFolder(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => void handleOpenFolder()}
                  title={t('migration.openFolder')}
                >
                  {t('migration.openFolder')}
                </button>
              </span>
            </div>

            {/* Truthful Real Space Status Banner */}
            <div
              className={
                spaceVerdict.status === 'ok'
                  ? 'notice-ok'
                  : spaceVerdict.status === 'warning'
                    ? 'notice-warn'
                    : 'notice-warn'
              }
              style={{ marginTop: 12 }}
            >
              {spaceVerdict.message}
            </div>
          </div>
        )}

        {/* Step 2: Terminate & Export */}
        {step === 2 && (
          <div className="wizard-step-panel">
            <h3>{t('migration.step2Title')}</h3>
            <p className="dim">{t('migration.step2Desc')}</p>
            <div className="path-row" style={{ marginTop: 12 }}>
              <div className="row-main">
                <div className="path-line">
                  <span className="path-label">{t('migration.exportCmdLabel')}</span>
                </div>
                <pre className="mono dim code-block" style={{ whiteSpace: 'pre-wrap' }}>
                  {exportCommand}
                </pre>
              </div>
              <span className="row-actions">
                <CopyButton text={exportCommand} size={14} />
              </span>
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className={`btn ${verifiedStep2 ? 'btn-ok' : 'btn-primary'}`}
                onClick={handleVerifyStep2}
              >
                {verifiedStep2 ? `✔ ${t('migration.exportVerified')}` : t('migration.verifyExport')}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Import into new location */}
        {step === 3 && (
          <div className="wizard-step-panel">
            <h3>{t('migration.step3Title')}</h3>
            <p className="dim">{t('migration.step3Desc')}</p>
            <div className="path-row" style={{ marginTop: 12 }}>
              <div className="row-main">
                <div className="path-line">
                  <span className="path-label">{t('migration.importCmdLabel')}</span>
                </div>
                <pre className="mono dim code-block" style={{ whiteSpace: 'pre-wrap' }}>
                  {importCommand}
                </pre>
              </div>
              <span className="row-actions">
                <CopyButton text={importCommand} size={14} />
              </span>
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className={`btn ${verifiedStep3 ? 'btn-ok' : 'btn-primary'}`}
                onClick={handleVerifyStep3}
              >
                {verifiedStep3 ? `✔ ${t('migration.importVerified')}` : t('migration.verifyImport')}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Verify default user & boot */}
        {step === 4 && (
          <div className="wizard-step-panel">
            <h3>{t('migration.step4Title')}</h3>
            <p className="dim">{t('migration.step4Desc')}</p>
            <div className="notice-warn" style={{ marginTop: 12 }}>
              {t('migration.userHint')}
            </div>
            <div className="path-row" style={{ marginTop: 12 }}>
              <div className="row-main">
                <div className="path-line">
                  <span className="path-label">{t('migration.bootTest')}</span>
                </div>
                <pre className="mono dim code-block">wsl -d {selected}-new</pre>
              </div>
              <span className="row-actions">
                <CopyButton text={`wsl -d ${selected}-new`} size={14} />
              </span>
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className={`btn ${verifiedStep4 ? 'btn-ok' : 'btn-primary'}`}
                onClick={handleVerifyStep4}
              >
                {verifiedStep4 ? `✔ ${t('migration.bootVerified')}` : t('migration.bootTest')}
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Cleanup & Finish */}
        {step === 5 && (
          <div className="wizard-step-panel">
            <h3>{t('migration.step5Title')}</h3>
            <p className="dim">{t('migration.step5Desc')}</p>
            <div className="notice-ok" style={{ marginTop: 12 }}>
              {t('migration.completed')}
            </div>
            <div className="path-row" style={{ marginTop: 12 }}>
              <div className="row-main">
                <div className="path-line">
                  <span className="path-label">{t('migration.cleanupHint')}</span>
                </div>
                <pre className="mono dim code-block">Remove-Item "{backupPath}"</pre>
              </div>
              <span className="row-actions">
                <CopyButton text={`Remove-Item "${backupPath}"`} size={14} />
              </span>
            </div>
          </div>
        )}

        {/* Wizard Bottom Controls with Strict Gate Messages */}
        <div className="wizard-footer" style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          {step > 1 && (
            <button type="button" className="btn" onClick={() => setStep(step - 1)}>
              {t('migration.prev')}
            </button>
          )}
          {step < 5 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canGoNextFromCurrent}
              onClick={() => {
                if (canGoNextFromCurrent) setStep(step + 1)
              }}
            >
              {t('migration.next')}
            </button>
          )}
          {!canGoNextFromCurrent && (
            <span className="dim" style={{ fontSize: 12 }}>
              {t('migration.stepRequiredHint')}
            </span>
          )}
        </div>
      </Card>
    </div>
  )
}
