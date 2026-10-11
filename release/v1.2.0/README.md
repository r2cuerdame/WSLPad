# v1.2.0 private candidate evidence

Draft release [405268106](https://github.com/r2cuerdame/WSLPad/releases/tag/untagged-e7ae35aa2178c70e891e) holds the original v1.2.0 candidate built from `c06b065d5bd4127fdce32b115677494761782a64`. [manifest.json](manifest.json) records the three asset IDs, filenames, sizes, SHA256 values, installer SHA512 from `latest.yml`, and unsigned signing status. The previous public v1.1.2 installer was also `NotSigned`; `electron-builder.yml` has no Windows signing or certificate configuration. The previous publication method is unknown. The candidate asset bytes have not been replaced. Authenticated release-ID GET on 2026-10-11 returned `draft: true`, matching asset IDs and digests; public `releases/latest` remained v1.1.2. Repository permissions GET returned `admin: true`, `push: true`.

## Isolation discovery and lifecycle

The required local 1.1.2 → original 1.2.0 install, upgrade, uninstall/reinstall, and final cleanup have **not run**. Read-only checks on 2026-10-11 found no proven isolated Windows execution path for the Worker and independent QA:

| Existing route | Command result | Missing proof |
| --- | --- | --- |
| VMware Windows VMs | `vmrun -T ws list` → `Total running VMs: 0` (exit 0). Earlier per-VM `checkToolsState` returned `unknown` (exit -2) and `getGuestIPAddress` said the VM was not powered on (exit -1). The three VMX files are `DevHotel-Base`, `DevHotel-v060-Acceptance`, and `DH-Smoke`; two have historical boot failures. | Running guest, guest command access for both actors, runtime isolation |
| Windows Sandbox | `Test-Path C:\Windows\System32\WindowsSandbox.exe` → `False` | Usable Sandbox and QA access |
| Hyper-V | `Get-VM` → insufficient permission under the host authorization policy (exit 1) | Accessible guest and QA access |
| Existing test accounts | Both CodexSandbox accounts are enabled; no CodexSandbox-principal scheduled task; `quser` shows only `recue console 1 Active`. | An isolated execution session for either actor |
| DevHotel command | `Get-Command devhotel,dh` found neither command. | Guest command route |

`wsl --list --verbose` showed the user's `Ubuntu-24.04` and `docker-desktop` distributions running. The lifecycle script installs into the invoking account's LocalAppData, uses HKCU, and stops WSLPad processes. The active `recue` session is therefore ineligible. No VM, installer, user app data, or WSL distribution was changed. Historical [hosted run 37701562990](https://github.com/r2cuerdame/WSLPad/actions/runs/37701562990) reports successful lifecycle stages, but used a newly added GitHub-hosted runner, which Issue #107 prohibits as qualifying evidence.

## Repair gate and verification

The [Issue #107](https://github.com/r2cuerdame/WSLPad/issues/107) comment for receipt 605 records `gate_error` at the unchanged PR head. The GitHub work-state ledger recorded that receipt as `no_change/already_satisfied`; LoopOffice's pinned `repairExitAtHead` and `EXIT_ROWS.repair_no_change` rules produce that `gate_error` transition. It did not run a separate WSLPad gate command: **tests executed by that transition: 0**. The latest receipt 614 comment also says `gate_error` without test output. This is distinct from PR #108's two successful `Build, lint, and test` checks at `de2c40785bace71cc8974a00adc242c28304e902`. The prior `already_satisfied` outcome was inaccurate because lifecycle and independent QA remain unrun.

In this repair, local `npm test` exited 0 with 101 files and 1,649 tests passed (2 files and 11 tests skipped), and `npm run build` exited 0. These tests and CI do not exercise the installer lifecycle. Independent QA has not downloaded and verified the draft assets or repeated the lifecycle in an eligible environment, so no QA PASS is claimed. Completion requires Luna to identify an **existing** isolated Windows route with demonstrated Worker and independent QA access and separation from the user's WSL distributions, app data, and session. No extra hosted run, new account, new VM, candidate replacement, or publication is authorized by this Issue.
