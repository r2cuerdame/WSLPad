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

The existing VMware logs explain why two prior VM starts failed. `DevHotel-v060-Acceptance/vmware.log` at `2026-09-16T10:29:29.732Z` and `DH-Smoke/vmware.log` at `2026-09-16T10:30:15.846Z` both report `[msg.pci.noslotavail] No PCIe slot available for Ethernet0. Remove Ethernet0 and try again.`, followed by `E1000PCI: failed to register e1000e device`, an access violation, and `[msg.log.error.unrecoverable] VMware Workstation unrecoverable error: (vmx)`. This is a recorded failure of those two VM starts, not proof that either guest can now boot. Their current VMX files still enable `ethernet0`; no VM configuration was changed for this Issue. `DevHotel-Base` last logged a clean shutdown on 2026-08-22, but its current VMX references two missing ISO files, and no guest login or command route is known. These logs do not explain the separate LoopOffice `gate_error`.

| Actor | Existing route and access evidence | Result |
| --- | --- | --- |
| Worker | `RECUERDAME\recue`, session 1; VMware VMX files readable and `vmrun` metadata queries ran. Sandbox feature query requires elevation; `Get-VM` denies access. | No powered-on guest, guest IP, or guest command path; no safe lifecycle execution established. |
| Independent QA | Both enabled CodexSandbox accounts belong to `CodexSandboxUsers`; VMX ACL grants that group Modify. Neither account has an active `quser` session or scheduled task; no running VM exists. | Membership and file ACL do not prove an independent QA login or guest command path. Access and runtime separation remain unknown. |

## Repair gate readback

The Issue #107 comment at 2026-10-09T21:16:19Z records the prior repair receipt for head `fa5180f22439f9194f0737f75100ae89d98d31a4` as `gate_error`. It provides no gate log, command, or failure reason. The cause and original gate result therefore remain unknown; `gate_error` is not a QA verdict. GitHub CI at that same head reports `cancelled` for both [push run 37987890511](https://github.com/r2cuerdame/WSLPad/actions/runs/37987890511) and [PR run 37987897744](https://github.com/r2cuerdame/WSLPad/actions/runs/37987897744); unit tests were cancelled and build/E2E steps skipped in both. These check results do not explain the LoopOffice repair gate error.

The original PR CI log is available through `gh run view 37987897744 --repo r2cuerdame/WSLPad --log`. It shows `2026-10-09T20:35:44.2862653Z ##[group]Run npm run test`, then `2026-10-09T20:35:46.2193125Z ##[error]The operation was canceled.` The GitHub job record marks `Run unit and integration tests` cancelled and `Build application` and `Run fixture-mode E2E tests` skipped. This identifies the CI command and cancellation point only; the Issue comment is the sole available record of the separate LoopOffice `gate_error`, and neither the Issue, PR comments, nor this workspace contains that gate's original command or log.

The read-only isolation probes were repeated on 2026-10-10: Sandbox executable `False`, `Get-VM` insufficient permission, and `quser` only the active `recue` console session. The two CodexSandbox accounts remain enabled and both belong to `CodexSandboxUsers`, which has inherited Modify access to the VMX files. File access alone does not establish guest access: all three existing VMware VMs are powered off, with no guest IP or VMware Tools state. The Worker is `RECUERDAME\recue` in session 1; no independent QA guest execution route was demonstrated. VMX NAT and the absence of shared-folder entries suggest disk separation, but runtime separation from the user's WSL distributions, app data, and session remains unverified. No VM was started, no snapshot was reverted, and no lifecycle or independent QA gate was rerun. The gate owner must provide the original gate log and an eligible, shared isolation route before the same gate can be rerun.

At this repair's readback, `vmrun -T ws list` still returned `Total running VMs: 0` (exit 0). For all three VMX files, `checkToolsState` returned `unknown` (exit -2) and `getGuestIPAddress` returned `Error: The virtual machine is not powered on` (exit -1). The two failed guests still have `ethernet0.present = "TRUE"` and `ethernet0.pciSlotNumber = "21"`; the Base VM still references the missing `win11ltsc.iso` and `autounattend.iso` files. The two failed guests also retain `.lck` entries. Those facts make a boot repair or another proven isolated guest route a prerequisite to the lifecycle check; they do not establish that editing the VMX or removing locks would safely repair it. No VM or lock was altered.

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

## Current repair readback (2026-10-10 21:17 KST)

The authenticated GitHub `GET /repos/r2cuerdame/WSLPad/releases/405268106` still returned `draft: true` and the original asset IDs `617142776`, `617142775`, and `617142779`, with the sizes and SHA256 digests in `manifest.json`. The release and candidate were not changed.

The existing local execution routes were checked again without starting a VM or installer:

```text
vmrun -T ws list: Total running VMs: 0 (exit 0)
WindowsSandbox.exe exists: False
Get-VM: 이 작업을 완료하는 데 필요한 권한이 없습니다. 'RECUERDAME' 컴퓨터의 권한 부여 정책 관리자에게 문의하십시오.
quser: recue, console session 1, Active (no test-account session)
Get-ScheduledTask: zero tasks with a CodexSandbox principal
DevHotel-Base.vmx: checkToolsState unknown (exit -2); getGuestIPAddress "The virtual machine is not powered on" (exit -1)
DevHotel-v060-Acceptance.vmx: checkToolsState unknown (exit -2); getGuestIPAddress "The virtual machine is not powered on" (exit -1)
DH-Smoke.vmx: checkToolsState unknown (exit -2); getGuestIPAddress "The virtual machine is not powered on" (exit -1)
```

Both existing CodexSandbox accounts are enabled, and `CodexSandboxOffline` has a recent `LastLogon`, but its profile is currently `Loaded=False`; this does not establish an active isolated execution route. Worker and independent QA still lack proven guest command access and runtime separation from the active user session and WSL distributions. The required local lifecycle and independent QA remain unrun. An eligible existing route, with access and separation demonstrated for both actors, is needed before the original candidate can be tested.
