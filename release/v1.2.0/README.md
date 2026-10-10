# v1.2.0 private candidate evidence

Draft release `405268106` holds the original candidate built from `c06b065d5bd4127fdce32b115677494761782a64`. `manifest.json` records its asset IDs, sizes, hashes, and signing status. The release remains private.

The lifecycle acceptance check is blocked. Run [37701562990](https://github.com/r2cuerdame/WSLPad/actions/runs/37701562990) used a newly added GitHub-hosted workflow, so its reported stages do not meet Issue #107's isolation and runner constraints. No candidate asset was replaced.

Read-only local discovery on 2026-10-10 found no proven, accessible isolated Windows environment shared by Worker and independent QA:

| Route | Command result | Missing proof |
| --- | --- | --- |
| Windows Sandbox | `Test-Path C:\Windows\System32\WindowsSandbox.exe` → `False`; `Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM` → elevation required | Installed and usable Sandbox |
| Hyper-V VM | `Get-VM` → insufficient permission under `RECUERDAME` authorization policy; Hyper-V WMI → no `Virtual Machine` rows | An accessible Hyper-V Windows VM with separated user data and session |
| VMware VM | `vmrun list` → `Total running VMs: 0` (exit 0). Existing VMX files: `DevHotel-Base`, `DevHotel-v060-Acceptance`, `DH-Smoke` (`guestOS = "windows11-64"`, NAT, no shared-folder entry). For each VM, `vmrun checkToolsState` → `unknown` (exit -2), and `vmrun getGuestIPAddress` → `Error: The virtual machine is not powered on` (exit -1). Base VM references two missing ISO files. | A running guest, guest command access, and runtime isolation for Worker and independent QA |
| Existing test accounts | `Get-LocalUser` → both CodexSandbox accounts enabled; `Win32_UserProfile` → Offline profile `Loaded=False`, no Online profile row; `Get-ScheduledTask` → zero CodexSandbox-principal tasks; `quser` → only `recue` console session | A usable existing execution route for Worker and QA |

`wsl --list --verbose` reported `Ubuntu-24.04` and `docker-desktop` running. A `vmwp.exe` process and running `vmcompute`/`vmms` services do not prove that a separate Windows VM is available. No installer was run in the user's session. The install → upgrade → uninstall/reinstall → final-cleanup sequence and independent QA remain unmet until an existing isolated environment and access path are demonstrated.

| Actor | Existing route and access evidence | Result |
| --- | --- | --- |
| Worker | `RECUERDAME\recue`, session 1; VMware VMX files readable and `vmrun` metadata queries ran. Sandbox feature query requires elevation; `Get-VM` denies access. | No powered-on guest, guest IP, or guest command path; no safe lifecycle execution established. |
| Independent QA | Both enabled CodexSandbox accounts belong to `CodexSandboxUsers`; VMX ACL grants that group Modify. Neither account has an active `quser` session or scheduled task; no running VM exists. | Membership and file ACL do not prove an independent QA login or guest command path. Access and runtime separation remain unknown. |

## Repair gate readback

The Issue #107 comment at 2026-10-09T21:16:19Z records the prior repair receipt for head `fa5180f22439f9194f0737f75100ae89d98d31a4` as `gate_error`. It provides no gate log, command, or failure reason. The cause and original gate result therefore remain unknown; `gate_error` is not a QA verdict. GitHub CI at that same head reports `cancelled` for both [push run 37987890511](https://github.com/r2cuerdame/WSLPad/actions/runs/37987890511) and [PR run 37987897744](https://github.com/r2cuerdame/WSLPad/actions/runs/37987897744); unit tests were cancelled and build/E2E steps skipped in both. These check results do not explain the LoopOffice repair gate error.

The read-only isolation probes were repeated on 2026-10-10: Sandbox executable `False`, `Get-VM` insufficient permission, and `quser` only the active `recue` console session. The two CodexSandbox accounts remain enabled and both belong to `CodexSandboxUsers`, which has inherited Modify access to the VMX files. File access alone does not establish guest access: all three existing VMware VMs are powered off, with no guest IP or VMware Tools state. The Worker is `RECUERDAME\recue` in session 1; no independent QA guest execution route was demonstrated. VMX NAT and the absence of shared-folder entries suggest disk separation, but runtime separation from the user's WSL distributions, app data, and session remains unverified. No VM was started, no snapshot was reverted, and no lifecycle or independent QA gate was rerun. The gate owner must provide the original gate log and an eligible, shared isolation route before the same gate can be rerun.

Key command output (the Windows permission errors are quoted as returned by PowerShell):

```text
WindowsSandbox.exe exists: False
Get-WindowsOptionalFeature: 요청한 작업을 수행하려면 권한 상승이 필요합니다.
Get-VM: 이 작업을 완료하는 데 필요한 권한이 없습니다. 'RECUERDAME' 컴퓨터의 권한 부여 정책 관리자에게 문의하십시오.
CodexSandbox scheduled task count: 0
>recue  console  1  Active
vmrun list: Total running VMs: 0 (exit 0)
vmrun checkToolsState: unknown (exit -2, for each existing VM)
vmrun getGuestIPAddress: Error: The virtual machine is not powered on (exit -1, for each existing VM)
```

The read-only VMware probes used `C:\Program Files\VMware\VMware Workstation\vmrun.exe -T ws` with each existing VMX path under `C:\Users\recue\Documents\Virtual Machines`:

```text
DevHotel-Base.vmx: checkToolsState -> unknown (exit -2); getGuestIPAddress -> Error: The virtual machine is not powered on (exit -1)
DevHotel-v060-Acceptance.vmx: checkToolsState -> unknown (exit -2); getGuestIPAddress -> Error: The virtual machine is not powered on (exit -1)
DH-Smoke.vmx: checkToolsState -> unknown (exit -2); getGuestIPAddress -> Error: The virtual machine is not powered on (exit -1)
```
