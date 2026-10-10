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

## Current repair readback (2026-10-10 22:26 KST)

The read-only probes still show no qualifying route. `Test-Path C:\Windows\System32\WindowsSandbox.exe` returned `False`; the Sandbox feature query returned `요청한 작업을 수행하려면 권한 상승이 필요합니다.` (`requested operation requires elevation`). `Get-VM` returned `이 작업을 완료하는 데 필요한 권한이 없습니다. 'RECUERDAME' 컴퓨터의 권한 부여 정책 관리자에게 문의하십시오.` (`insufficient permission`). `vmrun -T ws list` returned `Total running VMs: 0` (exit 0). No VM was started or changed.

`Get-LocalUser` returned `Enabled=True` for `CodexSandboxOffline` and `CodexSandboxOnline`; the Offline account's `LastLogon` was 2026-10-10 21:23:05 KST, but its profile was `Loaded=False` when checked. `quser` showed only `recue` in console session 1, and `Get-ScheduledTask` found zero tasks with a CodexSandbox principal. The recent logon timestamp does not show an active test-account session or an execution path available to either Worker or independent QA. `wsl --list --verbose` showed the user's `Ubuntu-24.04` and `docker-desktop` distributions running. The required runtime separation from those distributions, app data, and the user session remains unverified, so the installer lifecycle was not run. The original draft candidate and its assets were left untouched.

## Repair readback (2026-10-10 23:19 KST)

Issue comments at 13:32, 13:36, and 14:15 UTC again label repair receipts on head `7d636ee54e48846761c8302d5ccababc65993a8f` as `gate_error`. They provide no gate command, exit status, or output. The original failure condition and cause remain unknown; these comments are not a QA verdict. PR #108's two CI checks at that head both completed successfully. The current GitHub release GET still reports `draft: true` for release `405268106` and the same three asset IDs and digests as `manifest.json`.

The local discovery still returned `Total running VMs: 0` from `vmrun -T ws list`, no `WindowsSandbox.exe`, an elevation error from `Get-WindowsOptionalFeature`, an insufficient-permission error from `Get-VM`, and only the `recue` console session from `quser`. No existing isolated guest execution route was established, so the 1.1.2 → original candidate 1.2.0 lifecycle cannot be safely run here. No VM or installer was started.

The Windows-native, default non-live-WSL checks were rerun in this workspace: `npm test` passed with 101 files and 1,649 tests passed, 11 tests skipped; `npm run build` passed. These checks do not substitute for the required isolated installer lifecycle or independent QA. A first attempt with `npm test -- --runInBand` exited 1 because Vitest does not accept `--runInBand`; the supported `npm test` command then passed.

## Repair discovery (2026-10-10 23:24 KST)

An authenticated `GET /repos/r2cuerdame/WSLPad` returned `permissions: {admin:true, maintain:true, pull:true, push:true, triage:true}`. The existing `GET /releases/405268106` returned `draft:true` and the original asset IDs `617142776`, `617142775`, and `617142779`, with the manifest's sizes and SHA256 digests. A tag-name GET for `v1.2.0` returned HTTP 404 while the release is draft; the release-ID GET succeeded. No asset was changed or published.

The public v1.1.2 installer was downloaded from release `389464159` into the ignored local `release/` directory. Its SHA256 was `49cd0f4172fa117f41b701827571f455159cb15a6eaf06c2c6a004ed5b948f70`, matching GitHub's asset digest. `Get-AuthenticodeSignature` returned `NotSigned` with no signer certificate for it and for the original v1.2.0 candidate (local SHA256 `f3b0c5110bb80f141e4c416a6b932ad5f92182f48dcaae7efeb3e9967f943b88`). `electron-builder.yml` contains no `win.sign` or certificate configuration. The previous publish method remains unknown.

Fresh read-only isolation probes returned the same result:

```text
vmrun -T ws list: Total running VMs: 0 (exit 0)
Test-Path C:\Windows\System32\WindowsSandbox.exe: False (exit 0)
Get-VM: 이 작업을 완료하는 데 필요한 권한이 없습니다. 'RECUERDAME' 컴퓨터의 권한 부여 정책 관리자에게 문의하십시오. (exit 1)
quser: only recue, console session 1, Active
Get-ScheduledTask with a CodexSandbox principal: no rows
Get-LocalUser: CodexSandboxOffline and CodexSandboxOnline Enabled=True
Win32_UserProfile: CodexSandboxOffline Loaded=False; no CodexSandboxOnline profile row
wsl --list --verbose: Ubuntu-24.04 and docker-desktop Running
```

