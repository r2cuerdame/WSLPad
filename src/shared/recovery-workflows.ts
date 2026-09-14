export type RecoveryOperation = 'backup' | 'restore' | 'clone' | 'relocation'
export type RecoveryVerification = 'unverified' | 'verified'

export interface RecoveryHistoryEntry {
  id: string
  operation: RecoveryOperation
  sourceDistro: string
  target: string
  newDistroName: string | null
  createdAt: string
  format: 'tar'
  sizeBytes: number | null
  wslVersion: 1 | 2 | null
  verification: RecoveryVerification
}

export type RecoveryHeadroomStatus = 'unknown' | 'critical' | 'warning' | 'ok'
export interface RecoveryHeadroom {
  status: RecoveryHeadroomStatus
  freeBytes: number | null
  requiredBytes: number | null
  recommendedBytes: number | null
}

const DISTRO = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/
const INVALID_PATH_TAIL = /[<>:"|?*\r\n]/

export function distroNameError(name: string): string | null {
  const value = name.trim()
  if (!value) return 'Distribution name is required.'
  if (!DISTRO.test(value)) return 'Use 1-64 letters, numbers, spaces, dot, underscore, or hyphen.'
  return null
}

export function windowsPathError(path: string, requireTar = false): string | null {
  const value = path.trim()
  if (!/^[A-Za-z]:\\/.test(value)) return 'Use an absolute Windows drive path such as D:\\WSL\\Backup.tar.'
  if (INVALID_PATH_TAIL.test(value.slice(3)) || value.includes('..\\')) return 'Path contains unsupported or unsafe characters.'
  if (requireTar && !value.toLowerCase().endsWith('.tar')) return 'Backup path must end in .tar.'
  return null
}

export function hasDistroCollision(name: string, existingNames: readonly string[]): boolean {
  const target = name.trim().toLocaleLowerCase()
  return existingNames.some((existing) => existing.trim().toLocaleLowerCase() === target)
}

function checkedName(name: string): string {
  const error = distroNameError(name)
  if (error) throw new Error(error)
  return name.trim()
}

function checkedPath(path: string, requireTar = false): string {
  const error = windowsPathError(path, requireTar)
  if (error) throw new Error(error)
  return path.trim().replace(/\\+$/, requireTar ? '' : '')
}

function quote(value: string): string {
  return `"${value}"`
}

export function buildBackupCommand(distro: string, tarPath: string): string {
  return `wsl.exe --export ${quote(checkedName(distro))} ${quote(checkedPath(tarPath, true))}`
}

export function buildBackupVerificationCommand(tarPath: string): string {
  const path = checkedPath(tarPath, true)
  return `Get-Item -LiteralPath ${quote(path)} | Select-Object FullName,Length`
}

export function buildImportCommand(
  newName: string,
  installDir: string,
  tarPath: string,
  existingNames: readonly string[]
): string {
  const name = checkedName(newName)
  if (hasDistroCollision(name, existingNames)) throw new Error('A distribution with that name already exists.')
  return `wsl.exe --import ${quote(name)} ${quote(checkedPath(installDir))} ${quote(checkedPath(tarPath, true))} --version 2`
}

export function buildVerificationCommands(newName: string): string[] {
  const name = checkedName(newName)
  return [
    `wsl.exe -d ${quote(name)} -- uname -a`,
    `wsl.exe -d ${quote(name)} -- sh -lc "id -un && test -d /etc && printf verified"`
  ]
}

export function buildCloneCommands(
  sourceDistro: string,
  newName: string,
  installDir: string,
  tarPath: string,
  existingNames: readonly string[]
): { exportCommand: string; importCommand: string; verificationCommands: string[] } {
  return {
    exportCommand: buildBackupCommand(sourceDistro, tarPath),
    importCommand: buildImportCommand(newName, installDir, tarPath, existingNames),
    verificationCommands: buildVerificationCommands(newName)
  }
}

export function recoveryHeadroom(imageBytes: number | null, freeBytes: number | null): RecoveryHeadroom {
  if (imageBytes === null || freeBytes === null) {
    return { status: 'unknown', freeBytes, requiredBytes: imageBytes, recommendedBytes: imageBytes === null ? null : Math.ceil(imageBytes * 1.5) }
  }
  const recommendedBytes = Math.ceil(imageBytes * 1.5)
  const status: RecoveryHeadroomStatus = freeBytes < imageBytes ? 'critical' : freeBytes < recommendedBytes ? 'warning' : 'ok'
  return { status, freeBytes, requiredBytes: imageBytes, recommendedBytes }
}