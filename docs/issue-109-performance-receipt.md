# Issue #109 performance investigation checkpoint

## Observation and scope

Owner observation (2026-10-07 06:34:12Z): “wslpad가 켜있는동안 엄청 느려지는 버그가 있어 이것도 티켓화시켜”. The affected surface and trigger are still unknown. Issue #77 concerns Defender coverage of WSL disk images; it does not establish that Defender caused this symptom. No other open Issue with the same symptom was found in the repository Issue and PR lists. The 1.1.2 release notes and current changelog do not diagnose it.

This worker checkout shares a Windows host with running user WSL processes. No user process or distro was started, stopped, or replaced for this investigation. The tests below use injected commands and clock time in the worker checkout, so they demonstrate polling pressure but **do not reproduce or explain the owner's severe slowdown**.

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

## Verification and missing evidence

After correcting the peak working-set measure, `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (99 files, 1,644 tests), and fixture-mode `npm run test:e2e` (54 tests) passed locally. The unit/integration suite includes existing live WSL collector tests; it does not constitute an on/off app measurement. No release, deployment, or production verification was performed.

An isolated full-app on/off comparison has not been performed. The available Windows host has running WSL processes outside this worker. The existing E2E harness launches a worker-owned WSLPad process with isolated user data, but fixture mode substitutes `FixtureWslProvider` for the real provider, so it cannot measure the changed `netstat`/`tasklist` collectors or reproduce the live slowdown. A real-provider full-app comparison here could interact with those running WSL environments; no isolated Windows+WSL worker host was available for this repair. The missing comparison would need CPU, memory, disk and I/O, process and thread counts, polling and timer frequency, and the impact boundary with the app off/on at base and this branch's head. The available same-host collector observation supports reduced host scan pressure, but not a verified repair of the owner's symptom. Independent review, QA, merge, and release remain pending.