The current Issue comments still supply only the `gate_error` label for the prior repair receipts on `7d636ee54e48846761c8302d5ccababc65993a8f`; they do not include the original gate command, exit status, or output. The only identified command failure remains the separate GitHub CI cancellation documented above. There is no demonstrated isolated guest execution path for either Worker or independent QA, nor proof of runtime separation from the active user session, WSL distributions, and app data. The local 1.1.2 → original 1.2.0 lifecycle and independent QA remain unrun. A verified existing isolated execution route and the original LoopOffice gate log are required before this repair can proceed.

Local `npm test` passed again (101 files, 1,649 tests; 11 skipped), and `npm run build` passed. These checks do not establish installer lifecycle behavior.

## Review gate evidence (2026-10-11)

GitHub's PR #108 comment API returns one comment from `chatgpt-codex-connector[bot]`, created 2026-10-07T01:09:18Z: `You have reached your Codex usage limits for code reviews.` It says continuing Codex code reviews requires credits to be added and enabled. The PR reviews API returns no reviews, and `gh pr view 108 --json reviewRequests,reviews` returns empty arrays for both. This is a concrete code-review service limit, but the separate LoopOffice repair `gate_error` comments contain no command, output, or link that proves the limit caused those later errors. The original gate failure condition remains unknown; no credit or account setting was changed.

At this head, `gh pr checks 108` reports two successful `Build, lint, and test` checks. The draft release GET still reports `draft: true` for release `405268106` and the original three asset IDs and digests. The current local route checks again returned `Total running VMs: 0` from `vmrun -T ws list`, `sandbox=False`, an insufficient-permission error from `Get-VM`, only the `recue` console session from `quser`, and no CodexSandbox-principal scheduled task. After this documentation change, `npm test` passed (101 files, 1,649 tests; 11 skipped) and `npm run build` passed. Those checks do not cover installer lifecycle. Therefore the isolation precondition has not changed. Neither the local lifecycle nor independent QA can be called passing, and the unavailable LoopOffice gate cannot be rerun from an undisclosed command.

## Repair readback (2026-10-11)

The latest Issue comment again reports `gate_error` for repair receipt 482 at head `5849738f5afb3be88124800ed8c2b11de346e980`, without a gate command, exit status, log, or failure condition. The cause of that gate error remains unknown. PR #108's two GitHub `Build, lint, and test` checks at this head both passed, so those checks cannot explain the separate gate error. The PR's Codex review usage-limit comment is concrete evidence for that review service only; no available record connects it to the repair gate error.

Fresh authenticated `GET /releases/405268106` returned `draft: true` and unchanged asset IDs `617142779`, `617142776`, `617142775` with the manifest's sizes and SHA256 digests. `vmrun -T ws list` returned `Total running VMs: 0`; `Test-Path C:\Windows\System32\WindowsSandbox.exe` returned `False`; and `quser` showed only `recue` in the active console session. There is still no proven isolated lifecycle route. Local `npm test` passed (101 files, 1,649 tests; 11 skipped), and `npm run build` passed. These commands do not exercise the installer lifecycle. No VM or installer was started, no candidate asset was replaced, and the release remains private. The gate owner must supply the original gate output, and Luna must identify an existing eligible isolation route before the missing lifecycle and independent QA can run.

## Repair verification (2026-10-11 02:15 KST)

The latest Issue #107 comment labels receipt 490 on head `c8257bb088911557802c7fc22b66c6b0fb94202a` as `gate_error`, but supplies no gate command, exit status, or output. PR #108's two GitHub `Build, lint, and test` checks on that head are `pass`. The original LoopOffice gate output is required to diagnose its failure; this readback does not claim that gate passed.

Local `npm test` exited 0 and printed `Test Files 101 passed | 2 skipped (103)` and `Tests 1649 passed | 11 skipped (1660)`. Local `npm run build` exited 0 and printed successful main, preload, and renderer bundle builds. These commands do not exercise the installer lifecycle.

