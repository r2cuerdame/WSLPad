# WSLPad MCP Server

WSLPad runs a **read-only** Model Context Protocol server while it sits in the
tray, so LLM tools can inspect your WSL state without being able to change it.

## Endpoint

- Transport: Streamable HTTP
- URL: `http://127.0.0.1:<port>/mcp` (default port **4923**, configurable in
  Settings → MCP server)
- Bind: `127.0.0.1` only — never exposed to the network
- Auth: `Authorization: Bearer <token>` — token lives in your local settings
  and can be regenerated at any time (Settings → MCP → Regenerate token)
- Origin: non-localhost `Origin` headers are rejected

A stdio bridge is available for clients that spawn a process instead of
connecting over HTTP:

```text
WSLPad.exe --mcp-stdio
```

The bridge proxies stdio MCP to the resident app's HTTP server (WSLPad must be
running).

## Registering clients

Settings → MCP server offers one-click registration (the top bar keeps the
at-a-glance status badge):

- **Claude Desktop** — adds an `mcpServers.wslpad` entry
  (`claude_desktop_config.json`) using the stdio bridge.
- **Codex** — writes a marker-delimited `[mcp_servers.wslpad]` block into
  `~/.codex/config.toml`.
- **Hermes** — writes `~/.hermes/mcp_clients/wslpad.json` inside the selected
  distro with the HTTP endpoint and token.

`Copy config JSON` puts a generic HTTP client config on the clipboard:

```json
{
  "type": "http",
  "url": "http://127.0.0.1:4923/mcp",
  "headers": { "Authorization": "Bearer <token>" }
}
```

## Tools (all read-only)

| Tool | Returns |
| --- | --- |
| `GetDistros` | Registered WSL distributions with state/version/default |
| `GetSelectedDistro` | The distro WSLPad currently targets |
| `GetDashboardSnapshot` | The full dashboard snapshot (cached, masked) |
| `GetSystemInfo` | Kernel, hostname, user, HOME, shell, systemd, IP |
| `GetResourceUsage` | CPU, memory, swap, disks, load, process count |
| `GetImportantPaths` | Auto-detected important paths + Windows mappings |
| `GetConfigurationFiles` | wsl.conf/.wslconfig/rc files existence & paths |
| `GetInstalledTools` | Detected dev tools with versions and install method |
| `GetToolStatus` | One tool's detection detail (`{ tool }`) |
| `GetHermesStatus` | Hermes install/gateway/dashboard, connected messengers, profiles ("agents"), active sessions, scheduled jobs, ports/services |
| `GetEnvironment` | Env var names + masked values (secrets never raw) |
| `GetProcesses` / `GetProcess` | Process table / one PID |
| `GetServices` / `GetService` | systemd services / one unit |
| `GetPorts` | Listening ports, each marked with whether Windows also binds it |
| `GetDiskImage` | ext4.vhdx location, size on the Windows disk, reclaimable space |
| `GetWslSettings` | Declared vs effective .wslconfig and wsl.conf, with verdicts |
| `GetFirewall` | Hyper-V firewall state for the WSL virtual machine |
| `GetPortProxy` | Windows `netsh portproxy` rules, each judged against the distro's current address |
| `GetDocker` | Docker engine/client, context, images, containers and the `docker system df` breakdown including the build cache |
| `GetDns` | resolv.conf, generateResolvConf, DNS tunnelling, nameservers |
| `GetClock` | Windows time, distro time and the skew between them |
| `GetWarnings` | Current warnings (stopped distro, failed units, …) |
| `GetDirectory` | Directory listing (`{ path, showHidden? }`) |
| `GetDirectoryTree` | Bounded-depth subtree (`{ path, depth? ≤ 3 }`) |
| `GetFileInfo` | stat-level file properties |
| `GetTextFile` | Bounded text file content (see limits below) |
| `GetPathMapping` | Linux ↔ Windows path conversion (explicit failure) |
| `GetExplorerContext` | Path currently open in the Explorer tab |
| `GetConsoleContext` | Console distro/cwd/status |

There are deliberately **no** Run/Execute/Write/Delete/Copy/Move/Install/
Restart/Kill/Set/Apply/Fix tools (goal.md §11.3). An LLM can read state and
*propose* commands; only the user can run them, in the Console.

## GetTextFile limits

- Max 256 KiB, UTF-8/latin1 text only — binary content is refused
- `/proc`, `/sys`, `/dev` are refused
- Private key material is withheld entirely
- `NAME=value` lines with secret-like names are masked
- Known credential file paths add an explicit warning
