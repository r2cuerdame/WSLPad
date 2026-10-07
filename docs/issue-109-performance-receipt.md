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

## Verification and missing evidence

`npm run build`, `npm run typecheck`, and `npm test` passed locally (99 files, 1,644 tests). The full suite includes existing live WSL collector tests; it was run once and did not constitute an on/off app measurement. No release, deployment, or production verification was performed.

To complete Issue #109, run the same released or candidate WSLPad build on an isolated Windows/WSL host that the worker may control, or have the owner perform the physical host on/off procedure. Record CPU, memory, disk and I/O, process and thread counts, poll and timer frequency, and the impact boundary in both states, then repeat at this branch's head. Without that host comparison, the root cause and the claimed severe performance repair cannot be verified. Independent review, QA, merge, and release remain pending.
