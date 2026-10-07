# Issue #115: full-app slowdown preflight and resource decision

Observed 2026-10-07 UTC on branch `issue/115` at base `ceb22fa352989ade57ae1639e01d7e7eda8a7359`. This is a blocked measurement receipt, not a diagnosis or a QA result. The delivered Luna harness v17 was checked against the GitHub `r2cuerdame/LoopOffice` `skills/luna/SKILL.md` blob `8a8bb477c29eae2a20a37337d805c5aaf4d853fd`; its SHA-256 is `65772ce5a2078d776af050ee3ebe5a6a968cb2e9ef44d18da91fc9f6854ba597`.

## #113 preflight disposition

Draft PR #113 (`issue/111`, head `64304f64c1ee4bd7f786edbd40533cad2f1de3da`) adds only `docs/reports/2026-10-07-issue-111-preflight.md`. It records a useful resource inventory and measurement outline. It has no full-app raw sample, A/B pair, production fix or regression assertion. Its CI success checks documentation and the old head; it cannot establish the user symptom at #115. Since #112 merged in PR #114, its statements that the live-test guard is still open are stale. This report reuses the inventory as historical evidence, not its code or conclusion. Recommend Chief close #113 as superseded after preserving the historical receipt; the #115 Worker does not alter another Issue's PR. Its `Closes #111` body must not be transplanted to #115.

## Zero-cost HOME inventory and why each path is insufficient

| Candidate | Current observation | Missing condition |
| --- | --- | --- |
| Current Windows host (`RECUERDAME`) | 16 logical processors, 66,126,716,928 B physical RAM; `vmmemWSL`, `wsl.exe`, `wslhost.exe` processes were present. | Its WSL and desktop belong to the user. Full-app ON/OFF or companion-window input here would share resources and could perturb the user's session. File-isolated Issue and canonical checkouts do not isolate the host. |
| Existing local Hyper-V guest | Read-only `Get-VM` returned a permission error. | Guest existence, access, isolation and UI control are unverified. No VM was started or modified. |
| RDCX machine inventory | #113's earlier inventory identified only the user's Windows host. No second device was allocated to WSLPad in current LoopOffice GitHub config (`devices: []`, `testEnvironment: null`). | No verified independent Windows desktop and WSL2 guest. An unlisted device cannot be assumed available. |
| DevHotel Web/Android Rooms | Current DevHotel README supports agent-created Web and Android Rooms. | Neither provides the Windows desktop/WSL2 combination. No Room was created. |
| DevHotel Windows (VMware) Room | Current README calls it Preview; desktop setup is user-only, while guest exec/file ingress are planned and the agent API cannot create it. | Cannot run and instrument this A/B as a Worker. |
| GitHub-hosted Windows Actions runner | CI builds and tests the repo in fixture mode. | No persistent interactive Windows+WSL2 guest, companion-window input or independent host telemetry is allocated for this comparison. CI green is not full-app A/B. |
| WSLPad fixture/mock provider | In-memory WSL data and fake-timer polling tests can check behavior without live WSL. | No real Windows resource pressure, WSL latency or other-window response. Mock PASS cannot diagnose the reported slowdown. |
| Windows Sandbox or another guest on this physical host | No separate guest with worker access was identified; the Hyper-V inventory is permission denied. | Even a new local guest would share the user's physical CPU/RAM and need a host operation. It would not meet the requested isolation on present evidence. |

No known zero-cost HOME path currently satisfies an isolated, interactive Windows desktop with WSL2, guest file/command access and independent telemetry. An already approved independent guest could change this finding only after its identity, access and isolation are demonstrated.

## Measurement contract and causal hypotheses

On a dedicated guest, use immutable full-app builds for the pre-collector base `c06b065d5bd4127fdce32b115677494761782a64` and current `main` including #109/#112, recording exact SHAs. Use a test-only WSL2 distribution already running before samples; do not reach the user's distributions. For each build, interleave repeated OFF/ON/OFF trials with fixed warmup, duration, workload, desktop layout and sampling interval. Save every timestamped row, including failures, background load, full process trees and build/trial identifiers. Measure host CPU, WSLPad main/renderer/child CPU, host available/committed RAM and WSL VM memory, a resident WSL request/response probe, and independently driven companion-window response latency. Compare ON with neighboring OFF windows and compare base with current; publish raw rows and summaries. A Windows Server guest versus the user's Windows 11 remains an external-validity limit.

