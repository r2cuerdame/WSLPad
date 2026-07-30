# WSLPad

**English** · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

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

### Dashboard — read-only state, section by section

Pick a section on the left, read it on the right: overview, live
CPU/memory/disk, important paths, configuration files, auto-detected dev
tools, a dedicated Hermes section, environment variables (secrets masked),
processes, services, ports and warnings. Tables get the full window instead of
a cramped card, and the list carries live badges (process count, open ports,
warning count, Hermes status).

The **Ports** section shows both sides of every port: a WSL listener is marked
`WSL`, or `WSL + Windows` when it is genuinely reachable from Windows (with the
Windows process holding it — usually `wslrelay` under NAT networking).
Windows-only listeners are listed too and can be toggled off. When the host
port table can't be read, WSLPad says so instead of claiming "not reachable".

The Dashboard never executes anything. Buttons like *kill*, *restart service*
or *sudoedit* only **prepare** the command in the Console input — you review,
edit and press Enter.

![Explorer](docs/screenshots/explorer.png)

### Explorer — Windows on the left, WSL on the right

A real dual-pane file manager: your **Windows** drives on the left, the
selected **WSL distro** on the right, with a draggable splitter between them.
Copying between the two is the point — drag across, or hit *Copy to the other
pane* — and every transfer reports progress and can be cancelled. A transfer
never deletes its source.

Each pane has its own history, breadcrumb, path bar, search, optional lazy
folder tree, sortable list, new file/folder, inline rename (F2),
copy/cut/paste, and Delete → Trash with Shift+Delete for permanent removal.
The WSL pane additionally shows owner/group/Linux permissions and symlink
targets, and offers the four path-copy variants; privileged operations aren't
faked with sudo — the right command is prepared in the Console instead.
Double-click any text file on either side to open the built-in editor overlay
(line numbers, find, Ctrl+S, JSON formatting).

### Console — a real shell, always at hand

A genuine interactive PTY session per distro (bash/zsh, colors, Ctrl+C, tab
completion, vim/htop/ssh all work) docked at the bottom of every tab.
Right-click pastes — or copies the selection when there is one — the way every
other terminal behaves. When you navigate the WSL pane in Explorer the Console
follows to the same directory — without a visible `cd`, without polluting your
shell history. Only commands
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
font/scrollback, update checks, reset-all — and the full **MCP panel**: status,
copy endpoint, copy config JSON, one-click registration for Codex / Claude
Desktop / Hermes, connection test and token regeneration.

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

## Current limitations (v0.1.1)

- Windows x64 only; installer is unsigned (SmartScreen warning)
- The detected-tool catalog is still the original 18 entries; a much larger,
  categorised catalog is queued for 0.1.2
- Console cwd-sync requires bash or zsh as the default shell (other shells
  work, just without automatic path sync)
- Copying *between* the panes never moves: cross-filesystem transfers are
  copy-only by design, so nothing is deleted if a transfer fails
- Dragging in from an external Windows Explorer window depends on Electron
  exposing file paths; use the left pane (or the Import menu) instead
- Trash restore UI not yet included (files land in the standard Linux Trash /
  Windows Recycle Bin, restorable from there)
- MCP stdio bridge requires the tray app to be running

## Roadmap

Next up (0.1.2): a much larger categorised tool catalog, per-distro icons in
the Explorer panes, and a Trash restore UI. Later: per-distro console profiles,
a service log viewer, an ARM64 build, a signed installer.

## License

MIT