The authenticated release-ID GET returned `draft:true`, with the original asset IDs `617142779`, `617142776`, and `617142775` and unchanged sizes and SHA256 digests. `vmrun -T ws list` printed `Total running VMs: 0` (exit 0), `Test-Path C:\Windows\System32\WindowsSandbox.exe` printed `False` (exit 0), and `quser` showed only the active `recue` console session. Both CodexSandbox accounts are enabled, but neither has an active session. No isolated route or runtime separation was demonstrated, so lifecycle and independent QA remain unrun. No VM or installer was started, and no release asset was modified.

## Receipt 490 execution readback (2026-10-11)

GitHub's LoopOffice work-state ledger (`pipeline-57534c506164.json`) records repair receipt 490 on `c8257bb088911557802c7fc22b66c6b0fb94202a` with `exit.r.outcome=no_change`, `reason=already_satisfied`, followed by wait 492 with `cause=gate_error`. The RDCX job for that receipt was `3d833e2e-3b53-44d0-99cd-c24b9cdcd009`: `codex exec --json ... -` exited 0. Its final `agent_message`, however, was a typed `blocked` report requesting the missing gate record and an isolated Windows route. The local LoopOffice full event log likewise records `worker.exit_recorded` as `repair_no_change`. These are conflicting outcome records; none supplies the separate gate command, its exit status, or its output. The exact failure point remains unknown.

