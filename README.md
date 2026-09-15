# WSLPad — WSL GUI, Dashboard, File Manager & Troubleshooting Tool for Windows

**English** · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> **See what WSL is actually doing — and why it is failing.**

WSLPad is an open-source **WSL GUI, WSL dashboard and WSL troubleshooting tool for Windows 10/11**. Unlike a basic WSL manager, it focuses on inspecting and explaining the environment you already use. It makes the invisible parts of Windows Subsystem for Linux visible: running distributions, CPU and memory, `ext4.vhdx` disk usage, `.wslconfig` and `wsl.conf`, ports, networking, Hyper-V firewall state, DNS, systemd services, installed developer tools, Docker, file paths, and more.

It also includes a **Windows ↔ WSL dual-pane file manager**, a real interactive terminal, environment diagnostics, recovery tools, USB/usbipd visibility, a safe VHDX relocation workflow, and a **read-only WSL MCP server for Claude, Codex and other LLM tools**.

![WSLPad Dashboard](docs/screenshots/dashboard.png)

## WSL troubleshooting: what WSLPad helps you solve

WSLPad is built around the questions WSL users repeatedly end up debugging by hand:

- **Why is WSL slow?** — See when a project or terminal is running under `/mnt/c` instead of the native Linux filesystem, inspect memory pressure, and identify disk consumers.
- **Why can’t Windows or my LAN reach a WSL port?** — See the listener, bind address, effective networking mode, Windows exposure, Hyper-V firewall state and a reachability verdict together.
- **Why didn’t `.wslconfig` or `wsl.conf` take effect?** — Compare declared values with what is actually active and see whether a restart is required, the key is unsupported, the section is wrong, or the setting is simply not in effect.
- **Where is `ext4.vhdx`, and why is it so large?** — See the image path, allocated size, Linux filesystem usage and reclaimable space.
- **Where did my WSL disk space go?** — Inspect package caches, journals, build caches, trash and Docker storage instead of guessing from `df` alone.
- **Which process owns port 3000 / 5173 / 8080?** — Filter WSL and Windows listeners by port or process and see whether the port is reachable.
- **Is a tool installed in WSL or accidentally resolving to Windows?** — Inspect 100+ developer tools, their paths, versions, install methods and filesystem side.
- **How do I copy files between Windows and WSL cleanly?** — Use a real dual-pane Windows/WSL file manager with permissions, symlinks, history, search and cancellable transfers.
- **Why did WSL stop responding after sleep, VPN or a network change?** — Use diagnostics and recovery guidance that keeps destructive actions last.
- **Can Claude or Codex inspect my WSL environment safely?** — Expose read-only MCP tools without giving the model run, write, kill or delete capabilities.

## Why WSLPad instead of another WSL manager?

Many WSL GUI tools focus on distribution lifecycle operations: install, start, stop, export or unregister a distro. WSLPad is deliberately different.

Its primary job is to **inspect, explain and troubleshoot the environment you already use**.

That means combining facts WSL normally leaves scattered across Windows, Linux, configuration files, the registry, networking layers and command-line tools into one place — and saying **why** something is slow, unreachable, stale, misconfigured or inconsistent instead of only showing raw state.

WSLPad does not silently “fix” your system. System-changing actions are prepared for review in the Console or copied as commands; you decide whether to run them.

## Core features

### WSL dashboard and environment inspection

The Dashboard exposes WSL state without requiring you to remember a chain of PowerShell, Linux and networking commands.

It covers:

- distro state, WSL/kernel versions, hostname, user, shell and uptime
- CPU, memory, swap, process count and disk usage
- `ext4.vhdx` location, allocation, sparse state and reclaimable space
- `.wslconfig` and `/etc/wsl.conf` declared vs effective values
- important Linux and Windows paths
- environment variables with secret-looking values masked
- systemd services and service logs
- WSL and Windows processes
- listening ports and reachability
- networking mode, DNS and Hyper-V firewall state
- Windows port forwarding rules and stale targets
- Docker engine/client, images, containers, build cache and data root
- installed AI CLIs, runtimes, package managers, compilers, cloud tools and utilities
- Windows download markers (`Zone.Identifier`)
- Windows Terminal profile state
- warnings for common WSL problems

### WSL network, localhost and port forwarding troubleshooting

A port being “open” inside Linux does not mean Windows or another machine can reach it.

WSLPad correlates:

- WSL listener address and port
- owning process
- Windows-side exposure
- NAT vs mirrored networking
- Hyper-V firewall state
- port forwarding rules
- DNS configuration

Each listener gets a reachability verdict such as **LAN reachable**, **this PC only**, **WSL only**, **unreachable** or **unknown**, with the reason shown instead of guessed.

