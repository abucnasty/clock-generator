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
- `capture-numbers.mjs <out dir> <start number> [port]` checks readable numbers and units (item 1.10) at 1440px and
  720px: the number fields' short text and full value on focus (and that the stored value does not change), Machine
  Facts, the diagram's machine node and the Potential Clocks headers. It writes a pass or fail line per check into
  `INDEX.md`. Set `SAMPLES_DIR` to read the sample configs from another checkout (a worktree's
  `clock-generator/resources/config-samples`).
- `capture-header.mjs <out dir> [port]` checks the header (item 1.2) at 1440, 960, 720 and 390px: the Configure and Results
  toggles, Generate and Copy are clickable (`elementFromPoint`), nothing in the header overlaps, the content starts below
  the header, the header stays pinned on scroll, the title, the ⋮ menu, Export, Import and Paste from Factorio from the
  menu, Validate scrolling to the Validation panel and the "Copied." warning. It writes a pass or fail line per check
  into `INDEX.md`. Run it before and after a change to the header into two out dirs. Set `SAMPLES_DIR` to read the sample
  configs from another checkout. It finds Copy by `/^Copy/`, since it reads "Copy old clock…" while results are stale.
- `capture-renumber.mjs <out dir>` (on `lib.mjs`) checks one number per entity (item 1.9) at 1440 and 720px, each in a fresh
  browser context: the label every view gives an entity (row chips, pickers, rule editor, diagram, edit dialog, Transfer Plan)
  before and after a delete, a reorder and a reload, the references in the saved form, an old saved form with `next_ids`, the
  dimmed Transfer Plan from the keyboard, the inserter row's layout and the forced-ALWAYS tooltip of the enable chip (step 13,
  which is step 7 of `capture-enable-chip.mjs`). `RESULTS=1` also generates a sample after a delete (slow).

## Shared helpers

New item scripts use `lib.mjs` (the helpers below) and start from `example-item.mjs`, so a script is only its steps and
checks. `lib.mjs` needs `playwright-core`, and Node ignores `NODE_PATH` for ES modules, so copy the item script and
`lib.mjs` into `/tmp/ux-capture/` and run them from there:

```bash
cp docs/ux-rework/capture/{lib,my-item}.mjs /tmp/ux-capture/
BASE_URL=http://localhost:5204 node /tmp/ux-capture/my-item.mjs /tmp/ux-capture/out/my-item   # SAMPLES_DIR for a worktree
```

- `openSession`, `createRecorder` (`shot`, `step`, `check`, `info`, `finish`) and `eachWidth` run the browser, number the
  shots and write `INDEX.md` with a PASS or FAIL line per check. `finish()` returns a non-zero exit code if a check or a
  step failed.
- `importFile`, `goConfigure`, `goResults`, `validate`, `generate` and `openMenu` are the app actions. `validate` and
  `generate` wait on the buttons' `textContent` until the work has finished.
- `contrast`, `noSideScroll` and `isClickable` are the page measurements.
- "Before" shots are only for states the original review has no shot of; the review's shots already show 0.9.0.
- The default widths are 1440 and 720. Add 390 (at 844 high) when the item affects reachability.
- Never commit the screenshots. Attach a summary of the review to the phase PR instead.
