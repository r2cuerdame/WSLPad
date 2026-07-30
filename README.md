# WSLPad

> A small Windows companion for WSL.

WSLPad is a resident Windows tray app that makes the invisible parts of your
WSL setup visible: which distros are running, where your tools live, what's
listening on which port — plus a real file explorer, an interactive console,
and a **read-only MCP server** so your LLM tools can inspect (never modify)
your environment.

![WSLPad Dashboard](docs/screenshots/dashboard.png)

## Why

Install Hermes, Codex, Claude, Docker, Node or Python inside WSL and suddenly
nothing is visible from Windows anymore: install paths, config files,
environment variables, services, ports, systemd state, or how Linux paths map
to Windows paths. WSLPad structures all of that into a dashboard, an explorer
and an MCP surface — without ever changing your system behind your back.

## The three surfaces

### Dashboard — read-only state

Card-based overview of the selected distro: system info, live CPU/memory/disk,
important paths, configuration files, 18 auto-detected dev tools (with a
dedicated Hermes card), environment variables (secrets masked), processes,
services, ports and warnings.

The Dashboard never executes anything. Buttons like *kill*, *restart service*
or *sudoedit* only **prepare** the command in the Console input — you review,
edit and press Enter.

![Explorer](docs/screenshots/explorer.png)

### Explorer — real file work

Windows-Explorer-style UX inside WSL: lazy folder tree, sortable file list
with owner/permissions/symlinks, breadcrumb + path bar + search, new
file/folder, inline rename (F2), copy/cut/paste, drag & drop,
Windows ↔ WSL import/export with progress, freedesktop-compliant Trash
(Shift+Delete = permanent, with confirmation), a built-in text editor overlay
(line numbers, find, Ctrl+S, JSON formatting) and Linux/Windows path copying
everywhere. Privileged operations aren't faked with sudo — the right command
is prepared in the Console instead.

### Console — a real shell, always at hand

A genuine interactive PTY session per distro (bash/zsh, colors, Ctrl+C, tab
completion, vim/htop/ssh all work) docked at the bottom of every tab.
When you navigate in Explorer the Console follows to the same directory —
without a visible `cd`, without polluting your shell history. Only commands
**you** run appear in the transcript; WSLPad's internal queries are executed
by a separate hidden runner.

## MCP server (read-only)

While WSLPad sits in the tray it serves MCP at `http://127.0.0.1:4923/mcp`
(Streamable HTTP, localhost-only, Bearer-token auth) with 23 `Get*` tools —
`GetDashboardSnapshot`, `GetInstalledTools`, `GetPorts`, `GetTextFile`,
`GetPathMapping`, … There are deliberately no write/run/kill tools; secrets
and private keys never cross the MCP boundary. One-click registration for
Claude Desktop (stdio bridge), Codex and Hermes, plus `Copy for LLM` which
puts a masked Markdown state summary on your clipboard.
Details: [docs/MCP.md](docs/MCP.md).

## Settings & languages

The gear (top-right, always available) opens a settings drawer — never a third
tab: language, theme (system/light/dark), start with Windows, monitoring
pause + fast/medium/slow polling intervals, Explorer defaults, Console
font/scrollback, MCP port/token, update checks, reset-all.

WSLPad ships complete UI translations for **9 languages** — 한국어, English,
日本語, 简体中文, 繁體中文, Español, Français, Deutsch, Português do Brasil —
with automatic Windows-language detection and English fallback. Linux
commands, paths and technical names are never translated; locale bundles are
bundled offline with enforced key parity.

## Install

Download `WSLPad-Setup-<version>.exe` from
[Releases](https://github.com/r2cuerdame/WSLPad/releases) and run it — no
admin rights needed (per-user install). WSLPad starts with Windows by default
(toggle in the tray or Settings), lives in the tray, and auto-updates from
GitHub Releases. Closing the window hides it; *Quit* in the tray menu exits.

> v0.1.0 is unsigned — SmartScreen will ask once ("More info" → "Run anyway").

Requirements: Windows 10/11 x64. WSL is optional — without it WSLPad shows a
setup hint instead of crashing.

## Develop

```bash
npm install          # deps (node-pty ships prebuilt N-API binaries)
npm run dev          # electron-vite dev with HMR
npm run typecheck
npm run lint
npm run test         # vitest unit + integration
npm run test:e2e     # Playwright Electron E2E (fixture mode, no WSL needed)
npm run dist         # NSIS installer into release/
```

`WSLPAD_FIXTURE_MODE=1` runs the full app against a deterministic in-memory
WSL world — that's what CI and E2E use. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/RELEASING.md](docs/RELEASING.md).

## Privacy & security

Local-first: no cloud, no accounts, no telemetry. MCP binds to localhost with
token auth and is read-only by construction. Nothing executes without your
Enter. Full principles: [docs/SECURITY.md](docs/SECURITY.md).

## Non-goals

WSLPad is *not* a distro manager/marketplace, not Docker Desktop, not an IDE,
no Git UI/debugger/LSP, no cloud sync, no AI chat, no auto-fixing. Identity:
**Dashboard + Explorer + Console + read-only MCP** — nothing else.

## Current limitations (v0.1.0)

- Windows x64 only; installer is unsigned (SmartScreen warning)
- Console cwd-sync requires bash or zsh as the default shell (other shells
  work, just without automatic path sync)
- Dropping files *from* Windows Explorer directly onto the file list depends
  on Electron file-path availability; the Import menu is the reliable path
- Trash restore UI not yet included (files land in the standard Linux Trash,
  restorable from within WSL)
- MCP stdio bridge requires the tray app to be running

## Roadmap ideas

Trash restore UI, per-distro console profiles, service log viewer, ARM64
build, signed installer, portable diagnostics export.

## License

MIT
