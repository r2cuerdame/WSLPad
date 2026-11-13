# Changelog

## 1.2.0

- Stop console windows from flashing every second or two on Windows 11 with Windows Terminal as the default terminal. Each `wsl.exe -d` start makes WSL open a console for `wslhost.exe` that WSLPad's hidden-window flags cannot reach, and one dashboard tick used to start six of them. A tick's in-distro queries now share a single `wsl.exe`, the liveness probe and the installed-distro list reuse recent answers, and firewall, DNS, port-proxy, Defender and elevation reads are cached for minutes. Measured on Windows 11 build 26200 over 30 s: 70 → 13 wslhost consoles with the window on screen.
- Poll at the configured pace only while the window is on screen. Minimized, hidden or in the tray, the tiers stretch to at least 1 min / 5 min / 15 min (measured: 90 → 0 wslhost consoles in 30 s minimized), and anything stale refreshes the moment the window comes back.
- Start every child process through one module that enforces `windowsHide`, piped stdio, no shell and no detached console, and run PowerShell with `-NoProfile -NonInteractive -WindowStyle Hidden`. A lint rule and a regression test fail any launch that skips these rules.

- Add one versioned Developer Environment Context shared by `Copy for LLM → Agent context` and MCP, so both paths report the same bounded environment snapshot.
- Add the read-only MCP tools `GetDeveloperEnvironmentContext` and `GetEnvironmentDoctor`. The former returns the full context in Markdown and JSON; the latter returns Environment Doctor checks and prepared suggestions without running commands.
- Document the new context and tools in the MCP guide, architecture guide, and localized READMEs. The MCP catalog now contains 42 tools.
