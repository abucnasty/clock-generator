# Upstream 0.15 compatibility evidence

Checkpoint: 2026-10-16. **Evidence gate incomplete: remaining historical captures and selftest are listed below.**
No review verdict, PR, Phase 3 PASS, or 2.7B PASS is claimed.

## Pinned source

- Frozen upstream: `1d27cde` (do not chase master during this evidence cycle).
- Compatibility implementation and exact-rate tests: `fe18341`, including tested p2 `cf7a8c7`.
- Latest product fix: `ded521b45bf109ed3d96a27bfbb40cc49634f86e`.
- Current merge checkpoint: `477884a95b485108b65acb92ecaf7cceaa6f492b`, merging p2 `5a5693f` documentation only.
  Its product files are identical to `ded521b`.
- Worktree `/tmp/ux-upstream-compatibility`; production `vite preview` at `http://127.0.0.1:5272`.
- Runtime scripts `/tmp/ux-upstream-capture`; external Playwright/axe dependencies via `/tmp/ux-capture/node_modules`.
  All commands set `UI_DIR=/tmp/ux-upstream-compatibility/clock-generator-ui` and
  `SAMPLES_DIR=/tmp/ux-upstream-compatibility/clock-generator/resources/config-samples`.

## Local checks

Engine unchanged since `fe18341`. Completed original logs remain in `/tmp/ux-upstream-evidence/compat-final`:

| Command (in clock-generator) | Result | Log |
|---|---|---|
| `npm run build` | PASS (`tsc`) | engine-build.log |
| `npm test` | 76 files, 1008 tests passed | engine-test.log |
| `npm run test:generation` | 11 files, 142 tests passed | engine-generation.log |
| `npm run lint` | PASS | engine-lint.log |
| `npm run knip` | PASS; 3 redundant-entry configuration hints | engine-knip.log |

Full UI gate rerun after `ded521b`; each command exited 0. Logs `/tmp/ux-upstream-evidence/compat-layout`:

| Command (in clock-generator-ui) | Result | Log |
|---|---|---|
| `node scripts/copy-factorio-data.mjs` | PASS (manual step required with ignore-scripts) | copy.log |
| `npx tsc -b` | PASS | tsc.log |
| `npm test` | 54 files, 926 tests passed | test.log |
| `npm run lint` | PASS | lint.log |
| `npm run knip` | PASS | knip.log |
| `npm run check:icons` | 53 always-drawn icons, 378/737 optional names available | icons.log |
| `npm run build` | PASS, includes engine dependency rebuild; existing >500kB chunk advisory | build.log |

Root's independent runner separately reran UI tests/build at `ded521b`; root owns that evidence decision.

## Completed production browser captures

Use `BASE_URL=http://127.0.0.1:5272` plus the UI_DIR/SAMPLES_DIR above. Default widths are intentional:

| Command | Result | Output / log |
|---|---|---|
| `node /tmp/ux-upstream-capture/capture-upstream-compatibility.mjs /tmp/ux-upstream-evidence/compat-core-final` | **3088 PASS, 0 FAIL, 0 failed steps** | compat-core-final/INDEX.md; compat-final/core-final-capture.log |
| `node /tmp/ux-upstream-capture/capture-rate-limit.mjs /tmp/ux-upstream-evidence/compat-rate-final` | **156 PASS, 0 FAIL, 0 failed steps** | compat-rate-final/INDEX.md; compat-final/rate-final-capture.log |
| `STEPS=G1 node /tmp/ux-upstream-capture/capture-upstream-compatibility.mjs /tmp/ux-upstream-evidence/compat-geometry3` | 513 PASS, 0 FAIL, 0 failed steps; superseded by full core | compat-geometry3/INDEX.md; compat-final/geometry3-capture.log |

Core widths 1440/960/800/720 each: 622 PASS. Width390:600 PASS. At390 only row geometry is observational;
reachability, keyboard/focus, actions, accessible names and axe remain required. Rate widths1440/720/390:52 PASS each.
Core scans include every captured state, actual keyboard stops, short-height editor/dialog checks, static error descriptions,
real error/import announcements where exposed, input/export/reload, metadata/Paste, List live clear and Diagram draft/Save,
repeated-unit Check and fresh Generate refusal, real examples/manifest and all metadata row geometry.

Measured text contrasts: Copies help8.37:1; invalid Copies/target errors7.42:1; List metadata/Automatic7.00:1;
Diagram metadata/Automatic7.00:1; repeated-unit guide14.06:1. Complete control ratios and aria snapshots are in each INDEX.

