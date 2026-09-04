[CmdletBinding()]
param(
  [string]$PreviousVersion = '1.0.0',
  [string]$TargetVersion = '1.0.1',
  [Parameter(Mandatory)]
  [ValidatePattern('^[0-9A-Fa-f]{64}$')]
  [string]$TargetSha256,
  [string]$Repository = 'r2cuerdame/WSLPad',
  [switch]$RequireNoDistros
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Get-WslPadUninstallEntry {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  return Get-ItemProperty -Path $roots -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'WSLPad*' } |
    Select-Object -First 1
}

function Get-SystemWslPadUninstallEntry {
  $roots = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  return Get-ItemProperty -Path $roots -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'WSLPad*' } |
    Select-Object -First 1
}

function Wait-Until {
  param(
    [scriptblock]$Condition,
    [string]$Description,
    [int]$TimeoutSeconds = 30
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for $Description"
}

function Stop-WslPad {
  Get-Process -Name WSLPad -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Wait-Until -Description 'WSLPad processes to exit' -Condition {
    $null -eq (Get-Process -Name WSLPad -ErrorAction SilentlyContinue)
  }
}

function Get-InstalledExecutable {
  $entry = Get-WslPadUninstallEntry
  $candidates = @()
  if ($entry -and $entry.InstallLocation) {
    $candidates += Join-Path ([string]$entry.InstallLocation) 'WSLPad.exe'
  }
  $candidates += Join-Path $env:LOCALAPPDATA 'Programs\wslpad\WSLPad.exe'
  $candidates += Join-Path $env:LOCALAPPDATA 'Programs\WSLPad\WSLPad.exe'
  return $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Download-Installer {
  param([string]$Version, [string]$Destination)
  $url = "https://github.com/$Repository/releases/download/v$Version/WSLPad-Setup-$Version.exe"
  Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing
  Assert-True ((Get-Item -LiteralPath $Destination).Length -gt 0) "Downloaded installer is empty: $url"
  return $url
}

function Install-WslPad {
  param([string]$Installer, [string]$ExpectedVersion)
  $process = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
  Assert-True ($process.ExitCode -eq 0) "Installer for $ExpectedVersion exited $($process.ExitCode)"
  Wait-Until -Description "WSLPad $ExpectedVersion registration" -Condition {
    $entry = Get-WslPadUninstallEntry
    $entry -and [string]$entry.DisplayVersion -eq $ExpectedVersion
  }
  Assert-True ($null -eq (Get-SystemWslPadUninstallEntry)) 'Installer registered under HKLM instead of per-user HKCU'

  $executable = Get-InstalledExecutable
  Assert-True ($null -ne $executable) "Could not find the installed WSLPad $ExpectedVersion executable"
  Assert-True ($executable.StartsWith($env:LOCALAPPDATA, [StringComparison]::OrdinalIgnoreCase)) `
    "Installer did not use a per-user LocalAppData path: $executable"
  $actualVersion = (Get-Item -LiteralPath $executable).VersionInfo.ProductVersion
  Assert-True ($actualVersion -eq $ExpectedVersion) `
    "Installed product version is $actualVersion, expected $ExpectedVersion"
  return $executable
}

function Assert-Shortcuts {
  param([bool]$Present)
  $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'WSLPad.lnk'
  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\WSLPad.lnk'
  Assert-True ((Test-Path -LiteralPath $desktop) -eq $Present) `
    "Desktop shortcut presence was not $Present at $desktop"
  Assert-True ((Test-Path -LiteralPath $startMenu) -eq $Present) `
    "Start menu shortcut presence was not $Present at $startMenu"
}

function Assert-Launch {
  param([string]$Executable, [string]$ExpectedVersion)
  Stop-WslPad
  $process = Start-Process -FilePath $Executable -PassThru
  Start-Sleep -Seconds 10
  $process.Refresh()
  Assert-True (-not $process.HasExited) "WSLPad $ExpectedVersion exited during first launch"
  Stop-WslPad
}

function Uninstall-WslPad {
  $executable = Get-InstalledExecutable
  Assert-True ($null -ne $executable) 'Cannot locate WSLPad before uninstall'
  $installDirectory = Split-Path -Parent $executable
  $uninstaller = Get-ChildItem -LiteralPath $installDirectory -Filter 'Uninstall*.exe' |
    Select-Object -First 1
  Assert-True ($null -ne $uninstaller) "Could not find an uninstaller in $installDirectory"
  Stop-WslPad
  $process = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
  Assert-True ($process.ExitCode -eq 0) "Uninstaller exited $($process.ExitCode)"
  Wait-Until -Description 'WSLPad uninstall registration removal' -Condition {
    $null -eq (Get-WslPadUninstallEntry)
  }
  Wait-Until -Description 'WSLPad executable removal' -Condition {
    -not (Test-Path -LiteralPath $executable)
  }
  Assert-Shortcuts -Present $false
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "wslpad-release-smoke-$([Guid]::NewGuid().ToString('N'))"
$previousInstaller = Join-Path $tempRoot "WSLPad-Setup-$PreviousVersion.exe"
$targetInstaller = Join-Path $tempRoot "WSLPad-Setup-$TargetVersion.exe"
$settingsDirectory = Join-Path $env:APPDATA 'wslpad'
$markerId = [Guid]::NewGuid().ToString('N')
$marker = Join-Path $settingsDirectory "release-lifecycle-smoke-$markerId.txt"
$markerValue = "preserve-$markerId"

try {
  Assert-True ($null -eq (Get-WslPadUninstallEntry)) 'Clean-machine precondition failed: WSLPad is already installed'
  Assert-True ($null -eq (Get-SystemWslPadUninstallEntry)) 'Clean-machine precondition failed: system WSLPad install exists'
  $distros = @(& wsl.exe --list --quiet 2>$null | Where-Object { $_.Trim().Length -gt 0 })
  if ($RequireNoDistros) {
    Assert-True ($distros.Count -eq 0) "Clean no-distro precondition failed: $($distros -join ', ')"
  }
  $launchContext = if ($distros.Count -eq 0) { 'without a WSL distribution' } else { "with $($distros.Count) WSL distribution(s)" }

  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  $previousUrl = Download-Installer -Version $PreviousVersion -Destination $previousInstaller
  $targetUrl = Download-Installer -Version $TargetVersion -Destination $targetInstaller
  $actualTargetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetInstaller).Hash
  Assert-True ($actualTargetHash -eq $TargetSha256.ToUpperInvariant()) `
    "Published target SHA-256 is $actualTargetHash, expected $TargetSha256"

  $previousExecutable = Install-WslPad -Installer $previousInstaller -ExpectedVersion $PreviousVersion
  Assert-Shortcuts -Present $true
  Assert-Launch -Executable $previousExecutable -ExpectedVersion $PreviousVersion

  New-Item -ItemType Directory -Path $settingsDirectory -Force | Out-Null
  Set-Content -LiteralPath $marker -Value $markerValue -NoNewline

  $targetExecutable = Install-WslPad -Installer $targetInstaller -ExpectedVersion $TargetVersion
  Assert-Shortcuts -Present $true
  Assert-True ((Get-Content -LiteralPath $marker -Raw) -eq $markerValue) 'Upgrade changed user data'
  Assert-Launch -Executable $targetExecutable -ExpectedVersion $TargetVersion

  Uninstall-WslPad
  Assert-True ((Get-Content -LiteralPath $marker -Raw) -eq $markerValue) 'Uninstall removed or changed user data'

  $reinstalledExecutable = Install-WslPad -Installer $targetInstaller -ExpectedVersion $TargetVersion
  Assert-Shortcuts -Present $true
  Assert-True ((Get-Content -LiteralPath $marker -Raw) -eq $markerValue) 'Reinstall did not preserve user data'
  Assert-Launch -Executable $reinstalledExecutable -ExpectedVersion $TargetVersion
  Uninstall-WslPad
  Assert-True ((Get-Content -LiteralPath $marker -Raw) -eq $markerValue) 'Final uninstall removed user data'

  $summary = @"
## WSLPad public release lifecycle smoke

- Registered WSL distributions: **$($distros.Count)**
- Public installers: [$PreviousVersion]($previousUrl) → [$TargetVersion]($targetUrl)
- Target SHA-256: `$actualTargetHash`
- Install scope/path: **HKCU / LocalAppData (no machine registration)**
- First launch ${launchContext}: **passed for $PreviousVersion and $TargetVersion**
- Upgrade $PreviousVersion → ${TargetVersion}: **passed**
- Desktop + Start menu shortcuts: **created and removed as expected**
- Uninstall/reinstall and user-data preservation: **passed**
- Final uninstall: **registry, executable and shortcuts removed; user data retained**
"@
  Write-Host $summary
  if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $summary }
} finally {
  Stop-WslPad
  if ((Test-Path -LiteralPath $marker) -and (Get-Content -LiteralPath $marker -Raw) -eq $markerValue) {
    Remove-Item -LiteralPath $marker -Force
  }
  if (Test-Path -LiteralPath $tempRoot) {
    $expectedTempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot)
    if ($resolvedTempRoot.StartsWith($expectedTempPrefix, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTempRoot).StartsWith('wslpad-release-smoke-')) {
      Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force
    }
  }
}
