# Issue #111: isolated full-app A/B preflight — blocked

Date: 2026-10-07 UTC. This is a read-only resource and method assessment, **not an A/B measurement or QA pass**. The operating harness was checked against `r2cuerdame/LoopOffice` `skills/luna/SKILL.md` v17 (SHA-256 `65772ce5a2078d776af050ee3ebe5a6a968cb2e9ef44d18da91fc9f6854ba597`).

## Previous job `e77d9d89`: exact live WSL path

The previous job recorded running **`npm test`**, the repository's default test script, after `npm ci` at branch baseline `c06b065d5bd4127fdce32b115677494761782a64`. It was not a separate manual `wsl.exe` command. At that commit, `package.json` maps `test` to `vitest run`. Two tests in the default suite contain live calls:

- `test/integration/terminal-real.test.ts`: top-level `wslAvailable()` calls `execFileSync('wsl.exe', ['--exec', '/bin/sh', '-c', 'true'])` even if its suite is then skipped. When available, the test creates a real console session for `Ubuntu-24.04`.
- `test/unit/wsl/escape.test.ts`: the round-trip test calls the same `wsl.exe` probe, then calls `wsl.exe --exec /bin/sh -c <printf script>` for each fixture when available.

Running this default suite on the user's host was an **execution judgment error**. The prior job recorded 99 test files / 1,642 tests passed and `npm run build` passed, but these are not isolated A/B results. Whether the live probes or shell **implicitly started a distribution is unknown**: the job did not establish its prior state. The live-test opt-in fix belongs to #112; this Issue makes no test-code change. This execution made **zero** live WSL calls, started **zero** distributions/VMs/apps, and did **not** rerun the full suite.

## Existing HOME resources and isolation decision

| Resource verified for this task | Evidence and suitability |
| --- | --- |
| `recuerdame-win` / `RECUERDAME`, user's Windows x64 host | RDCX `list_devices` exposed exactly this one online device (16 logical CPUs, 63,063 MB total RAM). It hosts user WSL and apps. Spare CPU/RAM capacity is not isolation; full-app on/off here can affect them. |
| Issue workspace and canonical checkout on the same host | They separate Git files, not host CPU, RAM, WSL, or the interactive desktop. The canonical checkout is not touched. |
| DevHotel Web/Android Rooms | Published DevHotel README says these providers are supported, but neither supplies an isolated Windows desktop with WSL2 for this experiment. |
| DevHotel Windows Room | The published README marks it Preview, desktop setup only, not creatable through the agent API; guest execution and file ingress are planned. It is not an available automation target. |
| WSLPad project configuration | LoopOffice `config/loopoffice.yaml` at main has `testEnvironment: null` and `devices: []` for WSLPad. No separate Windows+WSL test host is allocated there. |

The previous `Get-VM` attempt returned “permission required.” It did **not** establish that a suitable VM already exists. This job did not repeat it. No identified existing physical device needs `physical_access`; such a claim would be unsupported. The verified HOME resources therefore **cannot perform a user-isolated full-app A/B**. Open WSLPad issues were checked: #109 owns the collector change, #112 owns live-test opt-in, and no other open issue duplicates #111's full-app comparison.

## Measurement contract when an isolated Windows+WSL guest exists

Compare base `c06b065d5bd4127fdce32b115677494761782a64` with candidate `6ae91e328c1608c103a4f7fac5c6c264a43f507f` from PR #110. Use an independent Windows x64 interactive guest with WSL2 and its own already-running test distribution; verify the guest cannot reach user distributions or desktop input. Keep its distribution and WSL settings fixed. Toggle only WSLPad, using immutable builds and separate test-only user-data directories. Record build hashes and the full process trees.

For each build, interleave repeated OFF/ON/OFF windows at fixed warmup, sampling interval and duration under the same WSL workload and window layout. Preserve timestamps, trial order, background activity, failures and raw per-sample host CPU, WSLPad process CPU, host available/committed RAM, WSL VM memory, WSL request/response latency, and an independently driven companion-window response latency. Keep the WSL probe resident throughout to avoid starting a distribution as part of a latency sample. Report median/tails, trial spread and ON-minus-neighboring-OFF deltas. Distinguish host-wide, WSL, main/renderer and collector load if slowdown recurs; propose a separate bug if its cause is outside the collector. Suah must independently compare the exact head. No QA exemption is sought.

## Actual result and unmet conditions

| Required observation | Raw samples this job |
| --- | ---: |
| Full-app host CPU on/off | 0 |
| Full-app host and WSL RAM on/off | 0 |
| WSL response latency on/off | 0 |
| Other-window responsiveness on/off | 0 |
| Independent Suah QA comparisons | 0 |

The owner's slowdown, its impact boundary and the full-app effect of #109 remain **unconfirmed**. Collector-only measurements in PR #110 are not evidence that the user symptom is resolved. The Issue's measurement and independent QA conditions are unmet; automated full-suite tests are deliberately not repeated on the user host.

