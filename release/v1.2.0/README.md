# v1.2.0 private candidate evidence

The original candidate was built from `c06b065d5bd4127fdce32b115677494761782a64` and remains in private [draft release 405268106](https://github.com/r2cuerdame/WSLPad/releases/tag/untagged-e7ae35aa2178c70e891e). [manifest.json](manifest.json) records the installer, blockmap and `latest.yml` asset IDs, sizes and SHA256 values, plus the installer's SHA512. The previous and candidate installers have Authenticode status `NotSigned`; `electron-builder.yml` has no signing or certificate configuration. The previous publication method is unknown.

On 2026-10-11, authenticated release GET returned `draft: true` with the same three asset IDs, sizes and digests. Local copies of all three assets matched the manifest's sizes and SHA256 values; the installer's computed SHA512 matched `latest.yml` and the manifest. Public `releases/latest` remained `v1.1.2`. No candidate asset was replaced or published.

## Lifecycle status

The required local `1.1.2 → original 1.2.0` install, upgrade, uninstall/reinstall and final cleanup remain **unrun (0/4 stages)**. Read-only isolation checks found no proven Windows execution route usable by both Worker and independent QA:

| Existing route | Observed result | Missing proof |
| --- | --- | --- |
| VMware DevHotel VMs | `vmrun -T ws list`: `Total running VMs: 0`; all three existing VMX guests were powered off. | Guest command access and runtime separation from the user's WSL, app data and session. |
| Windows Sandbox | `Test-Path C:\Windows\System32\WindowsSandbox.exe`: `False`. | An available Sandbox session. |
| Hyper-V | `Get-VM`: access denied by the host authorization policy. | Authorized guest inventory and execution access. |
| Existing test accounts | `CodexSandboxOffline` and `CodexSandboxOnline` are enabled; `quser` listed only the user's active console session; no scheduled task runs as either account. | A separate executable session for Worker and independent QA, and data isolation. |
| GitHub runners | Registered self-hosted runners: `0`. | An eligible existing local runner; an additional hosted run is prohibited for this Issue. |

`wsl --list --verbose` showed the user's `Ubuntu-24.04` and `docker-desktop` running. The lifecycle script writes to the invoking account's LocalAppData and HKCU and stops WSLPad processes, so it cannot run in that user session. The [historical hosted run 37701562990](https://github.com/r2cuerdame/WSLPad/actions/runs/37701562990) reported lifecycle success, but its newly added GitHub-hosted runner is not qualifying evidence under Issue #107. No VM, account, installer or user data was changed during this repair.

## Repair gate and tests

Fresh read-only repair discovery on 2026-10-11 confirmed the access blocker: `vmrun -T ws list` exited 0 with `Total running VMs: 0`; `Get-VM` returned `이 작업을 완료하는 데 필요한 권한이 없습니다` (insufficient permission); `Test-Path C:\Windows\System32\WindowsSandbox.exe` returned `False`; both `Get-WindowsOptionalFeature` queries required elevation. `Get-LocalUser` still showed the two existing `CodexSandbox` accounts enabled, but `Get-ScheduledTask` returned no task with either account as principal. `gh api repos/r2cuerdame/WSLPad/actions/runners` returned `total_count: 0`. The authenticated draft release GET returned `draft: true` and target commit `c06b065d5bd4127fdce32b115677494761782a64`; public `releases/latest` returned `v1.1.2`. These are read-only observations, not a lifecycle run or proof of guest access. Starting or repairing an existing VM would be a separate host operation; none was performed.

The GitHub LoopOffice work-state ledger records repair receipt 784 at PR head `fb24a33e3b4cd80a2fd9859ab5ff711b5c6c7b84`. Its exit at sequence 786 was `{"role":"repair","r":{"outcome":"no_change","reason":"already_satisfied","ref":null}}`; the next wait was classified `gate_error`. The [Issue comment](https://github.com/r2cuerdame/WSLPad/issues/107) repeats that classification. This is a LoopOffice repair-exit result, not a failed WSLPad test assertion. The ledger supplies no WSLPad gate command, process exit code, discovery count or execution count. **Gate test counts are unknown**, and zero test executions are identified in that record. `already_satisfied` was inaccurate because lifecycle and independent QA remain unrun.

Fresh local source checks on 2026-10-11: `npm test` exited 0 with **101 files and 1,649 tests passed**, 2 files and 11 tests skipped; `npm run build` exited 0. These source checks do not test installer lifecycle. Independent QA has not downloaded the draft assets or repeated the lifecycle in an eligible isolated environment; no QA PASS is claimed. Completion needs an existing isolated Windows route with demonstrated Worker and independent QA access and runtime separation, then the full lifecycle on the original candidate and independent QA of its bytes and lifecycle. No additional hosted run, new account or VM, candidate replacement, or publication is authorized here.
