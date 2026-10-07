# Issue #115: full-app slowdown preflight and resource decision

Observed 2026-10-07 UTC on branch `issue/115` at base `ceb22fa352989ade57ae1639e01d7e7eda8a7359`. The initial resource finding below was superseded by an isolated, zero-cost GitHub Actions experiment. This is a full-app idle-workload A/B receipt, not a reproduction of the owner's slowdown, a causal fix, or independent QA. The delivered Luna harness v17 was checked against the GitHub `r2cuerdame/LoopOffice` `skills/luna/SKILL.md` blob `8a8bb477c29eae2a20a37337d805c5aaf4d853fd`; its SHA-256 is `65772ce5a2078d776af050ee3ebe5a6a968cb2e9ef44d18da91fc9f6854ba597`.

## #113 preflight disposition

Draft PR #113 (`issue/111`, head `64304f64c1ee4bd7f786edbd40533cad2f1de3da`) adds only `docs/reports/2026-10-07-issue-111-preflight.md`. It records a useful resource inventory and measurement outline. It has no full-app raw sample, A/B pair, production fix or regression assertion. Its CI success checks documentation and the old head; it cannot establish the user symptom at #115. Since #112 merged in PR #114, its statements that the live-test guard is still open are stale. This report reuses the inventory as historical evidence, not its code or conclusion. Recommend Chief close #113 as superseded after preserving the historical receipt; the #115 Worker does not alter another Issue's PR. Its `Closes #111` body must not be transplanted to #115.

## Zero-cost HOME inventory and observed limits

