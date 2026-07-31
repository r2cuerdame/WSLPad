# Contributing to WSLPad

Thanks for being here. WSLPad is a small, deliberately opinionated tray app,
and most of its opinions are about what it *refuses* to do. Those refusals are
the part a contribution most easily breaks, so they come first.

## Where things go

| You have | Take it to |
| --- | --- |
| A question | [Discussions → Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a) |
| An idea for a feature | [Discussions → Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas) |
| Something WSLPad gets wrong | [a bug report](https://github.com/r2cuerdame/WSLPad/issues/new/choose) |
| A security concern | [a private advisory](https://github.com/r2cuerdame/WSLPad/security/advisories/new) |
| Your setup, a screenshot | [Discussions → Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell) |

Post in any language WSLPad ships in — English, 한국어, 日本語, 简体中文,
繁體中文, Español, Français, Deutsch, Português (Brasil). A rough translation
of a real problem beats silence.

## The four rules a pull request must not break

These are not style preferences. A change that breaks one of them will be
asked to change, however good the rest of it is.

1. **WSLPad never changes system state on its own.** Every mutating action —
   install, restart, `sudo`, shutdown, a `netsh` edit — is *prepared* as text
   in the Console input for the user to read and press Enter on. No action
   runs a command the user did not submit. ([goal.md](../goal.md) §2.2)
2. **Unknown, never zero.** A value that cannot be read is `null` and renders
   as *unknown*. Never fall back to `0`, `false`, `none` or an empty list: a
   confident wrong number is worse than an honest gap.
3. **Never parse a localized word.** WSL, `netsh`, `systemctl` and `docker`
   all translate their output. Parse by position, by shape, or by an ASCII
   marker you printed yourself — never by matching "Running" or "Address".
   (This is the single most common source of bugs in comparable tools.)
4. **Secrets never leave the collector.** Values whose names look like
   credentials are masked where they are read, before they reach any renderer,
   export or MCP response. MCP is read-only: `Get*` tools only.

## Working on it

```sh
npm install
npm run dev          # electron-vite dev
npm run typecheck    # both tsconfigs, strict
npm run lint
npm test             # vitest, ~1250 unit tests
npm run test:e2e     # playwright, packaged-app smoke
npm run dist         # electron-builder --win
```

Requires Windows with WSL installed, and Node 20+.

Before you open a PR: `npm run typecheck && npm run lint && npm test` must all
be green. A red test is never shipped, and never "fixed" by deleting the test.

## Tests

Every behaviour change comes with a test. The shape that works well here:
parsing and judgement live in small exported functions that take a string and
return data, so a test can hand them real captured output — including output
from a non-English Windows. `test/unit/wsl/portproxy.test.ts` is a good
example to copy: it feeds the parser a Korean `netsh` table and expects the
same result as the English one.

## Commits

Conventional-ish and lowercase: `feat:`, `fix:`, `docs:`, `refactor:`,
`test:`. The subject line says what the user can now do, not what the code now
contains — `feat: the update section says where the update actually is`, not
`feat: add updateLocation field`.

## Translations

Nine locales live in `src/renderer/src/i18n/`, and a test enforces key parity —
add a key to one, add it to all nine. If you speak one of them natively and a
string reads badly, that is a welcome PR on its own; machine translation got us
the first draft, and it shows in places.
