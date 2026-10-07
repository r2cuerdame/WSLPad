# Issue #109 collector-load repair receipt

## Observation and scope

Owner observation (2026-10-07 06:34:12Z): “wslpad가 켜있는동안 엄청 느려지는 버그가 있어 이것도 티켓화시켜”. The affected surface and trigger are still unknown. Issue #77 concerns Defender coverage of WSL disk images; it does not establish that Defender caused this symptom. No other open Issue with the same symptom was found in the repository Issue and PR lists. The 1.1.2 release notes and current changelog do not diagnose it.

This worker checkout shares a Windows host with running user WSL processes. No user process or distro was started, stopped, or replaced for this investigation. The tests below use injected commands and clock time in the worker checkout, so they demonstrate polling pressure but **do not reproduce or explain the owner's severe slowdown**.

Luna decision `DLG-20261007-044:2` separated the full-app on/off comparison and owner-symptom investigation into [Issue #111](https://github.com/r2cuerdame/WSLPad/issues/111). This PR covers the collector's own load only. The full-app impact boundary and symptom repair remain **unconfirmed**; neither is claimed as fixed here.

## Deterministic on/off comparison

The default fast tier ticks every 3 seconds while monitoring is on, including when the window is hidden. The controlled test simulates ticks at 0, 3, …, 60 seconds. Monitoring off means neither collector is called. A command invocation represents one host-wide process or socket enumeration; it is not a CPU or I/O measurement.

| Collector and condition | Baseline | Checkpoint | Result |
| --- | ---: | ---: | --- |
| `netstat -ano`, monitoring off | 0 | 0 | No poll |
| `netstat -ano`, monitoring on, 60 s | 21 | 5 | 15 s cache; a new listener is visible at expiry |
| `tasklist /fo csv /nh` for VM memory, monitoring off | 0 | 0 | No poll |
| `tasklist /fo csv /nh` for VM memory, monitoring on, 60 s | 21 | 5 | 15 s cache |

Both new regression assertions failed at baseline with 21 calls and passed at this checkpoint with 5. These collectors impose repeated **Windows host** queries; the fast tier also invokes WSL guest commands. This code path can contribute load on both sides, but the observed owner impact remains unclassified.

## Same-host collector observation (2026-10-07)

Run `node scripts/measure-issue-109.mjs base 60`, then `node scripts/measure-issue-109.mjs head 60` from this branch on Windows. The script bundles the two collectors in memory from the merge-base or working tree, invokes the actual Windows `netstat` and `tasklist` commands every three seconds for 21 ticks, and uses an empty synthetic guest response. It never launches or stops WSLPad or WSL. The bundles are collector builds, **not full WSLPad builds**. Each row is a separate 60-second run on the same non-isolated host, so concurrent host load may differ.

| Read-only observation | Base `c06b065` | Issue branch | Scope |
| --- | ---: | ---: | --- |
| Duration | 60.989 s | 60.437 s | 21 scheduled ticks |
| `netstat` child launches | 21 | 4 | One child per actual call; deterministic test's ideal clock gives 21 → 5 |
| `tasklist` child launches | 22 | 5 | Includes one process-name lookup in each run |
| Collector command launches | 43 | 9 | Launch rate 0.71/s → 0.15/s; excludes two observer processes per run |
| Child command wall time, summed | 13,842 ms | 3,287 ms | `netstat` + `tasklist`; overlapping time is counted twice |
| Collector Node CPU time | 3,922 ms | 829 ms | Excludes child CPU and the observer PowerShell process |
| Peak collector Node working set | 154,509,312 B | 90,382,336 B | Windows `Get-Process.PeakWorkingSet64` for the collector process; not WSLPad memory |
| Collector Node threads, start → end | 13 → 14 | 13 → 14 | Windows process snapshot; peak unknown |
| Collector Node read / write transfer | 1,776,411 / 780 B | 341,890 / 780 B | Node process only; excludes command children and disk-device totals |

The polling period remained three seconds; the host-wide scans were cached for 15 seconds. The observed four `netstat` calls, rather than the ideal-clock test's five, reflect command completion time near cache expiry. The collector process spawned the measured command children and two PowerShell observers for its own Windows process counters. The earlier receipt's “Peak collector Node RSS” values were end-of-call samples, not measured peaks; this run replaces them with the operating system's peak working-set counter. Child concurrency was not sampled; process creation count came from the injected command wrapper. Windows host, WSL guest, and window responsiveness were **not** measured, and the owner's slowdown was not reproduced. This result cannot establish the impact boundary or a root cause.

### Repeat with per-command timing

The same script was run once more per variant, sequentially, on the same Windows host with the same 60-second schedule and baseline SHA. This is one additional paired run, not an isolated trial. `childWallMs` is elapsed time around each `runHostCommand` promise; the per-call figures below divide that total by the actual call count. Calls that overlap are counted separately. The script's own observer PowerShell processes are excluded from the collector command count.

| Measure | Base `c06b065d5bd4127fdce32b115677494761782a64` | Collector code at `6ae91e3` |
| --- | ---: | ---: |
| Wall time / scheduled polls | 60,982 ms / 21 | 61,077 ms / 21 |
| `netstat` launches / total call wall time / mean per call | 21 / 733 ms / 34.9 ms | 3 / 853 ms / 284.3 ms |
| `tasklist` launches / total call wall time / mean per call | 23 / 14,612 ms / 635.3 ms | 6 / 48,121 ms / 8,020.2 ms |
| Combined child launches / rate | 44 / 43.3 per minute | 9 / 8.8 per minute |
| Collector Node CPU time | 3,812 ms | 704 ms |
| Peak collector Node working set | 156,917,760 B | 82,796,544 B |
| Collector Node threads, start → end | 13 → 14 | 13 → 14 |
| Collector Node read / write transfer | 1,780,774 / 793 B | 221,482 / 780 B |

The first paired run above measured 43 → 9 combined launches (42.3 → 8.9 per minute), 60,989 → 60,437 ms elapsed, and 3,922 → 829 ms Node CPU. The second pair measured 44 → 9 launches and 3,812 → 704 ms Node CPU. The second head run also had much slower `tasklist` calls; the observation does **not** establish lower per-call latency or lower host-wide load. Shared-host contention and the 8-second command timeout limit causal inference. The consistent result across these two pairs is fewer child launches and less CPU in the collector Node process, not a reproduced improvement in user-perceived responsiveness.

## Verification and missing evidence

At code head `6ae91e3`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (99 files, 1,644 tests), and fixture-mode `npm run test:e2e` (54 tests) passed locally; independent Suah QA also reported these passes. This history does not make the new documentation head an exact-head full-suite pass. At this repair head, build, typecheck and lint passed. A filtered Vitest run passed 97 files / 1,638 tests, including both RED→GREEN regression tests; it excluded `test/integration/terminal-real.test.ts` and `test/unit/wsl/escape.test.ts` because they invoke live `wsl.exe`. **The filter missed `test/integration/wsl-collectors.test.ts`: its eight tests ran live WSL collectors.** This was an execution error on the shared host; whether it started a distribution is unknown. No further live tests were run. The default suite's live WSL opt-in guard is tracked in [Issue #112](https://github.com/r2cuerdame/WSLPad/issues/112). A safe exact-head full-suite pass and independent exact-head QA remain outstanding. No release, deployment, or production verification was performed.

An isolated full-app on/off comparison has not been performed. The available Windows host has running WSL processes outside this worker. The existing E2E harness launches a worker-owned WSLPad process with isolated user data, but fixture mode substitutes `FixtureWslProvider` for the real provider, so it cannot measure the changed `netstat`/`tasklist` collectors or reproduce the live slowdown. A real-provider full-app comparison here could interact with those running WSL environments; no isolated Windows+WSL worker host was available for this repair. Issue #111 owns that follow-up under Luna decision `DLG-20261007-044:2`; its current preflight is blocked on an isolated Windows+WSL guest. The missing comparison would need CPU, memory, disk and I/O, process and thread counts, polling and timer frequency, and the impact boundary with the app off/on at base and this branch's head. The available same-host collector observation supports reduced host scan pressure, but not a verified repair of the owner's symptom. Independent review, QA, merge, and release remain pending.
