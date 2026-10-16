# 3.2 A — one editor, every Diagram edit a draft

Implementation start: **2026-10-16 09:44:58 UTC**. Baseline product: `c29db81d21ba442fef8066279078ab4a2751050a`; capture-only adoption: `f74bf6d`. Initial complete-capture product: **`e7830d36278666c6589c41c8bd0db7f7b10f0a3e`**. Reviewed minor follow-up product: **`0e6e3fa41354f520d0298fc436b49f50bca480ff`** (see the final section); later evidence-only commits do not alter it. No phase merge, release or owner checkpoint is claimed here. Independent code/UX round0 PASS and focused minor closures PASS are preserved below; the child PR and CI remain separate gates.

## Source and gates

Immutable verifier: `/tmp/ux-one-editor-verifier-e7830d3`, detached at the product head. Its UI file dependency resolves to `/private/tmp/ux-one-editor-verifier-e7830d3/clock-generator`, within the same verifier. `/tmp/ux-one-editor-evidence-e7830d3/SOURCE.json` records source identity and built JS asset hashes. Its production preview is **http://127.0.0.1:5296**, with `--strictPort`; owner port 5280 was untouched. Browser/clipboard coordination was obtained from root; the window was released at 10:08:13 UTC. No generation or clipboard writes were used.

Setup: `npm ci --ignore-scripts`, `npm run build:deps`, then `node scripts/copy-factorio-data.mjs` in the verifier's `clock-generator-ui`. The engine must be built before UI tests on a fresh checkout; the earlier missing-built-engine diagnostic is retained at `/tmp/ux-one-editor-test-missing-built-engine.log` and was not counted as a passing gate.

| Command | Actual final result | Log |
|---|---|---|
| `npm test` | **71 files passed; 1202 tests passed** | `/tmp/ux-one-editor-e783-test.log` |
| `npx tsc -b` | exit 0 | `/tmp/ux-one-editor-e783-tsc.log` |
| `npm run lint` | exit 0 | `/tmp/ux-one-editor-e783-lint.log` |
| `npm run knip` | exit 0, default configuration, no suppressions | `/tmp/ux-one-editor-e783-knip.log` |
| `npm run check:icons` | public/icons has all 56 always-drawn icons; 378 of 737 optional names | `/tmp/ux-one-editor-e783-icons.log` |
| `npm run build` | exit 0; Vite built in 4.04s | `/tmp/ux-one-editor-e783-build.log` |

The previous unused `filterSlots` module/test was replaced by the shared `inserterFilters` API, with its preservation cases consolidated into that suite. Net test change from the provider is +3 tests/+2 files. Engine source is unchanged; its root-verified 1008 unit/142 generation results are inherited, not a new engine run by this implementer.

## Baseline and interfaces

Before any product edit, the unchanged production build was captured at 1440/720/390. Evidence: `/tmp/ux-one-editor-baseline/INDEX.md`, width PNGs, `/tmp/ux-one-editor-baseline.log`. These are measurements (INFO), not a behavior PASS verdict. Logistic Inserter 1/2/3: **10/10/9** at all widths; Machine 1: 6; Belt 1: 9. Every Machine/Belt/Chest/Drill/Inserter group in logistic, production-science-shared and low-density-structure was recorded.

The committed shared API is `InserterEditorProps`: value, label, layout (`row` or `stacked`), machines, belts, chests, itemNames, getRecipeInfo, onChange; optional `rowActions?: ReactNode` and `options?: EntityOption[]`. The memoized editor holds no draft state. The List card builds options once and each memoized row owns its stable update callback. `rowActions` is a row-only trailing fragment, directly in the existing rest grid; callers retain rule/delete handlers, state and names. Both `FilterSlotSelector` and `ItemSelector` expose `priority?: { label: string; ids: string[] }`. `InserterConfigPanel.onCancel?` lets its parent ask before discarding without making Save ask.

Root relayed independent code approval for the row-layout seam at 09:47:36–09:47:44 UTC and for nested Discard focus restoration at 09:57:16–09:57:28 UTC. Discard commits the nested prompt close with `flushSync`, then closes its parent; Keep editing/Esc/backdrop retain their existing paths. No timer or dependency was added.

Final explicit logistic counts remain **10/10/9**: each redundant remove-button stop is replaced by the required, keyboard-reachable **Use automatic filters** action. Root reconciled the PR B formula to include that conditional action and the Add slot only when present. Automatic rows with two/two/one filters count 10/10/8 before B replaces handle with menu. No claim of a numeric reduction on the imported explicit sample is made.

## Browser evidence

All scripts use shared `lib.mjs` and the real imported files/worker/persistence. The active library build key is resolved from the library index and session's build id; draft/Undo assertions compare the exact serialized saved form. No localStorage writes, fabricated UUIDs, mocked workers or simulated engine answers are used. External Playwright and axe-core reside under `/tmp/ux-capture/node_modules`; no repository dependency was added.

