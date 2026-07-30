# WSLPad Security & Privacy Principles

WSLPad is local-first by design (goal.md §16).

## What WSLPad never does

- No cloud services, accounts, logins, or telemetry.
- No outbound network traffic except: GitHub Releases update checks/downloads
  (disable via Settings → Updates) and any URL the user explicitly clicks.
- Never executes a shell command the user did not submit: Dashboard/Explorer
  actions only *prepare* command text in the Console input.
- Never types a sudo password, never elevates on its own.
- Never stores credentials. The MCP auth token is a random UUID identifying
  the local server — not a credential for any external service.

## Renderer isolation

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The preload exposes a single typed API (`window.wslpad`); every IPC channel
  is enumerated in `src/shared/ipc.ts` and re-validated with zod in
  `src/main/ipc/handlers.ts` (distro names, absolute Linux paths, file names,
  URL schemes, numeric bounds).
- Navigation and `window.open` are denied; external links go through
  `shell.openExternal` after an http(s) check.
- CSP: `default-src 'self'` — no remote scripts/styles.

## Command injection defenses

- Distro names must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` before any spawn.
- In-distro scripts run via `wsl.exe --exec /bin/sh -c` (argv passed verbatim,
  no Windows shell, no Linux login-shell re-parsing).
- Every interpolated value goes through POSIX single-quote escaping
  (`shellQuote`), covering quotes, `$()`, backticks, globs, newlines, unicode.
- Paths are rejected if relative or containing NUL/newline; symlink-heavy
  operations use the target-aware `find`/`stat` primitives rather than
  string concatenation.

## Secrets

- Environment variables whose names contain KEY, TOKEN, SECRET, PASSWORD,
  PASS, AUTH, CREDENTIAL, COOKIE, PRIVATE, SESSION or BEARER are masked at
  collection time; the snapshot (and therefore the UI list, `Copy for LLM`,
  JSON export and every MCP response) never contains their values.
- The GUI "reveal" action fetches the raw value on demand in the main process
  and re-masks after a few seconds; MCP has no reveal.
- `GetTextFile` refuses `/proc`, `/sys`, `/dev`, binary files and private-key
  material (`-----BEGIN … PRIVATE KEY-----` is withheld entirely), masks
  `KEY=value` style lines, and caps file size.

## MCP exposure

- HTTP server binds to `127.0.0.1` only, rejects non-localhost `Origin`
  headers, and requires `Authorization: Bearer <local token>`.
- All tools are read-only `Get*`; there is no Run/Write/Delete/Set/Kill tool
  and no code path from the MCP layer to a mutating operation.
- Settings cannot weaken these rules — port and on/off are the only knobs.

## Reporting

This is a v0.1.0 hobby-scale project; please open a GitHub issue for any
security concern.
