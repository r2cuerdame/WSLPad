# v1.2.0 private candidate evidence

The immutable candidate is draft release `405268106`, built from `c06b065d5bd4127fdce32b115677494761782a64` with `electron-vite build && electron-builder --win --publish never`. The asset IDs, sizes, SHA256 values, installer SHA512 from `latest.yml`, and signing policy are in `manifest.json`.

The first workflow run, [37555666965](https://github.com/r2cuerdame/WSLPad/actions/runs/37555666965/job/112581196251), received HTTP 403 when its `contents:read` token tried to read draft release `405268106`. GitHub's repository role table grants draft viewing to write roles. The workflow now uses `contents:write`; [run 37701562990](https://github.com/r2cuerdame/WSLPad/actions/runs/37701562990/job/113065975152) downloaded all three original draft assets and matched their sizes and SHA256 values. The installer SHA512 in `latest.yml` and unsigned status also matched. The same run used an ephemeral Windows runner with zero WSL distributions for the 1.1.2 → original 1.2.0 install, upgrade, uninstall/reinstall, and final cleanup; each stage passed. The manifest records the run and stage summaries. Independent QA of the final PR head remains separate.

This PR does not publish the draft or change `releases/latest`.