Hypotheses to test, not findings: repeated host-wide collectors or WSL guest polling; an Electron main/renderer CPU or memory leak; WSL process or disk contention; and load unrelated to WSLPad. Attribute only after the full-app samples and process-tree counters distinguish these paths. If a code fix follows, the same baseline must fail a symptom-relevant assertion and the fix must pass it before claiming the Regression TDD Gate.

| Required evidence | Raw samples here |
| --- | ---: |
| Full-app OFF/ON host and app CPU | 0 |
| Full-app OFF/ON host and WSL RAM | 0 |
| Full-app OFF/ON live WSL latency | 0 |
| Full-app OFF/ON other-window responsiveness | 0 |
| Independent Suah raw A/B rerun or comparison | 0 |

The reported severe slowdown, affected subsystem and cause remain unknown. #109's collector-only measurement, #112's test guard and #111's not-planned closure are not evidence of symptom resolution. No app, user WSL distribution, VM or Room was started, stopped or terminated for this report. No QA waiver is requested.

## Proposed $75 spending settlement; approval and execution zero

Contingent resource: a time-limited Microsoft Azure Windows Server 2022 Desktop Experience `Standard_D4s_v3` VM in East US with nested virtualization/WSL2, one 128 GiB Standard SSD E10 LRS OS disk, and one Standard static IPv4 only if guest access requires it. Microsoft's retail prices API on 2026-10-07 returned USD **0.376 per powered-on compute hour**, USD **9.60 per disk-month** plus disk operations, and USD **0.005 per public-IP hour**. At a 24-hour maximum powered-on window, compute is USD **9.024** and public IP at most USD **0.12**; disk, transactions, network egress and applicable taxes remain additional. The USD 75 figure is a proposed *total ceiling*, not an estimate that these residual meters are zero. Availability, Azure subscription and actual invoice prices must be checked before provisioning. Dsv3 is an older series with a published retirement path, and Windows Server results would need a Windows 11 external-validity caveat.

Period: provision only after explicit Source spending approval, conduct the experiment within one 24-hour wall-clock window, then export redacted raw data and delete the dedicated resource group, including VM, OS/data disks, snapshots, NIC and public IP. A budget alert is monitoring, not a hard cap: stop/deallocate the VM if cost nears the ceiling, verify deletion of billable resources and inspect Cost Management for delayed usage. Deallocation stops compute charges but leaves disks/IP billable; deletion of the VM alone can leave disks/network resources. Network egress, disk operations, taxes and delayed metering are residual charge risks until the invoice settles. The LoopOffice GitHub config explicitly says `pipeline.human.autonomousSpendCeilingUsd: 0` (not unknown). Proposed authorization is **one-time Microsoft Azure spending up to USD 75, no recurring resource**, contingent on an existing usable account; no account or credential expansion is authorized by this proposal.

No Azure resource was provisioned, no purchase or charge was initiated, and no user approval was solicited. The requested live A/B and its independent QA cannot be completed until Luna confirms a suitable existing isolated guest or Source approves the proposed spending and the guest is supplied. CI green, Hanbyeol review and Suah independent QA at the exact eventual PR head remain unmet.

## Local checkpoint verification

`npm ci --ignore-scripts` completed; `npm run build` passed. A selected no-live-WSL Vitest run passed `test/unit/state/polling.test.ts`, `test/unit/state/store.test.ts` and `test/unit/wsl/fixture.test.ts` (3 files, 69 tests). These are mock/fixture checks, not full-app symptom measurements. The default full suite and app E2E were not used as A/B evidence. No production deployment or production verification occurred.

Sources: [DevHotel current README](https://github.com/r2cuerdame/DevHotel#readme), [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [Azure nested virtualization](https://learn.microsoft.com/en-us/virtualization/hyper-v-on-windows/user-guide/nested-virtualization), [Azure VM lifecycle](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/lifecycle/end-of-life-sizes-list), [VM states and billing](https://learn.microsoft.com/en-us/azure/virtual-machines/states-billing), [VM deletion behavior](https://learn.microsoft.com/en-us/azure/virtual-machines/windows/tutorial-manage-vm).