## Resource needed; proposed human spending decision

An isolated Windows+WSL guest with independent interactive control and telemetry must be supplied. One concrete option is a **new, time-limited Microsoft Azure** `Standard_D4s_v3` Windows Server 2022 Desktop Experience VM in East US, Standard security type, with WSL2, a test-only distribution, guest command/UI access and a 128 GiB disk. Microsoft documents WSL on Server 2022 and nested virtualization for this VM family. The Azure Retail Prices API returned **USD 0.38/hour** for the Windows `D4s v3` compute meter in East US on 2026-10-07; 100 powered-on hours cost USD 38 for compute before disk/network/taxes. This is a proposed environment, not a provisioned or approved one. Server versus the user's Windows 11 is an external-validity limit and must be disclosed with results. See [Azure VM family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dv3-series), [nested virtualization](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/enable-nested-virtualization), [WSL on Server](https://learn.microsoft.com/en-us/windows/wsl/install-on-server), and [retail price API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices).

Human need: `spending`, with `amountUsd=75` (one-time maximum including compute, disk and network), `payee=Microsoft Azure`, `recurring=false`. No purchase, subscription, VM setup or account action was taken. If Luna identifies an already-approved, genuinely isolated Windows+WSL guest with remote UI/control, that resource can satisfy the need without spending; its identity and isolation must be verified first.

## Resume preflight for dispatch receipt 181

The earlier job's GitHub Issue comment states the missing resource verbatim: **“Required dedicated Windows+WSL interactive guest with guest command/UI control.”** Its inventory places the only identified Windows host, `recuerdame-win`, on the user's own WSL and desktop. File separation between the Issue workspace and canonical checkout does not isolate CPU, memory, WSL instances or UI input. No independent guest with those controls was identified in this resume. The requested A/B remains unsafe on the user host.

At this preflight, #112 is still **open**. Its opt-in guard has not merged, and the default `npm test` still contains live `wsl.exe` calls. The full suite was not run. Instead, only these inspected fixture/pure-data files were run with `vitest run`:

- `test/unit/wsl/fixture.test.ts` — fixture WSL provider, console and explorer;
- `test/unit/wsl/hermes-home.test.ts` — parser against static sample data;
- `test/unit/wsl/terminal-profiles.test.ts` — profile parsing and injected file reads.

All 3 files and 65 tests passed. The selected tests made no live WSL call. They check existing fake/parsed WSL boundaries; they do **not** measure the app's resource effect or reproduce the user's slowdown. This resume created no VM, distro or Room and did not start, stop or configure user WSL. Raw full-app CPU, RAM, WSL latency and companion-window latency samples remain **0** in each category. Independent Suah comparisons remain **0**. The measurement and independent QA acceptance conditions remain unmet. The draft PR is a checkpoint and must not be treated as a completed A/B or merged on this evidence.

## Resume assessment for dispatch receipt 192

The operating harness was read again from the GitHub `r2cuerdame/LoopOffice` `skills/luna/SKILL.md` blob `8a8bb477c29eae2a20a37337d805c5aaf4d853fd`; its SHA-256 matches the pinned v17 hash above. The #109 collector change has since merged in PR #110. This branch merged current `origin/main` (`f036fce`) without rewriting its prior commits or replacing draft PR #113. #112 remains open, so the default suite's live WSL paths are still not safe to run here.

Luna's latest dispatch asked for a mock-boundary RED→GREEN repair if the reported slowdown can be reproduced there. The available fixture boundary cannot reproduce that symptom: `FixtureWslProvider` returns fixed in-memory distro, resource and service data, while `test/unit/state/polling.test.ts` uses fake timers and mocked store calls. It has no Windows host CPU/RAM contention, live WSL request latency, or independently driven companion window. The owner observation in #109 specifies none of the affected subsystem, onset or trigger. A fake delay or CPU spike introduced into a test would be a synthetic input chosen by the test, not a baseline reproduction of that observation. Changing polling or app behavior against such an assertion would claim an unsupported causal repair. No production change or regression test was made on that basis.

The safe boundary tests `test/unit/state/polling.test.ts`, `test/unit/state/store.test.ts` and `test/unit/wsl/fixture.test.ts` passed **3 files / 69 tests** both before and after this branch merged main; `npm run build` passed after the merge. The selected tests contain no live `wsl.exe` spawn path. No app, distro, VM or Room was started in this resume. There are still **zero** full-app on/off raw samples for host CPU, RAM, WSL response latency and other-window latency; **zero** independent Suah A/B comparisons; and no RED→GREEN assertion for the owner's symptom. The missing capability is an isolated Windows+WSL interactive guest with guest command/UI control and independent telemetry. Mock unit tests do not replace that resource or satisfy the Issue's measurement and QA conditions.