![Ports](docs/screenshots/ports.png)

### `.wslconfig` and `wsl.conf` changes not applying

WSL configuration is split across Windows and Linux, and many changes only apply after restarting the WSL VM.

WSLPad shows the configured value next to the effective value and classifies the result as applied, restart needed, not set, unsupported, unknown key or wrong section. It also shows the networking mode you requested versus the mode actually running.

![WSL settings](docs/screenshots/wslconfig.png)

### WSL disk space, `ext4.vhdx` and VHDX storage analysis

`df` inside Linux does not tell you how much space the WSL virtual disk is consuming on Windows.

WSLPad shows:

- the real `ext4.vhdx` location
- logical and allocated image size
- whether the image is sparse
- filesystem usage inside the distro
- reclaimable space
- major disk consumers such as package caches, journals, build caches, trash and Docker

![Disk image](docs/screenshots/disk.png)

### Windows ↔ WSL file manager

![Explorer](docs/screenshots/explorer.png)

Explorer is a real dual-pane file manager: **Windows drives on the left, the selected WSL distro on the right**.

Both panes have navigation history, breadcrumbs, path bars, search, sorting, file/folder creation, rename, copy/cut/paste and trash. The WSL pane also shows Linux owner/group, permissions and symlink targets.

Cross-filesystem transfers are copy-only by design, show progress and can be cancelled. Text files can be opened in the built-in editor with line numbers, search, save and JSON formatting.

### Interactive WSL terminal for Windows

WSLPad includes a real PTY-backed shell per distro with bash/zsh, colors, Ctrl+C, tab completion, vim, htop and SSH support.

When you navigate the WSL file pane, the Console follows the same directory without adding visible `cd` commands to your shell history. Internal WSLPad queries use a separate hidden runner, so your terminal transcript only contains commands you actually ran.

### Environment Doctor and Developer Profiles

Environment Doctor checks common WSL workspace health problems and presents the findings without auto-changing the machine.

Developer Profiles group common **Web, Python, Rust, AI and container/Kubernetes** workflows around the tools they normally need, using WSLPad’s existing discovery model to show what is installed and what is missing.

### Recovery, backup, clone and relocation

The Recovery workspace covers backup, restore, clone, relocation and verification history with explicit safety gates.

The relocation workflow helps move a WSL distro off a full C: drive while checking destination headroom, backup integrity and the default Linux user. WSLPad never silently unregisters, deletes or overwrites an existing distro.

### USB / usbipd visibility

WSLPad can inspect USB/usbipd device state and prepare bind, attach and detach commands for review. Devices are never automatically taken away from Windows.

### Diagnostics and remote recovery

![Diagnostics](docs/screenshots/diagnostics.png)

A session-only diagnostic timeline connects sleep/resume, distro responsiveness, DNS changes, networking mode changes and Console recovery events.

For VS Code Remote / WSL failures, WSLPad identifies only proven VS Code Server processes and keeps the recovery ladder least-destructive first: reload the editor, restart measured server processes, terminate one distro, then use `wsl --shutdown` only as a last resort.

### Docker in WSL and developer tool visibility

WSLPad detects developer tooling inside the selected distro and shows where each command really resolves.

Docker gets its own inspection surface for engine/client versions, context, data root, images, containers and `docker system df` — including build cache. Remote Docker contexts are not contacted automatically.

![Docker](docs/screenshots/docker.png)

WSLPad also has dedicated visibility for tools such as Hermes and OpenClaw when they are present.

## Read-only WSL MCP server for Claude and Codex

While WSLPad is running it serves MCP locally at:

```text
http://127.0.0.1:4923/mcp
```

The server uses Streamable HTTP, localhost-only binding and Bearer-token authentication. It exposes **40 read-only `Get*` tools**, including environment snapshots, ports, installed tools, command resolution and text-file inspection.

There are deliberately **no MCP write, run, kill or delete tools**. Private keys and secret values are not exposed across the MCP boundary.

One-click registration is available for Claude Desktop, Codex and Hermes. `Copy for LLM` creates a masked Markdown summary of the current WSL environment.

See [docs/MCP.md](docs/MCP.md) for the tool list and protocol details.

## Safety model

WSLPad is intentionally conservative around system changes.

- Dashboard inspection is read-only.
- MCP is read-only by construction.
- Dangerous operations are not silently executed.
- Actions such as service restarts, privileged edits, cleanup, USB changes or recovery steps are prepared in the Console or copied for review.
- Unknown state is displayed as **unknown** rather than guessed.

The goal is to make WSL easier to understand without becoming another background tool that changes your machine behind your back.

## Install WSLPad on Windows

