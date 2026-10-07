param(
  [Parameter(Mandatory)][string]$Label,
  [Parameter(Mandatory)][string]$Commit,
  [Parameter(Mandatory)][string]$OutputDir,
  [Parameter(Mandatory)][string]$CompanionScript
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WindowPing {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wparam,
    IntPtr lparam, uint flags, uint timeoutMs, out IntPtr result);
}
'@

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$raw = [System.Collections.Generic.List[object]]::new()
$companion = Start-Process pwsh -ArgumentList @('-NoProfile', '-File', $CompanionScript) -PassThru
$app = $null
$priorAppCpu = 0.0
$priorAt = $null

function Get-CompanionLatency {
  param([IntPtr]$Window)
  $result = [IntPtr]::Zero
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $reply = [WindowPing]::SendMessageTimeout($Window, 0, [IntPtr]::Zero,
    [IntPtr]::Zero, 2, 2000, [ref]$result)
  $watch.Stop()
  if ($reply -eq [IntPtr]::Zero) { return [pscustomobject]@{ Ms = $watch.Elapsed.TotalMilliseconds; Ok = $false } }
  return [pscustomobject]@{ Ms = $watch.Elapsed.TotalMilliseconds; Ok = $true }
}

function Get-Sample {
  param([string]$Phase, [int]$Trial, [int]$Index, [IntPtr]$CompanionWindow)

  $at = [DateTimeOffset]::UtcNow
  $hostCpu = (Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1).CounterSamples[0].CookedValue
  $os = Get-CimInstance Win32_OperatingSystem
  $processes = @(Get-Process electron -ErrorAction SilentlyContinue)
  $appCpu = ($processes | Measure-Object -Property CPU -Sum).Sum
  if ($null -eq $appCpu) { $appCpu = 0 }
  $appRam = ($processes | Measure-Object -Property WorkingSet64 -Sum).Sum
  if ($null -eq $appRam) { $appRam = 0 }
  $wslProcess = Get-Process vmmemWSL -ErrorAction SilentlyContinue
  $wslRam = if ($wslProcess) { $wslProcess.WorkingSet64 } else { 0 }
  $companionPing = Get-CompanionLatency -Window $CompanionWindow
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  & wsl.exe --distribution Ubuntu-24.04 --exec /bin/true | Out-Null
  $wslExit = $LASTEXITCODE
  $watch.Stop()
  $appCpuRate = if ($priorAt -and $Phase -eq 'ON') {
    [math]::Max(0, ($appCpu - $priorAppCpu) / ($at - $priorAt).TotalSeconds * 100)
  } else { $null }
  $script:priorAppCpu = [double]$appCpu
  $script:priorAt = $at

  [pscustomobject]@{
    commit = $Commit
    build = $Label
    phase = $Phase
    trial = $Trial
    sample = $Index
    utc = $at.ToString('o')
    host_cpu_percent = [math]::Round($hostCpu, 3)
    host_available_ram_bytes = [int64]$os.FreePhysicalMemory * 1024
    host_total_ram_bytes = [int64]$os.TotalVisibleMemorySize * 1024
    app_process_count = $processes.Count
    app_cpu_percent_of_one_core = if ($null -ne $appCpuRate) { [math]::Round($appCpuRate, 3) } else { $null }
    app_working_set_bytes = [int64]$appRam
    wsl_vm_working_set_bytes = [int64]$wslRam
    wsl_latency_ms = [math]::Round($watch.Elapsed.TotalMilliseconds, 3)
    wsl_exit_code = $wslExit
    companion_latency_ms = [math]::Round($companionPing.Ms, 3)
    companion_ok = $companionPing.Ok
  }
}

try {
  for ($i = 0; $i -lt 30; $i++) {
    $companion.Refresh()
    if ($companion.HasExited) { throw 'Companion exited before measurement' }
    if ($companion.MainWindowHandle -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 500
  }
  $window = $companion.MainWindowHandle
  if ($window -eq [IntPtr]::Zero) { throw 'Companion window unavailable' }

  # Each ON trial is bracketed by OFF trials under the same runner load.
  for ($trial = 1; $trial -le 3; $trial++) {
    foreach ($phase in @('OFF_BEFORE', 'ON', 'OFF_AFTER')) {
      if ($phase -eq 'ON') {
        $dataDir = Join-Path $env:RUNNER_TEMP "wslpad-issue-115-$Label-$trial"
        New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
        $env:WSLPAD_FIXTURE_MODE = '0'
        $env:WSLPAD_USER_DATA = $dataDir
        $env:NODE_ENV = 'production'
        $app = Start-Process (Join-Path $PWD 'node_modules\electron\dist\electron.exe') -ArgumentList '.' -WorkingDirectory $PWD -PassThru
        Start-Sleep -Seconds 10
        $app.Refresh()
        if ($app.HasExited) { throw "Full app exited during warmup: $($app.ExitCode)" }
      } elseif ($phase -eq 'OFF_AFTER' -and $app) {
        & taskkill.exe /PID $app.Id /T /F | Out-Null
        $app = $null
        Start-Sleep -Seconds 5
      }
      $script:priorAt = $null
      $script:priorAppCpu = 0.0
      for ($index = 1; $index -le 8; $index++) {
        $raw.Add((Get-Sample -Phase $phase -Trial $trial -Index $index -CompanionWindow $window))
      }
    }
  }
} finally {
  if ($app) { & taskkill.exe /PID $app.Id /T /F | Out-Null }
  if ($companion -and !$companion.HasExited) { Stop-Process -Id $companion.Id -Force }
  if ($raw.Count -gt 0) {
    $raw | Export-Csv -Path (Join-Path $OutputDir "$Label-raw.csv") -NoTypeInformation
  }
}

if ($raw.Count -ne 72) { throw "Incomplete raw samples: $($raw.Count) of 72" }
if (@($raw | Where-Object { !$_.companion_ok -or $_.wsl_exit_code -ne 0 }).Count -gt 0) {
  throw 'Companion or live WSL probe failed; inspect raw CSV'
}
Write-Host "Recorded $($raw.Count) full-app raw samples for $Label at $Commit"
