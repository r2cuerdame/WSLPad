# v1.2.0 private candidate evidence

The immutable candidate is draft release `405268106`, built from `c06b065d5bd4127fdce32b115677494761782a64` with `electron-vite build && electron-builder --win --publish never`. The asset IDs, sizes, SHA256 values, installer SHA512 from `latest.yml`, and signing policy are in `manifest.json`.

The issue/107 PR workflow downloads these exact draft assets with `contents:read` on an ephemeral `windows-latest` runner. It checks the manifest and exercises the public 1.1.2 installer to the original draft 1.2.0 installer through install, upgrade, uninstall, reinstall, and final cleanup. The manifest records its run and stage results after execution. Independent QA reruns at the exact PR head.

This PR does not publish the draft or change `releases/latest`.
