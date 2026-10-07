# Issue #111: full-app A/B preflight (blocked)

Date: 2026-10-07 UTC. This is a resource and method checkpoint, **not a measurement result**.

## Evidence and boundary

- The only RDCX device exposed to this worker is `recuerdame-win` (`RECUERDAME`), the user's Windows host. No dedicated Windows+WSL test device is exposed.
- `Get-VM` on that host returned "permission required". DevHotel is running, but its published Windows Room support is Preview: guest execution and file ingress are planned, and agents cannot create Windows Rooms through its API. A Web Room cannot run this Windows Electron/WSL comparison.
- PR #110 for #109 compares collectors at base `c06b065d5bd4127fdce32b115677494761782a64` and candidate `6ae91e328c1608c103a4f7fac5c6c264a43f507f`. Its fixture-mode app substitutes the real WSL provider. Neither result measures full-app on/off or the reported host slowdown.
- Open issue preflight found #109 (the collector fix) and #111 (this full-app comparison); no other open WSLPad issue covers this full-app A/B scope.
- No full WSLPad application or VM was started, and no Windows setting was changed for the experiment. No app-level CPU/RAM/latency values were obtained.
- Verification mistake: after `npm ci`, I ran the repository-wide `npm test` on `RECUERDAME`. It passed 99 files / 1,642 tests, but includes `test/integration/terminal-real.test.ts` (which spawned a shell against live WSL) and live collector tests. I did not establish whether the distribution was running beforehand, so I cannot rule out an implicit distribution start. This test run is **not** an isolated A/B measurement. Do not rerun the live tests on this host for this Issue. `npm run build` passed.

## Measurement method once an isolated device is available

Use a dedicated, worker-controlled Windows 11 x64 device with WSL2 **already running**, its own test distribution and data, a separate interactive guest session, and remote guest command and UI automation. It must have no user WSL distributions or user apps in the experiment. Confirm CPU/RAM capacity and verify the test session has no access to the user's desktop. Keep the test distribution running for the entire experiment; toggle **only WSLPad**, never WSL or Windows settings. Use two immutable app builds, one from each exact commit above, with separate test-only user-data directories and disabled auto-update in the prepared image. Record build hashes and the process tree for each run.

Run repeated interleaved OFF/ON/OFF windows for each build, with the same WSL workload, window layout, sampling interval, warmup, and measurement duration. Record wall-clock and monotonic timestamps, trial order, background activity and any failed samples. Preserve raw per-sample host total CPU, WSLPad process-tree CPU, committed/available RAM, WSL VM memory, WSL request/response latency, and latency of an independently controlled companion window in the guest. Keep the WSL probe resident throughout so a latency sample cannot start a distribution. The companion window must be driven inside the isolated guest, not through the user's host foreground input. Report medians, tails, run-to-run spread, and ON-minus-neighboring-OFF deltas for base and candidate; include raw CSV/JSON and scripts with the final receipt.

If the slowdown recurs, compare host-wide, WSL, WSLPad main/renderer, and collector timing in the same time windows to identify the affected boundary. If the cause is outside the collector fix, propose a separate bug Issue; do not label collector-only improvements as full-app resolution. Independent Suah QA must repeat or inspect the exact-head experiment before completion. No QA exemption is requested.

## Missing resource

A dedicated isolated Windows+WSL device with guest execution and UI observation is not available to this worker. Running the experiment on `RECUERDAME` would consume the user's CPU/RAM and risk affecting their WSL and apps; a full-app on/off there would violate this Issue's isolation condition. A suitable already-approved HOME device must be physically made available and exposed to the worker. Human host class: `device=dedicated isolated Windows 11 x64 WSL2 test host`, `action=physical_access`. No purchase or subscription is requested.
