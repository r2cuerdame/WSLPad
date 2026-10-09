# v1.2.0 private candidate evidence

Draft release `405268106` holds the original candidate built from `c06b065d5bd4127fdce32b115677494761782a64`. `manifest.json` records its asset IDs, sizes, hashes, and signing status. The release remains private.

The lifecycle acceptance check is blocked. Run [37701562990](https://github.com/r2cuerdame/WSLPad/actions/runs/37701562990) used a newly added GitHub-hosted workflow, so its reported stages do not meet Issue #107's isolation and runner constraints. No candidate asset was replaced.

Read-only local discovery on 2026-10-10 found no proven, accessible isolated Windows environment shared by Worker and independent QA:

| Route | Command result | Missing proof |
| --- | --- | --- |
| Windows Sandbox | `Test-Path C:\Windows\System32\WindowsSandbox.exe` → `False`; `Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM` → elevation required | Installed and usable Sandbox |
| Hyper-V VM | `Get-VM` → insufficient permission under `RECUERDAME` authorization policy; Hyper-V WMI → no `Virtual Machine` rows | An accessible Windows VM with separated user data and session |
| Existing test accounts | `Get-LocalUser` → both CodexSandbox accounts enabled; `Win32_UserProfile` → Offline profile `Loaded=False`, no Online profile row; `Get-ScheduledTask` → zero CodexSandbox-principal tasks; `quser` → only `recue` console session | A usable existing execution route for Worker and QA |

`wsl --list --verbose` reported `Ubuntu-24.04` and `docker-desktop` running. A `vmwp.exe` process and running `vmcompute`/`vmms` services do not prove that a separate Windows VM is available. No installer was run in the user's session. The install → upgrade → uninstall/reinstall → final-cleanup sequence and independent QA remain unmet until an existing isolated environment and access path are demonstrated.

Key command output (the Windows permission errors are quoted as returned by PowerShell):

```text
WindowsSandbox.exe exists: False
Get-WindowsOptionalFeature: 요청한 작업을 수행하려면 권한 상승이 필요합니다.
Get-VM: 이 작업을 완료하는 데 필요한 권한이 없습니다. 'RECUERDAME' 컴퓨터의 권한 부여 정책 관리자에게 문의하십시오.
CodexSandbox scheduled task count: 0
>recue  console  1  Active
```
