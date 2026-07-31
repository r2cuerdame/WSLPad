# Security Policy

## Supported versions

The latest release. WSLPad is at 0.x and moves fast; fixes go into the next
release rather than into patches of older ones.

## Reporting a vulnerability

Please **do not open a public issue.** Use
[a private security advisory](https://github.com/r2cuerdame/WSLPad/security/advisories/new)
instead. Expect a first reply within a few days — this is a hobby-scale
project with one maintainer, so it is not a 24-hour desk, but security reports
go to the front of the queue.

Include what you would want if you were fixing it: the version, what you did,
and what you got. A proof of concept is welcome; please do not include real
credentials from your own machine in it.

## What is in scope

WSLPad reads your entire WSL environment and runs an MCP server, so the
interesting surface is bigger than the UI:

- **The MCP server** — it binds `127.0.0.1` only, requires a Bearer token and
  validates `Origin`. Anything that reaches it without the token, from another
  origin, or from off-machine, is in scope.
- **Read-only enforcement** — MCP exposes `Get*` tools only. A path by which
  MCP, an export, or an LLM-facing surface causes a write, a spawn, or a state
  change is in scope, and is serious.
- **Command injection** — distro names, paths and file names all cross into
  `wsl.exe` and PowerShell invocations. A name that escapes its argument is in
  scope.
- **Secret leakage** — values whose names look like credentials are masked at
  collection. A path by which an unmasked secret reaches an export, a
  clipboard payload, an MCP response or a log is in scope.
- **Renderer isolation** — `contextIsolation`, `sandbox`, CSP and the preload
  API surface.
- **The updater** — anything that lets a non-GitHub artifact be installed.

## What is not in scope

- The SmartScreen warning on the unsigned installer. It is expected: the
  installer is not code-signed yet, and that is stated in the README.
- Anything requiring an attacker who already has your Windows user session.
  WSLPad shows that user what they could already read themselves.
- Reports that WSLPad "can see" your environment. That is its entire purpose;
  the question is only ever whether it lets something *else* see it.

The full design principles — what WSLPad never does, how isolation and masking
are implemented — are in [docs/SECURITY.md](../docs/SECURITY.md).
