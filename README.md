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

Pick a section on the left, read it on the right — fourteen of them, from the
overview to warnings. Tables get the full window instead of a cramped card, and
the list carries live badges. The full inventory is
[below](#what-you-can-actually-see); four sections deserve calling out because
they answer questions WSL itself leaves unanswered:

**Disk image** — your distro's `ext4.vhdx` grows and never shrinks, and `df`
inside Linux reports a fictional maximum. WSLPad shows where the image really
is, what it holds on your Windows disk, what the distro actually uses inside,
and how much is reclaimable.

![Disk image](docs/screenshots/disk.png)

**WSL settings** — WSL accepts a config and silently ignores half of it. Every
key from `.wslconfig` and `wsl.conf` is shown with its declared value, the
value actually in force, and a verdict: applied, restart needed, wrong section,
unknown key, or unsupported on this build. Including the networking mode you
asked for versus the one you got. The two files live on two different machines
and are edited in two different places, so you read one at a time — the switch
carries each file's declared count and flags the one needing attention.

![WSL settings](docs/screenshots/wslconfig.png)

**Network** — the Hyper-V firewall your Windows Firewall window never shows,
which is on by default and silently drops inbound traffic to WSL, plus a name
resolution block that puts `/etc/resolv.conf`, `generateResolvConf`, DNS
tunnelling and the Windows adapter's servers side by side — so "Temporary
failure in name resolution" has one place to look.

**Ports** — a WSL listener is marked `WSL`, or `WSL + Windows` when it is
genuinely reachable from Windows, and each one now carries a **reachability
verdict**: reachable from the LAN, from this PC only, inside WSL only, or
unreachable — with the reason, derived from the bind address, the effective
networking mode and the firewall. When the facts aren't readable WSLPad says
*unknown* instead of guessing. A busy machine lists hundreds of listeners, so
there is a port range and a process-name filter — "who holds 5173" is a
question, not a scrolling exercise.

![Ports](docs/screenshots/ports.png)

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

It also recovers on its own. WSL is often still busy when WSLPad starts with
Windows, and a shell that could not be started is now reported as exactly that
— **with the reason** — instead of a misleading "distribution stopped". Once
the distro reads as running the Console retries without being asked, and if it
still cannot start, a retry button stays there. Restarting the app is never the
answer.

## MCP server (read-only)

While WSLPad sits in the tray it serves MCP at `http://127.0.0.1:4923/mcp`
(Streamable HTTP, localhost-only, Bearer-token auth) with 29 `Get*` tools —
`GetDashboardSnapshot`, `GetInstalledTools`, `GetPorts`, `GetTextFile`,
`GetPathMapping`, … There are deliberately no write/run/kill tools; secrets
and private keys never cross the MCP boundary. One-click registration for
Claude Desktop (stdio bridge), Codex and Hermes, plus `Copy for LLM` which
puts a masked Markdown state summary on your clipboard.
Details: [docs/MCP.md](docs/MCP.md).

## What you can actually see

Every item below is read from your machine and shown as-is. Nothing here
changes anything; where an action exists it is written into the Console for you
to run.

**Overview** — distro name, state, WSL version, default flag, OS pretty name,
kernel, hostname, user, `$HOME`, login shell, uptime, whether systemd is on,
the distro IP, the `\\wsl.localhost\…` path for Windows, and the clock skew
between Windows and the distro — the invisible cause of sudden apt and TLS
failures after the host sleeps.

**Resources** — live CPU %, memory used/total, swap, disk usage for `/`,
`/home` and `/mnt/c`, load average, process count, and trend sparklines so a
number answers "is this climbing?". Plus the **memory
reconciliation**: host RAM, the VM ceiling (and whether you set it or WSL
computed it), what Windows currently holds for the VM, and the in-guest
used / cache / free / swap split — so "vmmem is eating 7 GB" resolves into
"most of that is reclaimable page cache".

**Disk image** — where `ext4.vhdx` actually lives on your Windows disk, its
logical size, how much is really allocated, whether it is sparse, the
filesystem size and usage inside the distro, and how much is reclaimable.

**WSL settings** — every key from `.wslconfig` and `/etc/wsl.conf` with its
declared value, the value actually in force, its provenance (you set it, it is
the WSL default, or it was computed from your hardware), and a verdict:
applied, restart needed, not set, unknown key (typo), wrong section, or
unsupported on this build. Includes the networking mode actually running versus
the one you asked for, and a banner when the VM predates your last edit.

**Important paths** — `$HOME`, `/etc`, `/usr/local/bin`, `~/.local/bin`,
`~/.config`, `~/.cache`, `~/.ssh`, `~/.hermes`, the Windows user profile as
seen from Linux — each with existence, both Linux and Windows spellings, and
which side of the filesystem boundary it is on (native ext4 or across the slow
Windows mount).

**Configuration files** — `.wslconfig`, `/etc/wsl.conf`, `/etc/fstab`,
`~/.bashrc`, `~/.profile`, `~/.zshrc`, `~/.config`, `/etc/environment`: where
each one is and whether it exists, is readable and is writable.

**Installed tools** — 86 tools in 11 categories (AI CLIs, runtimes, package
managers, version control, containers, cloud, build, databases, editors &
shell, media, utilities), each with installed state, resolved path, version,
install method, config paths, running process count, which side of the
filesystem boundary it lives on, and — importantly — whether the command
actually resolves to a **Windows** binary under `/mnt/c` instead of one
installed in the distro.

**Hermes** — executable, data dir, virtualenv, config, gateway state, **which
messengers it is actually connected to**, the profiles you'd call agents (with
the current one marked), active sessions, scheduled jobs, dashboard state and
address, MCP server count, ports, user services and log paths. The messenger
and profile facts come from Hermes' own read-only CLI; when it cannot be asked
the row says *unknown* rather than "none configured". Not running the web
dashboard? The command to start it is prepared in the Console.