Full run command (from `/tmp/ux-capture/one-editor-e783`, beside a copy of the reviewed lib):

```sh
BASE_URL=http://127.0.0.1:5296 \
UI_DIR=/tmp/ux-one-editor-verifier-e7830d3/clock-generator-ui \
SAMPLES_DIR=/tmp/ux-one-editor-verifier-e7830d3/clock-generator/resources/config-samples \
node capture-one-editor.mjs /tmp/ux-one-editor-evidence-e7830d3
```

The complete same-product run records **5307 PASS, 9 FAIL, 0 failed steps** in `/tmp/ux-one-editor-evidence-e7830d3/INDEX.md` and `/tmp/ux-one-editor-capture-e7830d3.log`. Its nine failed assertions were capture assumptions: six expected historical title-case `Infinity Chest` instead of the existing sentence-case `Infinity chest`; three demanded the visible name match `i` despite established search also matching internal ids. Root approved both reconciliations. Only capture text changed: the exact sentence-case message still requires one live announcement, one message with Undo and exact whole-form restoration; each search option must match its actual GameName label or the internal id in its direct child GameName span's title. The repaired capture logs every label/id/match and retains both groups, nonempty matches, contiguous flattened ordering and the required plate search. The failed full-run artifacts are preserved, not rewritten as a clean full-run report.

The affected states were rerun at all three widths on the **same unchanged product**, as root directed:

| Scope | Result | Evidence directory/log prefix |
|---|---|---|
| Reconciled chest, picker and tab stops | **462 PASS / 0 FAIL / 0 failed steps** | `/tmp/ux-one-editor-reconciled-e7830d3` |
| By-hand filters, including dialog caption contrast | **219 / 0 / 0** | `/tmp/ux-one-editor-byhand-e7830d3` |
| Additive 41-key selector matrix | **126 / 0 / 0** | `/tmp/ux-one-editor-selftest-e7830d3` |
| Affected upstream M2 clear/Cancel/Discard/reopen consumer | **387 / 0 / 0** | `/tmp/ux-one-editor-compat-m2-e7830d3` |
| Affected a11y slot keyboard consumer | **27 / 0 / 0** | `/tmp/ux-one-editor-a11y-slots-e7830d3` |
| Affected P3B rule defaults across List/Diagram clear/Cancel/Save/reopen | **555 / 0 / 0** | `/tmp/ux-one-editor-p3b-e7830d3` |

Each directory has its own `INDEX.md`; its log is the directory path plus `.log`, except the complete-run log named above. Scoped consumer runs explicitly mark unselected steps NOT RUN; they are not full compatibility or phase verdicts. The old initial product capture at `/tmp/ux-one-editor-evidence-6710394` retains **2900/49/31** diagnostics from before accessibility, dirty Cancel and focus restoration repairs. The optional empty-chests capture projection was also repaired there; the authoritative storage checks were retained.

The shared ui map has **177 keys = 136 existing + 41 oneEditor entries, zero duplicates**, verified by a TypeScript AST read (`/tmp/ux-one-editor-ui-bindings.json`). Existing compatibility aliases remain. Changed Cancel/Discard, Tile-strip and filter Tab-order capture consumers were reconciled in the same branch; all changed scripts pass `node --check`.

The full run includes **194 PNGs**, accessible-name snapshots, all five untouched/dirty dialogs, all five Esc/X/Cancel prompts and Keep editing/Discard, title Delete with exact Undo, draft Machine Facts, source-option parity, source-first search, filter conversion/automatic return/no holes/Delete focus, keyboard walks in both directions at 420px and 390x844, and every dialog at 960/800/720. All 15 kind×width Discard cases return focus to the genuine node and preserve the exact saved form.

**Alignment:** all **30** type×Automatic/explicit×1440/960/800/720/1600 cases measure **0px** slot-center delta against the actual **40px input box**, with the multiline Automatic helper retained (2.998 lines). Explicit fields have no helper element, reserved helper space or Automatic description. Source/Destination text fits; stack/bulk/fast metadata stay read-only with 16/12/4 capacities. 390 mouse, Tab and focus reach remain intact. The Diagram keeps sequential fields.

**Accessibility:** the full run has **3315 actual axe PASS lines, zero axe INFO/skips**. Caption contrasts: Set by hand 7.49:1 on the row and 8.37:1 in the dialog; picker groups 8.37:1; Unsaved changes 8.37:1; empty-slot border 6.50:1. Save is the sole filled action in each dialog, green `rgb(94,182,100)`; Cancel is neutral text without a fill. The new popup landmarks and dialog-relative Machine Facts heading resolve the actual initial axe findings.

Visually inspected: the 720 Automatic row (`w1440/68-alignment-720-stack-inserter-automatic-1440.png`), source-first picker (`w1440/36-picker-open-1440.png`) and 390×420 dirty inserter (`w390/51-walk-inserter-420-390.png`), plus the original Phase 1 List/Machine/Inserter shots. Screenshots remain outside Git.

