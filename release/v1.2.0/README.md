# v1.2.0 private candidate evidence

The immutable candidate is draft release `405268106`, built from `c06b065d5bd4127fdce32b115677494761782a64` with `electron-vite build && electron-builder --win --publish never`. The asset IDs, sizes, SHA256 values, installer SHA512 from `latest.yml`, and signing policy are in `manifest.json`.

The issue/107 PR workflow is scoped to this branch and uses `contents:read` on an ephemeral `windows-latest` runner. Its first run, [37555666965](https://github.com/r2cuerdame/WSLPad/actions/runs/37555666965/job/112581196251), failed while reading draft release `405268106`: HTTP 403, `Resource not accessible by integration`. The candidate was not downloaded, so the lifecycle stages and independent QA have not run. The manifest records that failure and each unrun stage. This is a blocked candidate, not a PASS.

This PR does not publish the draft or change `releases/latest`.
