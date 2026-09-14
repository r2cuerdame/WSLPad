import { describe, expect, it } from 'vitest'
import {
  buildBackupCommand,
  buildBackupVerificationCommand,
  buildCloneCommands,
  buildImportCommand,
  buildVerificationCommands,
  distroNameError,
  hasDistroCollision,
  recoveryHeadroom,
  windowsPathError
} from '@shared/recovery-workflows'

describe('recovery workflow safety helpers (issue #91)', () => {
  it('accepts conservative distro names and rejects shell metacharacters', () => {
    expect(distroNameError('Ubuntu-24.04')).toBeNull()
    expect(distroNameError('Dev Copy_2')).toBeNull()
    expect(distroNameError('Ubuntu"; Remove-Item C:\\*')).not.toBeNull()
    expect(distroNameError('')).not.toBeNull()
  })

  it('requires absolute safe Windows paths and tar backup extensions', () => {
    expect(windowsPathError('D:\\WSL\\Backups\\Ubuntu.tar', true)).toBeNull()
    expect(windowsPathError('relative\\Ubuntu.tar', true)).not.toBeNull()
    expect(windowsPathError('D:\\WSL\\bad|name.tar', true)).not.toBeNull()
    expect(windowsPathError('D:\\WSL\\Ubuntu.zip', true)).not.toBeNull()
  })

  it('quotes export arguments and never adds destructive cleanup', () => {
    const command = buildBackupCommand('Ubuntu 24.04', 'D:\\WSL Backups\\Ubuntu.tar')
    expect(command).toBe('wsl.exe --export "Ubuntu 24.04" "D:\\WSL Backups\\Ubuntu.tar"')
    expect(command.toLowerCase()).not.toContain('unregister')
    expect(command.toLowerCase()).not.toContain('remove-item')
  })

  it('offers a read-only PowerShell backup verification command', () => {
    const command = buildBackupVerificationCommand('D:\\WSL Backups\\Ubuntu.tar')
    expect(command).toBe('Get-Item -LiteralPath "D:\\WSL Backups\\Ubuntu.tar" | Select-Object FullName,Length')
    expect(command).not.toContain('Remove-Item')
  })

  it('rejects restore collisions case-insensitively', () => {
    expect(hasDistroCollision('ubuntu', ['Ubuntu', 'Debian'])).toBe(true)
    expect(() => buildImportCommand('ubuntu', 'D:\\WSL\\ubuntu', 'D:\\Backups\\u.tar', ['Ubuntu'])).toThrow(/already exists/i)
  })

  it('builds restore imports only under a new name and location', () => {
    const command = buildImportCommand('Ubuntu-restored', 'D:\\WSL\\Ubuntu-restored', 'D:\\Backups\\Ubuntu.tar', ['Ubuntu'])
    expect(command).toBe('wsl.exe --import "Ubuntu-restored" "D:\\WSL\\Ubuntu-restored" "D:\\Backups\\Ubuntu.tar" --version 2')
    expect(command.toLowerCase()).not.toContain('unregister')
  })

  it('builds clone as review-only export plus new-name import and verification', () => {
    const result = buildCloneCommands('Ubuntu', 'Ubuntu-clone', 'D:\\WSL\\Ubuntu-clone', 'D:\\Backups\\Ubuntu-clone.tar', ['Ubuntu'])
    expect(result.exportCommand).toContain('--export "Ubuntu"')
    expect(result.importCommand).toContain('--import "Ubuntu-clone"')
    expect(result.verificationCommands).toHaveLength(2)
    expect(result.verificationCommands.join('\n')).toContain('id -un')
    expect(result.verificationCommands.join('\n').toLowerCase()).not.toContain('unregister')
  })

  it('builds bounded verification commands for the validated new distro', () => {
    const commands = buildVerificationCommands('Ubuntu-restored')
    expect(commands[0]).toBe('wsl.exe -d "Ubuntu-restored" -- uname -a')
    expect(commands[1]).toContain('test -d /etc')
  })

  it('reports unknown headroom when either input is missing', () => {
    expect(recoveryHeadroom(null, 100).status).toBe('unknown')
    expect(recoveryHeadroom(100, null).status).toBe('unknown')
  })

  it('distinguishes critical, warning, and sufficient headroom', () => {
    expect(recoveryHeadroom(100, 99).status).toBe('critical')
    expect(recoveryHeadroom(100, 120).status).toBe('warning')
    expect(recoveryHeadroom(100, 150).status).toBe('ok')
    expect(recoveryHeadroom(100, 150).recommendedBytes).toBe(150)
  })
})