![Hermes](docs/screenshots/hermes.png)

**Environment** — every variable with its length and flags (PATH-like, came
from Windows). Secret-looking names are masked; reveal is a deliberate click.

**Processes** — PID, user, CPU %, memory %, elapsed time, full command line.

**Services** — every systemd unit with scope, load/active/sub state, enabled
state and description — and for ~71 well-known units, a plain-language
explanation of what it is and whether it normally runs.

**Ports** — protocol, address, port, PID, process, listening state, the
source (`WSL`, `Windows`, `WSL + Windows`), and a reachability verdict with its
reason: reachable from the LAN, from this PC only, inside WSL only, unreachable,
or unknown. Filter by port range and by process name — the name search looks at
both the WSL process and the Windows one holding the same port.

**Network** — the Hyper-V firewall state for the WSL virtual machine (enabled,
default inbound and outbound action, loopback exemption, rule count) and name
resolution: whether `/etc/resolv.conf` is the generated symlink or hand-edited,
the effective `generateResolvConf`, DNS tunnelling, the nameservers in force,
and what the Windows adapter hands out.

**Warnings** — stopped distro, systemd off, low disk, failed units, port
conflicts, background query failures, MCP problems.

**Explorer** — per file: name, size, modified time and, on the WSL side, owner,
group, Linux permissions and symlink targets. Per drive on the Windows side:
free and total space.

**Console** — the distro, the current directory, and the shell state (ready,
running, waiting for input, waiting for a sudo password, disconnected,
distribution stopped, or could not start — the last one with the reason).

**Over MCP** — all of the above through 29 read-only `Get*` tools.
[docs/MCP.md](docs/MCP.md)

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

> The installer is unsigned — SmartScreen will ask once ("More info" → "Run anyway").

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

## Current limitations (v0.1.5)

- Windows x64 only; installer is unsigned (SmartScreen warning)
- Disk-image numbers need the Windows registry and `fsutil`; if either is
  unreadable the section says so rather than guessing
- Effective networking mode needs `wslinfo` (WSL 2.0.4+); older builds show it
  as unknown
- The Hyper-V firewall layer only exists on recent Windows builds; where it is
  absent WSLPad reports unknown rather than "disabled"
- Trend sparklines live in memory only — history resets when you close the app,
  by design: a tray companion is not a monitoring agent
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

Next: agent-grade MCP tools shaped around the questions an agent actually asks
(path mapping, who owns a port, which binary resolves), a Trash restore UI, a
read-only service log view, an ARM64 build and a signed installer.

## License

MIT