### Direct download

Download the latest `WSLPad-Setup-<version>.exe` from [GitHub Releases](https://github.com/r2cuerdame/WSLPad/releases/latest) and run it.

- Windows 10/11 x64
- per-user install under `%LOCALAPPDATA%\Programs\WSLPad\`
- no administrator rights required for normal installation
- tray app with optional Windows startup
- automatic update checks through GitHub Releases

> **Windows SmartScreen:** current installers are unsigned, so Windows may show an “Unknown publisher” warning on first launch. Use **More info → Run anyway** only if you downloaded the installer from this repository’s official Releases page.

WSL itself is optional at startup; if no distro is available, WSLPad shows setup guidance instead of crashing.

### WinGet

The WinGet package submission is tracked in [microsoft/winget-pkgs#422317](https://github.com/microsoft/winget-pkgs/pull/422317). Until the community repository entry catches up with current releases, GitHub Releases is the recommended way to install the latest version.

Once the package is available in the community repository:

```powershell
winget install r2cuerdame.WSLPad
```

### CLI flags

```text
WSLPad.exe              Launch or focus the GUI
WSLPad.exe --hidden     Launch directly into the system tray
WSLPad.exe --mcp-stdio  Stdio bridge for local MCP clients
```

## Languages

WSLPad ships complete UI translations for **9 languages**:

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Français
- Deutsch
- Português do Brasil

Windows language detection is automatic with English fallback. Linux commands, paths and technical names remain untranslated.

## Privacy and telemetry

WSLPad has no account system and no cloud dependency for its WSL inspection features. Environment data, file paths, terminal commands, ports, configuration contents and MCP data stay local unless you explicitly export or copy them.

Packaged production builds send a **minimal PurplePulse heartbeat at most once per local day** to estimate active installations. The payload contains:

- a random persistent install ID
- WSLPad version
- OS (`windows`)
- platform (`electron`)

Development and QA runs do not send production telemetry. The heartbeat does **not** include WSL contents, file paths, environment variables, terminal commands, IP addresses, ports, distro names, project names or secrets.

See [docs/SECURITY.md](docs/SECURITY.md) for the broader security model.

## Development

```bash
npm install          # or npm ci
npm run dev          # electron-vite development build
npm run typecheck    # strict TypeScript checks
npm run lint         # ESLint
npm run test         # unit + integration tests
npm run build        # production build
npm run test:e2e     # Playwright Electron E2E
npm run dist         # NSIS installer + blockmap
```

The v1.1.1 release was verified with:

- TypeScript typecheck: passed
- ESLint: passed
- unit/integration: **1,614 passed**
- Playwright E2E: **52 passed**
- installer lifecycle smoke: install, launch, uninstall and reinstall passed
- WinGet manifest validation: passed

`WSLPAD_FIXTURE_MODE=1` runs the application against a deterministic in-memory WSL world for CI and E2E testing.

Architecture and release details:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RELEASING.md](docs/RELEASING.md)

## Non-goals

WSLPad is **not** an IDE, Docker Desktop replacement, Git client, AI chat application or autonomous system fixer.

It also is not primarily a distro marketplace. If all you need is a button to install/start/stop distributions, a conventional WSL manager may be a better fit.

WSLPad’s identity is:

**WSL dashboard + troubleshooting + Windows/WSL file manager + terminal + recovery tools + read-only MCP.**

## Current limitations (v1.1.1)

- Windows x64 only; the installer is currently unsigned.
- Some disk-image information requires access to the Windows registry and `fsutil`.
- Effective networking-mode detection requires modern WSL builds with `wslinfo`; older builds may report unknown.
- Hyper-V firewall information is only available on Windows builds that expose that layer.
- Trend history is kept in memory and resets when WSLPad exits.
- Console automatic cwd sync currently targets bash and zsh.
- Cross-pane Windows ↔ WSL transfers are copy-only by design.
- External Windows Explorer drag-in depends on Electron exposing file paths; the built-in Windows pane and Import flow are the reliable path.
- The MCP stdio bridge requires the tray application to be running.

## Roadmap

Current directions include:

- VHDX shrink/expand commands prepared safely for the Console
- ARM64 builds
- signed Windows installer

## Community

Questions and ideas belong in [GitHub Discussions](https://github.com/r2cuerdame/WSLPad/discussions). Bugs belong in the [issue tracker](https://github.com/r2cuerdame/WSLPad/issues/new/choose), and security concerns can be reported through a [private security advisory](https://github.com/r2cuerdame/WSLPad/security/advisories/new).

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a)
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas)
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell)
- [CONTRIBUTING](.github/CONTRIBUTING.md)

## License

MIT
