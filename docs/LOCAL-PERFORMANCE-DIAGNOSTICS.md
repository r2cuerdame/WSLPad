# Local slowdown recording (#116)

Open **Dashboard → Diagnostics → Local slowdown recording** and choose **Start recording**. It is off on every app launch. Use WSLPad normally, then choose **Stop recording**. The same panel lists slow intervals and lets you export the JSON Lines file. The file is also shown in the panel and lives under Electron's `userData/performance-diagnostics` directory. Export creates a user-selected local copy. The recorder sends no data and starts no WSL commands. Existing app services outside this recorder have their own behavior.

Each line has only an ISO timestamp, a metric kind and a numeric value. The measured values are:

| Kind | Unit | Source |
| --- | --- | --- |
| `ui` | ms | Main-to-renderer IPC round trip, sampled once per second. Includes renderer thread scheduling and IPC. |
| `eventLoop` | ms | Main-process 1-second timer lateness. |
| `render` | ms | Visible-window animation-frame gap over 100 ms. The first frame after a hidden period is ignored. |
| `wsl` | ms | Duration of existing `wsl.exe` runner calls, including failures. No command, arguments, output, distribution name or path is recorded. |
| `cpu` | percent | Sum of CPU use across Electron app processes from `app.getAppMetrics()`. |
| `memory` | bytes | Sum of process working-set sizes from `app.getAppMetrics()`. |

The panel groups consecutive slow samples of the same kind within 2 seconds, keeping the latest 50 intervals. Thresholds: UI round trip 200 ms, main event loop 100 ms, visible frame gap 100 ms, WSL call 1000 ms. CPU and memory are context samples, not slow-interval triggers. Logging runs only when explicitly enabled. Each second's samples are written in one batch; stopping and exporting flush pending samples. An unclean process termination can lose less than one second of buffered measurements.

## Overhead budget and measurement

The limits are **under 2 ms per sample through renderer IPC** and **under 5 ms per app-process metrics read** in the fixture benchmark. The recorder samples app totals and the main event loop once per second, checks renderer responsiveness once per second and only sends renderer frame gaps over 100 ms. These limits do not bound filesystem completion time or an already-slow WSL call.

On Windows in this Issue workspace, `npm test -- --run test/unit/state/performance-diagnostics.test.ts` measured 1,000 synthetic WSL timing samples: disabled 0.03 ms total, enabled 0.91 ms total, **0.0009 ms added per sample**. This measures the recorder call, including JSON serialization and buffering, with a local file flush at stop.

The Electron Playwright fixture test `keeps enabled recording under the 2 ms per sample overhead budget through IPC` measured 200 renderer IPC samples: disabled 0.244 ms/sample, enabled 0.238 ms/sample. The observed difference was within run-to-run noise; the enabled total was below 2 ms/sample. An `app.getAppMetrics()` read averaged 0.053 ms over 100 calls, below the 5 ms/read limit. This is a synthetic Windows run, not an upper bound for all Windows 11 machines or real workloads. The recordings from real use are intended to reveal whether the instrumentation itself causes noticeable delay.