| Candidate | Current observation | Missing condition |
| --- | --- | --- |
| Current Windows host (`RECUERDAME`) | 16 logical processors, 66,126,716,928 B physical RAM; `vmmemWSL`, `wsl.exe`, `wslhost.exe` processes were present. | Its WSL and desktop belong to the user. Full-app ON/OFF or companion-window input here would share resources and could perturb the user's session. File-isolated Issue and canonical checkouts do not isolate the host. |
| Existing local Hyper-V guest | Read-only `Get-VM` returned a permission error. | Guest existence, access, isolation and UI control are unverified. No VM was started or modified. |
| RDCX machine inventory | #113's earlier inventory identified only the user's Windows host. No second device was allocated to WSLPad in current LoopOffice GitHub config (`devices: []`, `testEnvironment: null`). | No verified independent Windows desktop and WSL2 guest. An unlisted device cannot be assumed available. |
| DevHotel Web/Android Rooms | Current DevHotel README supports agent-created Web and Android Rooms. | Neither provides the Windows desktop/WSL2 combination. No Room was created. |
| DevHotel Windows (VMware) Room | Current README calls it Preview; desktop setup is user-only, while guest exec/file ingress are planned and the agent API cannot create it. | Cannot run and instrument this A/B as a Worker. |
| GitHub-hosted Windows Actions runner | The normal CI builds and tests in fixture mode, but a separate `windows-2025` job successfully installed an isolated Ubuntu 24.04 WSL2 distro and collected full-app A/B rows. [Feasibility run](https://github.com/r2cuerdame/WSLPad/actions/runs/37612013289); [measurement run](https://github.com/r2cuerdame/WSLPad/actions/runs/37612297685). The public repository's standard hosted runner has no new billing under [GitHub's published terms](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). | Windows Server 2025, 4 vCPU, 16 GiB and a fresh test distro differ from the owner's Windows 11 WSL workload; the reported slowdown did not reproduce. |
| WSLPad fixture/mock provider | In-memory WSL data and fake-timer polling tests can check behavior without live WSL. | No real Windows resource pressure, WSL latency or other-window response. Mock PASS cannot diagnose the reported slowdown. |
| Windows Sandbox or another guest on this physical host | No separate guest with worker access was identified; the Hyper-V inventory is permission denied. | Even a new local guest would share the user's physical CPU/RAM and need a host operation. It would not meet the requested isolation on present evidence. |

The hosted runner is a viable zero-cost isolated path for this *idle* full-app comparison. The original HOME inventory was read-only and correctly avoided touching the owner's WSL, but its conclusion that no zero-cost path existed was too strong. The runner is ephemeral and its Windows Server image and test workload limit external validity. A measurement harness alone cannot supply the missing reproduction workload or establish the cause. Existing self-hosted runners: zero in the WSLPad repository API. LoopOffice GitHub config lists `testEnvironment: null` and `devices: []` for WSLPad.

## Measurement contract and causal hypotheses

The [measurement workflow](../../.github/workflows/issue-115-full-app-ab.yml) used one checkout on a GitHub-hosted Windows Server 2025 runner (image `20260925.250.1`). It built the pre-collector base `c06b065d5bd4127fdce32b115677494761782a64` and head `b1d742536b2570b4d81159684d281dc0ca2a14cf` sequentially. It installed Ubuntu 24.04 under WSL2, then launched the real full Electron app with `WSLPAD_FIXTURE_MODE=0` and isolated app data. Each build had three OFF/ON/OFF trials, eight timestamped samples per phase and a 10-second ON warmup. A separate WinForms companion window answered cross-process `WM_NULL` messages; this tests its UI message loop, not actual click or visual redraw latency. The collector recorded host CPU and available RAM, Electron CPU and working set, `vmmemWSL` working set, live `wsl.exe` round-trip latency and companion-window response latency. The [raw base CSV](issue-115/raw-run-37612297685/base-raw.csv) and [raw head CSV](issue-115/raw-run-37612297685/head-raw.csv) contain all 144 samples; [analyzer](../../scripts/issue-115-analyze.py) validates the rows and computes paired summaries. The WSL probe itself adds equal background work to all phases. No owner's WSL instance was started, stopped or terminated.

Hypotheses to test, not findings: repeated host-wide collectors or WSL guest polling; an Electron main/renderer CPU or memory leak; WSL process or disk contention; and load unrelated to WSLPad. Attribute only after the full-app samples and process-tree counters distinguish these paths. If a code fix follows, the same baseline must fail a symptom-relevant assertion and the fix must pass it before claiming the Regression TDD Gate.

| Required evidence | Raw samples here |
| --- | ---: |
| Full-app OFF/ON host and app CPU | 144 |
| Full-app OFF/ON host and WSL RAM | 144 |
| Full-app OFF/ON live WSL latency | 144 |
| Full-app OFF/ON other-window responsiveness | 144 |
| Independent Suah raw A/B rerun or comparison | 0 |

The first sample of each phase often includes WSL startup (up to seconds). The following stable medians exclude that first sample while retaining it in the raw CSV. For each build, ON was compared with its neighboring OFF phases in each of the three trials. The median of the three ON-minus-OFF differences was:

| Metric | Pre-collector base | Current head |
| --- | ---: | ---: |
| Host CPU, percentage points | +2.163 | -0.503 |
| Host available RAM | -264.6 MiB | -250.5 MiB |
| Electron working set | +384.7 MiB | +384.7 MiB |
| WSL VM working set | +24.3 MiB | +24.9 MiB |
| Live WSL round trip | -0.895 ms | +0.340 ms |
| Companion-window response | +0.012 ms | +0.004 ms |

All 144 live WSL probes and companion pings succeeded. Every ON segment had Electron processes; every OFF segment had none. CI and the measurement workflow passed at `b1d7425`. The idle runner did **not** reproduce severe host-wide slowness or a meaningful companion-window response penalty. This does not prove the owner's symptom is resolved: it lacks their workload and Windows 11 environment, and base and head ran sequentially while background runner load varied. The affected subsystem and cause remain unknown. No product fix or baseline-failing regression assertion is justified from these samples. #109's collector-only measurement, #112's test guard and #111's not-planned closure remain insufficient evidence of symptom resolution. No QA waiver is requested.

## Proposed $75 spending settlement; approval and execution zero

The isolated hosted runner required no Azure spending. The former Azure proposal is retained only as a contingency, not a request to purchase it. Its proposed resource is a time-limited Microsoft Azure Windows Server 2022 Desktop Experience `Standard_D4s_v3` VM in East US with nested virtualization/WSL2, one 128 GiB Standard SSD E10 LRS OS disk, and one Standard static IPv4 only if guest access requires it. Microsoft's [exact retail meter query](https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&%24filter=armSkuName%20eq%20%27Standard_D4s_v3%27%20and%20armRegionName%20eq%20%27eastus%27%20and%20priceType%20eq%20%27Consumption%27) on 2026-10-07 returned Windows D4s v3 meter `dd087e30-7477-4459-8349-b2523cbb4b04` at USD **0.376 per powered-on compute hour**, USD **9.60 per disk-month** plus disk operations, and USD **0.005 per public-IP hour**. At a 24-hour maximum powered-on window, compute is USD **9.024** and public IP at most USD **0.12**; disk, transactions, network egress and applicable taxes remain additional. The USD 75 figure is a proposed *total ceiling*, not an estimate that these residual meters are zero. Availability, Azure subscription and actual invoice prices must be checked before provisioning. Dsv3 is an older series with a published retirement path, and Windows Server results would still need a Windows 11 external-validity caveat.

Period: provision only after explicit Source spending approval, conduct the experiment within one 24-hour wall-clock window, then export redacted raw data and delete the dedicated resource group, including VM, OS/data disks, snapshots, NIC and public IP. A budget alert is monitoring, not a hard cap: stop/deallocate the VM if cost nears the ceiling, verify deletion of billable resources and inspect Cost Management for delayed usage. Deallocation stops compute charges but leaves disks/IP billable; deletion of the VM alone can leave disks/network resources. Network egress, disk operations, taxes and delayed metering are residual charge risks until the invoice settles. The LoopOffice GitHub config explicitly says `pipeline.human.autonomousSpendCeilingUsd: 0` (not unknown). Proposed authorization is **one-time Microsoft Azure spending up to USD 75, no recurring resource**, contingent on an existing usable account; no account or credential expansion is authorized by this proposal.

No Azure resource was provisioned, no purchase or charge was initiated, and no user approval was solicited. The free runner completed a live full-app A/B; it did not reproduce the severe slowdown. Luna must decide whether this non-reproduction under the stated idle Windows Server workload is sufficient or specify a representative workload/environment before causal repair can proceed. Hanbyeol review and Suah independent raw A/B rerun/comparison remain outstanding. The Issue's bug regression gate cannot be satisfied without an identified bug and a baseline-failing assertion.

## Local checkpoint verification

`npm ci --ignore-scripts` completed; local `npm run build` passed. Local `npm test` passed 98 files / 1,636 tests, with 2 files / 11 live-WSL cases skipped under the #112 default guard. The public Windows runner's [CI run](https://github.com/r2cuerdame/WSLPad/actions/runs/37612297611) and [full-app A/B run](https://github.com/r2cuerdame/WSLPad/actions/runs/37612297685) passed at `b1d7425`. The fixture-mode E2E in normal CI is not A/B evidence. No production deployment or production verification occurred.

Sources: [DevHotel current README](https://github.com/r2cuerdame/DevHotel#readme), [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [Azure nested virtualization](https://learn.microsoft.com/en-us/virtualization/hyper-v-on-windows/user-guide/nested-virtualization), [Azure VM lifecycle](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/lifecycle/end-of-life-sizes-list), [VM states and billing](https://learn.microsoft.com/en-us/azure/virtual-machines/states-billing), [VM deletion behavior](https://learn.microsoft.com/en-us/azure/virtual-machines/windows/tutorial-manage-vm).
