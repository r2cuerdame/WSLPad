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

## Repair gate readback

The Issue #107 comment at 2026-10-09T21:16:19Z records the prior repair receipt for head `fa5180f22439f9194f0737f75100ae89d98d31a4` as `gate_error`. It provides no gate log, command, or failure reason. The cause and original gate result therefore remain unknown; `gate_error` is not a QA verdict. GitHub CI at that same head reports `cancelled` for both [push run 37987890511](https://github.com/r2cuerdame/WSLPad/actions/runs/37987890511) and [PR run 37987897744](https://github.com/r2cuerdame/WSLPad/actions/runs/37987897744); unit tests were cancelled and build/E2E steps skipped in both. These check results do not explain the LoopOffice repair gate error.

The read-only isolation probes were repeated on 2026-10-10: Sandbox executable `False`, `Get-VM` insufficient permission, and `quser` only the active `recue` console session. The two CodexSandbox accounts remain enabled, but their existence alone does not establish an isolated lifecycle execution route. No lifecycle or independent QA gate was rerun, because the Issue requires a proven existing isolated environment first. A gate owner must provide the original gate log and an eligible isolation route before the same gate can be rerun.

Key command output (the Windows permission errors are quoted as returned by PowerShell):

```text
WindowsSandbox.exe exists: False
Get-WindowsOptionalFeature: 요청한 작업을 수행하려면 권한 상승이 필요합니다.
Get-VM: 이 작업을 완료하는 데 필요한 권한이 없습니다. 'RECUERDAME' 컴퓨터의 권한 부여 정책 관리자에게 문의하십시오.
CodexSandbox scheduled task count: 0
>recue  console  1  Active
```
