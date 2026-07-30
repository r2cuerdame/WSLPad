# Releasing WSLPad

Releases are Windows NSIS installers published to GitHub Releases;
`electron-updater` picks them up automatically from installed apps.

## Prerequisites

- Windows with Node ≥ 20 and npm
- `gh` CLI authenticated for `r2cuerdame/WSLPad` (repo scope)

## Steps

1. **Version** — bump `version` in `package.json` (semver). The installed
   app's updater compares against the latest GitHub release tag.
2. **Verify**

   ```bash
   npm run typecheck
   npm run lint
   npm run test
   npm run test:e2e
   ```

3. **Build installer**

   ```bash
   npm run dist
   ```

   Outputs in `release/`:
   - `WSLPad-Setup-<version>.exe` — NSIS per-user installer
   - `WSLPad-Setup-<version>.exe.blockmap` — differential update data
   - `latest.yml` — update feed metadata (required by electron-updater)

4. **Smoke-test the installer** — install, check tray/dashboard/console,
   uninstall from Windows Settings, reinstall.
5. **Tag + publish**

   ```bash
   git tag v<version>
   git push origin main --tags
   gh release create v<version> \
     "release/WSLPad-Setup-<version>.exe" \
     "release/WSLPad-Setup-<version>.exe.blockmap" \
     "release/latest.yml" \
     --title "WSLPad <version>" --notes-file <notes>
   ```

   All three artifacts must be attached or auto-update will not work.

## Auto-update behavior (goal.md §4.3)

- Checks on app start and every 6 hours (toggle in Settings → Updates)
- Downloads in the background; never interrupts a running Console
- Installs on quit, or immediately via the "Restart and update" action
- Failures keep the current version
- Disabled entirely in development (`!app.isPackaged`)

## Code signing

v0.1.0 ships unsigned — Windows SmartScreen will warn on first run. For a
future release, provide `CSC_LINK`/`CSC_KEY_PASSWORD` env vars to
electron-builder or switch to Azure Trusted Signing.