## Scope retained

PR B's duplicate/bulk/reorder/new-row focus behavior is not implemented. Engine, dependencies/lockfiles, versions, CI, theme/compact/machine-rate proposals, P2 intro/wake-up/fraction copy, failed Copy/Fuel keyboard/partial-paste findings and phase/install decisions are left alone. Existing rules/templates, Cancel/results cache/library/share persistence, metadata, exact fractions, Build panel/Advanced/grid behavior and slot affordances remain in place. No phase PASS or install approval is asserted.


## Reviewed minor follow-up

Start **2026-10-16 10:19:00 UTC**. Round-0 [code report](../review/3.2A/CODE-ROUND0.md): PASS with whitespace nit; [UX report](../review/3.2A/UX-ROUND0.md): PASS with one nonblocking focus minor. Root relayed independent code approval at **10:18:23 UTC** for a ref on the existing filter wrapper: focus its actual first `[role="button"]` slot before committing Automatic, then retain the existing announcement. Slot zero survives the switch. No effect, timer, state, DOM/layout wrapper or public API was added. The two whitespace-only lines were cleaned. `origin/feat/ux-rework-p3`'s documentation-only updates were merged normally before the product commit.

Fresh immutable source **`0e6e3fa41354f520d0298fc436b49f50bca480ff`** lives at `/tmp/ux-one-editor-verifier-0e6e3fa`; its engine dependency resolves to `/private/tmp/ux-one-editor-verifier-0e6e3fa/clock-generator`. Setup and the same full UI command sequence above were rerun there. Actual results: **1202 tests/71 files PASS**, TypeScript/lint/default Knip/icons PASS, production build PASS (4.30s). Logs: `/tmp/ux-one-editor-0e6-{ci,engine-build,test,tsc,lint,knip,icons,build}.log`. `git diff --check c29db81..HEAD` is clean. Engine/dependencies/settings/versions and every existing layout/helper contract remain unchanged.

Fresh production preview: **http://127.0.0.1:5301** with `--strictPort` (5296 retains the original immutable full-capture build; B5298 and owner5280 were untouched). `STEPS=automatic-focus` against the new source at 1440/720/390 records **156 PASS / 0 FAIL / 0 failed steps**, six fresh PNGs and ARIA snapshots, **90 actual axe PASS lines / zero axe INFO/skips**: `/tmp/ux-one-editor-minor-0e6e3fa/INDEX.md`, `/tmp/ux-one-editor-minor-0e6e3fa.log`. Its `SOURCE.json` records the new source, own engine dependency and JS asset hashes.

Each List/Diagram case reaches **Use automatic filters** by Tab and activates it with real **Enter**. After the commit, `document.activeElement` is the **same connected actual slot-zero element** captured before activation; `:focus-visible` and the painted outline are present, and shared focus checks find no obscuration. List returns to the exact serialized live form with no filters key; Diagram leaves the exact saved form unchanged throughout. Each automatic-return announcement reaches exactly one unhidden live region. Visually inspected `w1440/01-list-automatic-return-keyboard-focus-1440.png` and `w390/02-diagram-automatic-return-keyboard-focus-390.png`.

This is the approved **minor-only** evidence refresh, not a repetition or replacement of the original complete capture. All original failed/corrected reports and provenance above are retained. Root's new-product independent test/build repeat and focused UX/code closures remain separate gates; no phase/install approval or merge is asserted.

## Root verification and independent closure

Root independently repeated UI tests/build on the original full-capture product and again on final minor product0e6e3fa: **1202 tests/71 files and build PASS** on both. Actual logs/results/proofs are in `/tmp/ux-one-editor-root-repeat/` and `/tmp/ux-one-editor-root-repeat-0e6e3fa/`; the latter confirms all three JS asset hashes, own engine file dependency and empty product diff through author finale2cddd4. Runtime library matches final capture source exactly; the runner's only post-runtime differences are comments and an explanatory report-footer link, preserved in `runtime-to-final-capture.diff`. Root read the actual failed and corrected result lines, opened three full-run images and the fresh390 Diagram keyboard-focus image.

Independent [CODE round0 PASS](../review/3.2A/CODE-ROUND0.md) and [UX round0 PASS with minor](../review/3.2A/UX-ROUND0.md) remain intact. The cheap focus minor and whitespace nit are closed by [CODE](../review/3.2A/CODE-MINOR-CLOSURE.md) and [UX](../review/3.2A/UX-MINOR-CLOSURE.md). No blocker or major fix round was needed. Reviewers personally inspected the diff/evidence; code also ran15 focused tests and UX opened18 original fresh PNGs plus the changed minor states. No phase-wide accessibility certification, install check or phase approval is implied. PR B remains separate current work; owner5280 is never used for automated evidence.