At receipt 490's execution time, the Worker transcript's `gh pr checks 108` exited 1 because one CI check was still pending and the other had passed. Both GitHub Actions CI runs for that head, [38068098952](https://github.com/r2cuerdame/WSLPad/actions/runs/38068098952) and [38068103017](https://github.com/r2cuerdame/WSLPad/actions/runs/38068103017), subsequently completed successfully. The transcript does not connect that transient `gh pr checks` exit to LoopOffice's `gate_error`, so it is not treated as its cause or as a rerun of the missing gate.

Fresh read-only probes still returned `vmrun -T ws list: Total running VMs: 0` (exit 0), `WindowsSandbox.exe: False` (exit 0), and `Get-VM: insufficient permission` (exit 1). For each existing VMware VM, `checkToolsState` returned `unknown` (exit -2) and `getGuestIPAddress` returned `The virtual machine is not powered on` (exit -1). `quser` showed only the active `recue` session; the user's `Ubuntu-24.04` and `docker-desktop` WSL distributions were running. Worker and independent QA guest command access and runtime separation from user data and session remain unproven. No lifecycle, guest start, candidate replacement, or release publication was performed. The draft release ID GET still reported the original three asset IDs and digests; public `releases/latest` remained v1.1.2.

## Repair gate classification (2026-10-11)

The repeated `gate_error` after a repair `no_change` has a specific ledger cause. The GitHub work-state document `.loopoffice/work/pipeline-57534c506164.json` on `r2cuerdame/LoopOffice:loopoffice-work-state` records receipt 521 on head `b8d87520d47ab6005a5a430fde0c2eb3e03afd3b` with `exit.r.outcome=no_change` and `reason=already_satisfied`; Issue comment 29 records the resulting wait 523 as `gate_error`. In LoopOffice's pinned [exit rules](https://github.com/r2cuerdame/LoopOffice/blob/e49b7274bd0baea322cb30d1894b29d841cc02b9/src/pipeline/core/exit.ts), `exitKindOf` maps a repair `no_change` to `repair_no_change`, and `EXIT_ROWS.repair_no_change` opens `gate_error`. Its [Luna options](https://github.com/r2cuerdame/LoopOffice/blob/e49b7274bd0baea322cb30d1894b29d841cc02b9/src/pipeline/core/luna.ts) explicitly handle a `gate_error` opened by a repair `no_change`. This path does not run or report a separate deterministic gate command. The repeated label is explained by the repair outcome classification, not by a demonstrated test failure. This finding supersedes the earlier requests above for an undisclosed gate command as the cause of these particular waits.

The `already_satisfied` outcome was inaccurate for Issue #107: the required isolated local lifecycle and independent QA are still unrun. Before and after this evidence correction, local `npm test` exited 0 with 101 files and 1,649 tests passed (2 files and 11 tests skipped). After the correction, `npm run build` exited 0. These commands do not exercise the installer lifecycle. Fresh route probes returned `Total running VMs: 0`, `WindowsSandbox.exe: False`, and only the active `recue` console session. The release GET still returned `draft:true` and the original three asset IDs, sizes, and digests. This correction changes evidence only; it does not provide an eligible isolated Windows route or claim lifecycle or QA PASS.

## Receipt 529 repair outcome and current blocker

The GitHub work-state ledger records receipt 529 on unchanged head `71914e50fa64ae86060d3111eaca3b798515f6bb` as `no_change/already_satisfied` (exit sequence 531); wait 531 has `cause=gate_error`. The pinned LoopOffice `repairExitAtHead` rule rewrites a repair exit to `no_change/already_satisfied` when the current PR head equals its dispatched head. `exitKindOf` then classifies it as `repair_no_change`, whose exit row opens `gate_error`. This is the recorded cause of this wait; there is no separate failed build or lifecycle command in that record. This evidence update makes a new PR head so the actual blocked outcome can be reported without that unchanged-head rewrite. It does not change LoopOffice code or claim a gate PASS.

Read-only recheck: `vmrun -T ws list` returned `Total running VMs: 0`; `Test-Path C:\Windows\System32\WindowsSandbox.exe` returned `False`; `Get-VM` returned an insufficient-permission error; `quser` showed only the active `recue` console session. The authenticated draft release GET still returned `draft:true`, release ID `405268106`, and the original three asset IDs, sizes, and SHA256 digests in `manifest.json`; public `releases/latest` remained `v1.1.2`. PR #108's two CI checks at the prior head passed. The required isolated 1.1.2 to original 1.2.0 lifecycle and independent QA still have no proven execution route and were not rerun. An eligible existing isolated Windows environment, with Worker and independent QA access and runtime separation from the user's WSL distributions, app data, and session, is required to finish this Issue.

## Receipt 544 isolation readback (2026-10-11)

The current repair rechecked the script and each existing route without running an installer. `release-lifecycle-smoke.ps1` installs and uninstalls under the invoking account's HKCU and LocalAppData, writes a marker under that account's AppData, and stops all `WSLPad` processes visible to it. Its `-RequireNoDistros` switch also inspects the invoking Windows environment's WSL registrations. Running it in the active `RECUERDAME\recue` console session would affect the user's session and app data; the user has `Ubuntu-24.04` and `docker-desktop` running.

| Existing route | Fresh read-only output | Worker and independent QA result |
| --- | --- | --- |
| Test accounts | `CodexSandboxOffline` and `CodexSandboxOnline`: `Enabled=True`; only the Offline profile exists and `Loaded=False`; `CodexSandboxTasks=0`; `quser`: only `recue` console session 1 Active | No demonstrated execution session for either actor. Account existence does not prove isolation or access. |
| Windows Sandbox | `WindowsSandbox.exe=False`; feature query: `요청한 작업을 수행하려면 권한 상승이 필요합니다.` | No usable Sandbox or demonstrated QA access. |
| Hyper-V | `Get-VM`: `이 작업을 완료하는 데 필요한 권한이 없습니다.` | No accessible guest or demonstrated QA access. |
| VMware | `vmrun -T ws list`: `Total running VMs: 0` (exit 0). `DevHotel-Base`, `DevHotel-v060-Acceptance`, and `DH-Smoke` each return `checkToolsState: unknown` (exit -2) and `getGuestIPAddress: The virtual machine is not powered on` (exit -1). All three VMX files say `guestOS = "windows11-64"` and `ethernet0.connectionType = "nat"`. | No guest command route for Worker or QA; VMX metadata does not prove runtime separation from the user's WSL distributions, data, or session. |

The authenticated release-ID GET still returned draft ID `405268106` and the original three asset IDs, sizes, and SHA256 digests recorded in `manifest.json`; public `releases/latest` still returned `v1.1.2`. The eligible existing isolation route required by Issue #107 is unproven, so the original candidate's install → upgrade → uninstall/reinstall → final cleanup and independent QA remain unrun. No VM was started, release asset replaced, or release published.
