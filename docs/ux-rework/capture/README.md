# Screenshot capture

These scripts produced the screenshots for the UX review of 0.9.0. Re-run them at the end of each phase to give the
fresh review its evidence. They drive the installed Google Chrome with `playwright-core`, which is **not** a dependency
of the repo. Install it somewhere outside the repo.

```bash
# once, outside the repo
mkdir -p /tmp/ux-capture && cd /tmp/ux-capture && npm init -y && npm i playwright-core@1.56.1

# the dev server (ignore-scripts is on, so copy the game data by hand)
cd clock-generator-ui && node scripts/copy-factorio-data.mjs && npm run dev -- --port 5199 --strictPort

# the walkthrough: writes PNGs, .aria.yml snapshots and INDEX.md into <out dir>
NODE_PATH=/tmp/ux-capture/node_modules node docs/ux-rework/capture/capture.mjs <out dir>
NODE_PATH=/tmp/ux-capture/node_modules node docs/ux-rework/capture/capture-extra.mjs <out dir> <next shot number>
```

If Node does not pick up `NODE_PATH` for ES modules, copy the scripts into `/tmp/ux-capture` and run them from there.

- `capture.mjs` walks through the states at 1440×900:
  - first visit
  - the ⋮ menu and Paste from Factorio
  - an imported build, in the List and the Diagram, with the editors
  - Validate and Generate
  - every Results tab
  - copy, and an edit after generating.
- `capture-extra.mjs` covers the narrow window, a broken build and a fuel build. It appends to `INDEX.md`.
- Both use the sample configs in `clock-generator/resources/config-samples/` by absolute path, and find elements by
  their 0.9.0 labels ("Validate", "Generate", "Advanced Overrides"…) and, for the enable rule of an inserter, the
  chip's name (`/, Inserter \d+\. Edit rule$/`, which replaced the gear's "Configure Enable Control"). **Update the
  selectors as the rework changes the UI**, and add the 960px and 720px passes the plan asks for.
- `capture-enable-chip.mjs <out dir> <before|after> [port]` checks the enable chip (item 1.13) at 1440px and 720px.
  `before` runs against the gear icon of 0.9.0; `after` runs the whole sequence and writes a pass or fail line per check
  into `INDEX.md`.
- Never commit the screenshots. Attach a summary of the review to the phase PR instead.
