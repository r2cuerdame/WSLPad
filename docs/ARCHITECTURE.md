# WSLPad Architecture

WSLPad is a Windows-only Electron application with three processes and one
strict rule: **all WSL access happens in the main process**, the renderer only
talks through a typed, allowlisted IPC bridge.

```text
┌────────────────────────────── Electron main ──────────────────────────────┐
│                                                                           │
│  SettingsStore ── schema-validated JSON, corruption-safe                  │
│        │                                                                  │
│  createBackends()  ──  WSLPAD_FIXTURE_MODE=1 → deterministic fixtures     │
│        │                otherwise → real backends:                        │
│        ├─ WslProvider     (collectors over the Hidden Runner)             │
│        ├─ ExplorerBackend (Linux file ops over the Hidden Runner)         │
│        ├─ WindowsFs       (Windows file ops over node fs — left pane)     │
│        └─ ConsoleFactory  (node-pty → wsl.exe interactive shells)         │
│        │                                                                  │
│  SnapshotStore ── single JSON-serializable WslPadSnapshot                 │
│        │            ▲ fast/medium/slow PollingScheduler                   │
│        │            ▲ warnings rules                                      │
│        ├──────────► IPC events → renderer                                 │
│        └──────────► McpServerHost (read-only Get* tools, 127.0.0.1)       │
│                                                                           │
│  TerminalManager ── one PTY session per distro, OSC-marker state machine  │
│  AppUpdater ── electron-updater (GitHub Releases), disabled in dev        │
│  AppTray ── resident tray icon + localized menu                           │
└───────────────────────────────────────────────────────────────────────────┘
         │ contextIsolation preload (window.wslpad, explicit channel list)
┌────────────────────────────── renderer (React) ───────────────────────────┐
│  TopBar (distro switch · MCP badge · refresh · pause · settings gear)     │
│  Tab 1 Dashboard — master/detail: 12-section list | selected section      │
│  Tab 2 Explorer  — dual pane:  Windows files | WSL files (+ splitter)     │
│  ConsolePanel (xterm.js, always visible, resizable/collapsible)           │
│  SettingsDrawer (modal drawer — never a third tab)                        │
└───────────────────────────────────────────────────────────────────────────┘
```

### Dashboard: master–detail
The 12 read-only sections (overview, resources, paths, configuration, tools,
Hermes, environment, processes, services, ports, warnings, MCP) are listed on
the left; the right side renders only the selected one, so wide tables
(processes, environment) get the whole window instead of a card cell. The list
is a `listbox`, never a `tablist` — the app has exactly two `tab` roles.

### Explorer: dual pane
Both panes are the same component (`FilePane`) driven by an `FsAdapter`:
`createWindowsAdapter()` talks to the `window.wslpad.windows.*` IPC surface
(node `fs` in the main process, `ThisPC` sentinel root listing drives), and
`createLinuxAdapter()` talks to the existing hidden-runner explorer backend.
Copying between panes is the primary interaction: Windows→WSL uses
`importFromWindows`, WSL→Windows uses `exportToWindows`, both reporting through
the same `FileOpProgress` stream. Cross-filesystem *move* is deliberately not
offered — a transfer never deletes its source. Console cwd sync and the
remembered last path come from the WSL pane only.

## Key design decisions

### Hidden Runner (src/main/wsl/runner.ts)
Every internal query is a short-lived `wsl.exe` child process with a timeout,
output-size cap and child tracking. `wsl.exe --exec /bin/sh -c <script>` is
used so the Linux side never re-parses a shell string it did not expect; all
interpolation goes through `shellQuote()`. Management commands
(`wsl.exe --list …`) are decoded as UTF-16LE; distro state is derived from
`--list --running --quiet` so localized STATE words never matter.

Internal queries never touch the user's Console PTY and never appear in its
transcript (goal.md §2.6).

### Single snapshot model (src/main/state)
Dashboard UI, `Copy for LLM` markdown, JSON export and every MCP tool all read
the same `WslPadSnapshot` produced by `SnapshotStore`. Collector failures keep
the last good section and surface as warnings — the store never throws into
the UI. Polling is tiered (3 s / 15 s / 60 s by default, user-adjustable within
bounds) and fully stops when monitoring is paused.

### Read-only by construction
- Dashboard buttons only *prepare* commands into the Console input; nothing is
  executed until the user presses Enter in the Console.
- The MCP server registers exactly the `Get*` tools listed in goal.md §11.2.
  There is no code path from MCP to a mutating operation; secrets are masked
  before data enters the snapshot, and `revealEnv` raw values live only in the
  main process behind an explicit GUI action.

### Console cwd sync without visible `cd`
The interactive shell is spawned with an injected rc file whose
`PROMPT_COMMAND`/`precmd` (bash/zsh):
1. reads a per-distro sync file (written by the Hidden Runner) and `cd`s to it
   silently — inside the prompt hook, so nothing enters history or transcript;
2. emits `OSC 7` (cwd) and `OSC 133;A` (prompt marker).

The main-process session tracks those markers to know when the shell is idle;
a pending path sync is applied only at an idle, empty prompt (rendering one
fresh prompt line), otherwise it waits for the running command to finish.

### Fixture mode
`WSLPAD_FIXTURE_MODE=1` swaps all three backends for deterministic in-memory
implementations (distros, dashboard data, a small filesystem, a fake shell that
emits the same OSC markers). Production code selects backends in exactly one
place (`src/main/wsl/factory.ts`); fixture data cannot leak into real mode.

## Process/module map

| Area | Path |
| --- | --- |
| Shared contracts (types, IPC, schemas, i18n, masking) | `src/shared/` |
| Hidden runner + parsers + detectors | `src/main/wsl/` |
| Snapshot store, polling, warnings, LLM export | `src/main/state/` |
| Linux explorer backend (listing/ops/trash/transfer/editor) | `src/main/explorer/` |
| Windows filesystem backend (drives, node fs, recycle bin) | `src/main/explorer/windows.ts` |
| Console PTY sessions + cwd sync | `src/main/terminal/` |
| MCP server + tools + stdio bridge | `src/main/mcp/` |
| Settings, autostart, updater | `src/main/settings/`, `src/main/{autostart,updater}.ts` |
| IPC allowlist | `src/main/ipc/handlers.ts` |
| Preload bridge | `src/preload/index.ts` |
| Renderer UI | `src/renderer/src/{dashboard,explorer,console,settings,components}/` |
| Tests | `test/{unit,integration,e2e}/` |

## Testing strategy

- **Unit** (`vitest`): every parser against captured-style fixture strings
  (including malformed input), masking, path conversion, settings recovery,
  warnings rules, locale parity, terminal state machine.
- **Integration**: MCP server over real HTTP with the official SDK client,
  settings persistence round-trips, runner behavior.
- **E2E** (Playwright + Electron, fixture mode): the 19 scenarios from
  goal.md §18.3 — tray, two tabs only, console echo, hidden-runner absence,
  editor save, Copy for LLM, MCP call, locale switching, quit.