Core screenshots (each filename ends `-<width>.png`, with corresponding `.aria.yml`, under `w1440`, `w960`, `w800`, `w720`, `w390`):
`01-f1-fractional-copies`, `02-f2-invalid-0`, `03-f2-invalid--1`, `04-f2-invalid-0.0001`,
`05-f2-invalid-0.3333333333333333`, `06-f3-invalid-draft-reload`, `07-r1-half-copy-target-limit`,
`08-m1-readonly-automatic`, `09-m2-list-cleared`, `10-m2-diagram-uncommitted`, `11-m2-diagram-saved`,
`12-m3-metadata-paste-confirm`, `13-m3-pasted-metadata`, `14-u1-repeated-unit-guide`,
`15-x1-fractional-examples`, `16-g1-metadata-geometry`. INDEX files list all exact screenshot paths.

## Scoped fixes and 2.7B reconciliation

`ded521b` borrows ce131ae's existing shared InsertersForm subgrid: LIST_GRID_SX, ROW_GRID_SX,
DESTINATION_CELL_SX, ROW_REST_SX, source/lane grouping and rule/delete cell wrappers. It preserves the p2 Paper,
existing filter editing, metadata and Automatic semantics; it does not adopt PanelSection/filter-slot features.
The Stack column is130px to fit Automatic, with the same grid's one-row breakpoint raised to1600px to retain readable
Source/Destination names with the wider field. Metadata spans all columns. 2.7B must reconcile these same layout hunks
when it inherits compatibility, retaining its own broader features and final capture. Diagram visible text now has a space
before beta; its accessible name is `Diagram beta view`, centralized in `ui.diagramView`.

Capture repairs preserve assertions: focus before inspecting full NumberField values; firstProblem starts from another
field; actual accessible group names identify Diagram nodes; fresh import separates Check failure from Generate failure;
only aria-hidden native form backing inputs are excluded from visual geometry. Axe scans start at page top so a preceding
Tab walk cannot leave a target partially under the sticky header; actual per-stop focus checks remain.
Rate-limit exact copy now describes one unit and raising Copies, matching intended source; palette expectation is actual
error.light `#ff9493`, retaining measured AA thresholds. Firstvisit expects existing Sidecar0.7.1 and Terms menu order;
menu closure is awaited before the start-note click. Selector selftest waits for asynchronously loaded example rows.
The infinity-chest fixture explicitly says `type: infinity-chest`, matching current engine schema.

## Remaining evidence — not run to completion on final source

Run sequentially (clipboard is shared), copying the committed scripts and fixtures into the external runtime first:

```sh
export BASE_URL=http://127.0.0.1:5272
export UI_DIR=/tmp/ux-upstream-compatibility/clock-generator-ui
export SAMPLES_DIR=/tmp/ux-upstream-compatibility/clock-generator/resources/config-samples
node /tmp/ux-upstream-capture/selftest.mjs > /tmp/ux-upstream-evidence/compat-final/selftest-final.log 2>&1
node /tmp/ux-upstream-capture/capture-first-visit.mjs /tmp/ux-upstream-evidence/compat-first-visit-final > /tmp/ux-upstream-evidence/compat-final/first-visit-final-capture.log 2>&1
node /tmp/ux-upstream-capture/capture-results-answer.mjs /tmp/ux-upstream-evidence/compat-results-final > /tmp/ux-upstream-evidence/compat-final/results-final-capture.log 2>&1
```

Leave GEN_EACH unset (or1) for firstvisit: S6 at1440 generates all nine examples, records seconds and requires <=60s.
The current-tree core Check already accepts the unchanged shared-foundry chemical sample with Copies5.5. Final generation
timing remains pending. Current results-answer card is the relevant existing card; unmerged2.7B's new build-card script
cannot establish PASS here. P3 library/share/rules/cache are separate adjunct evidence, never inferred from these captures.

Prior runs retained honestly: core-capture.log1954PASS24FAIL20failedsteps (superseded); core-debug2 M2/U1 at720113PASS;
first-visit-capture.log1063PASS16FAIL (stale version/menu expectations and390 open-menu setup); rate-capture.log141PASS15FAIL
(stale exact copy/palette, superseded); selftest.log5 failures (example row render race, repaired but final rerun pending).
No historical failure has been relabeled PASS. Review waits for remaining final runs and root evidence decision.
