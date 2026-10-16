# 3.2 B — row actions and editing inserters together

PR B only, implemented on `codex/ux-p3-editing-rows`. First product commit: **2026-10-16 10:06:48 UTC** (`b84b580`); first immutable gates started **10:07:16 UTC**. Final captured product: **`335a8a47fb87c9bb59c42f83cf7cc5007fda082a`**. Final P3 inheritance: normal merge **`376a625`**, including merged A parent **`4b86e77dc551d77ed99b9ef4e82359710c74e69e`**. The entire `clock-generator-ui` and `clock-generator` trees are byte-identical between captured335 and merged376. This report records author verification; independent B reviews and CI remain separate gates.

## Scope and contracts

All five kinds have Duplicate, Move up and Move down, disabled at bounds. Duplicate appends a deep copy with a fresh UUID/id and retains metadata, omitted keys, filters, rules and forced flags. Reorder and selected edits offer exact whole-form Undo and one announcement. The pointer-only handle remains available; the menu is the pointer/keyboard alternative. External-order reconciliation fixes drag after Undo. Add and Duplicate focus the actual first field and scroll the new row below the fixed header.

Inserter selection is caller-owned by UUID, with Shift range selection. The sticky bar applies Stack size, filters or an enable rule to selected rows only. Blank stack means Automatic; untouched fields and unselected serialized row bytes stay unchanged. Existing compatibility helpers retain per-type capacities16/12/4. Mixed enable rules may Save the initially selected Auto; shared undefined remains the ordinary no-op.

Shared A API stays `InserterEditor` value/label/layout with optional memoized options and a trailing rowActions fragment. The menu occupies an explicit extra column in both nested and >=1600 grids. Bulk filters reuse the priority API and shared filter helpers; the rule modal reuses existing validation. No engine behavior, mode, dependency, setting, version, CI or Diagram commit-model change was added. D1–D8, compact/theme/rates and unrelated2.F/3.F work remain outside this PR.

## Fresh full gates after resolving the P3 merge

Immutable checkout `/tmp/ux-editing-rows-verifier-376a625`; provenance `/tmp/ux-editing-rows-evidence/376a625/source.json`. It has its own npm installs and local engine dependency. Commands, each exit0:

```sh
cd clock-generator
npm ci --ignore-scripts
npm run build
cd ../clock-generator-ui
npm ci --ignore-scripts
node scripts/copy-factorio-data.mjs
npm test
npx tsc -b
npm run lint
npm run knip
npm run check:icons
npm run build
```

Actual **1216 tests /72 files PASS**, TypeScript/lint/default Knip/icons/build PASS. Logs and `gates.json`: `/tmp/ux-editing-rows-evidence/376a625/`. The same complete sequence also passed on captured335 in its independent verifier. Engine source is unchanged relative to P3; inherited engine1008 unit/142 generation evidence remains applicable. These UI captures do not claim a new generation run.

The merge's six actual conflict hunks are retained at `/tmp/ux-editing-rows-evidence/p3-merge-conflicts.diff`. Five conflicts contain the existing B menu column, selection handlers, appended duplicate/bulk tests, README entry or ui aliases; retained those additions after reading every hunk. Took P3's exact final A evidence and four review reports. `/tmp/ux-editing-rows-evidence/p3-merge-product.diff` is empty. No product change was introduced by conflict resolution.

## Production capture

Fresh production preview of immutable335 at **http://127.0.0.1:5298**, strictPort. Owner5280 was never used. No clipboard write, generation, fake worker response, forced click or persistence write is used. Fixtures enter through real file import. Existing storage is read only, preserving exact raw strings.

```sh
BASE_URL=http://127.0.0.1:5298 \
CAPTURE_LIB=/tmp/ux-capture/editing-rows-lib.mjs \
UI_DIR=/tmp/ux-editing-rows-verifier-335a8a4/clock-generator-ui \
SAMPLES_DIR=/tmp/ux-editing-rows-verifier-335a8a4/clock-generator/resources/config-samples \
BASELINE_JSON=/tmp/ux-editing-rows-evidence/baseline-A-rested/tab-baseline.json \
WIDTHS=1440,720,390 \
node /tmp/ux-capture/capture-editing-rows.mjs /tmp/ux-editing-rows-evidence/335a8a4/full
```

**5775 PASS /0 FAIL /0 failed steps**:1440=2011;720=1882;390=1882. Actual results, all step details, PNGs and ARIA snapshots: `/tmp/ux-editing-rows-evidence/335a8a4/full/INDEX.md`; complete log `../full.log`. The960/800/720 sweep is part of the1440 run. All13 steps ran: menus, duplicate, add, reorder, drag, Check-only Undo withdrawal, selection, stack, filters, rules, sticky focus, tab stops and geometry. Every shot requires axe to be available and no axe violations or page horizontal overflow.

Observed real DOM UUID sequences are paired with exact raw persisted JSON; serialization deliberately omits `_uuid`. Duplicate asserts a unique new actual key and preserves existing keys for all five kinds. Menu movement checks reference renumbering plus exact order; Undo restores exact raw whole-form text and actual keys. Real pointer drag1→3, Undo and a second drag test external order; drop in place makes no false offer. Selection stays on the same actual UUIDs through move/Undo, unselected Duplicate and deletion pruning.

All5 Add/Duplicate cases assert the actual focused input/combobox, painted keyboard focus and unobscured geometry. Selected Stack size applies12, blank Automatic and invalid negative/fractional states. Filters use source priority, Cancel, Apply, empty Apply and Automatic with exact Undo; the nested inserter picker commits on choosing an item. Enable-rule cases create genuine `_forced_always` through Check only, apply mixed→default Auto without a mode detour, preserve animation overrides and restore every raw flag on Undo.

The bulk bar's measured heights are63px at1440,100.75px at720 and176.25px at390; its top matches the actual header within1px. CSS scroll padding includes the measured bar. Real Tab and Shift+Tab walk all15 rows at normal heights and1440/720×420 or390×844: no obscured stops; all15 rows visited in both directions. Clearing selection from inside the bar returns actual focus to Select and clears the extra scroll padding.

Actual names include `More actions for Inserter 1`, `Select Inserter 1`, `Edit selected inserters`, `Stack size`, `Filters…`, `Enable rule…` and selected range titles. Actual contrast: menu text10.80–15.72:1; menu glyph7.49:1; selected-count and bulk text11.37:1; secondary Select all/Clear6.51:1; Select7.77:1; selected checkbox border6.71:1. Disabled menu bounds were tested for Tab/Shift+Tab/Enter/Space inertness, not merely aria-disabled. Single announcements accept explicit polite or implicit role=status polite and require one unhidden live region.

## Before/after Tab stops

A baseline uses untouched immutable A e783 production assets, all widths1440/720/390, `BASELINE_ONLY=1`, real row traversal from an observed focus origin. `/tmp/ux-editing-rows-evidence/baseline-A-rested/INDEX.md`: **288 PASS/0 FAIL/0 failed steps**. Results are identical before/after: Machine[6], Inserters[10,10,9], Belt[9], Chests[6,6], Drill[7]. B replaces the keyboard drag stop with the menu stop; selection adds its checkbox first only when Select is on.

Final formula: Source+Destination+Stack + lane if present + each filled filter + Add slot if present + Use automatic filters if present + rule+menu+Delete. Maximum5 filters has no free Add. The owner-approved explicit LOGISTIC10/10/9 includes the required recovery action; Automatic2/2/1-filled states have10/10/8. No required action was removed to reproduce historical9/9/8.

The original218-pass baseline had spurious0/1 counts because an import-message close's scheduled focus restoration ran during traversal. It is retained at `/tmp/ux-editing-rows-evidence/baseline-A-started/`. The corrected baseline waits for observed finite animations to finish and two animation frames, asserts actual origin focus, then traverses. It does not add an arbitrary delay or waive counts.

## Preservation and visual inspection

Fresh A-runner preservation on the same335 production preview, `STEPS=names,alignment,drafts,automatic-focus WIDTHS=1440,720,390`: **2289 PASS/0 FAIL/0 failed steps** at `/tmp/ux-editing-rows-evidence/335a8a4/shared-editor-preservation/INDEX.md`. This is explicitly a partial A preservation run; A's original full acceptance is in its separate evidence. It checks all5 Diagram drafts, List/Diagram names, capacities16/12/4, Automatic/explicit alignment within1px including1440/960/800/720/1600/390 and actual Enter focus returning to the same surviving filter slot.

Author opened actual PNGs: full/w1440/53-bulk-bar-at-row-12-1440.png; full/w720/44-bulk-filter-priority-picker-720.png; full/w390/53-bulk-bar-at-row-12-390.png; full/w390/18-inserters-added-390.png. Bar/actions wrap within the viewport, source-priority text is legible, the new row's actual first input has an orange focus outline and remains below the header. Independent reviewers must inspect their own images.

## Approved bounded helper changes and proofs

The independent code approvals were relayed by root before implementation:

- **10:11:39–43 UTC:** optional modal `applyUnchanged=false` affects only the outer changed guard; bulk passes true only when common rule is null/mixed. Existing shared undefined/single-row validation remains unchanged.
- **10:12:40 UTC:** optional menu helper `{anchor,menu,activation}` plus itemActivation; default header behavior stays unchanged. Custom row menus are strict, pair anchor/menu and preserve actual Enter/Space activation. Both target-hidden and actual pre-click MUI-layer-hidden waits run inside try/finally disposing the handle.
- **10:24:51–57 UTC:** optional inert helper `afterTabProbe`. After EACH real Tab/Shift+Tab landing is recorded and probes removed, reopen the same actual row menu, dispose old handle and require exactly one visible connected target. Preserve initial candidates/landings/failures; unchanged Enter/Space observer suppresses no event or mutation. Missing/ambiguous target fails.
- **10:25:50 UTC:** optional fifth `{controlPaint:true}` for Select's paint-only toggle. Prehover and observe finite animation rest before baseline; click the actual visible center and compare the SAME connected control's text/background/painted borders afterward. Transparent background and non-painted borders do not count. Geometry never establishes paint success.

Final seven bounded proofs **7 PASS/0 FAIL**: `/tmp/ux-editing-rows-evidence/335a8a4/helper-proofs-final/proofs.json` and `.log`: native disabled default passes; native enabled fails with captured activation/mutation; initially missing fails; identical-hover transparent no-op paint fails; real disabled menu passes complete keyboard probe; missing target after real Tab-dismissal fails; actual enabled Duplicate fails with real mutation. The executed full-capture runner/lib matched committed215 sources byte-for-byte, preserved historically in `/tmp/ux-editing-rows-evidence/376a625/capture-source-proof.json`; selftest's only runtime change is its import pointing at the same reviewed lib, preserved as `selftest-runtime-import.diff`.

## Retained failed and intermediate evidence

No failed results were discarded. `/tmp/ux-editing-rows-evidence/baseline-A/` retains the initial connection-refused attempt (released port was not a running preview). `/3d9c5d4/full/` retains **3539 PASS/233 FAIL/10 failed steps**; it exposed real focus/row-scroll issues and incorrect harness assumptions about serialized UUIDs, implicit polite status and MUI aria-hidden anchors. Product focus/scroll was corrected; actual UUID bindings and strict real menu-layer waits replaced the incorrect assumptions. `/1aaf9d0/bounded/` retains1936/6/7; `/1aaf9d0/bounded-corrected/` retains2894/43/0. Remaining genuine menu-region axe failure was fixed in335; the inert-helper transition observation was corrected only under the approved API and bounded negative proofs. All earlier gates/source hashes are retained alongside those runs. The final5775/0/0 run follows the last product and helper changes.

Existing capture consumers were migrated from the removed keyboard drag handle to the row menu without weakening their Undo/announcement assertions. Their generation/clipboard scenarios were not rerun in this author lane; the new full B capture exercises the affected menu/reorder/announcement states without those side effects. Engine generation evidence is inherited unchanged. Independent root code/UX review, root test/build repeat, child PR/CI and any phase-wide install/approval remain outstanding gates, not claimed by this report.

## CODE round0 capture minor — original locator ambiguity

Root relayed independent CODE round0 **PASS with one cheap capture minor**. The bounded correction was completed **2026-10-16 10:42:24 UTC**: the optional `afterTabProbe` path now validates the ORIGINAL locator's count, visibility and connection before taking `.first()`, both initially and after EACH Tab callback. Default callers and all keyboard/mutation observations are unchanged; no API or product change was introduced. Actual guard diff: `/tmp/ux-editing-rows-evidence/ambiguity-minor/guard-delta.diff`. Focused independent CODE closure and the independent UX verdict are separate pending gates.

The eighth proof uses a standalone disabled native control fixture. It supplies an original query with two matching controls initially, after the first Tab callback, and after the second Shift+Tab callback. All three must fail with count2; seven existing native/menu/paint positive and negative proofs remain intact. The OLD helper completes **7 PASS/1 FAIL**, incorrectly reporting inert:true for each ambiguous case: `/tmp/ux-editing-rows-evidence/ambiguity-minor/old-helper-complete/{proofs.json,../old-helper-complete.log}`. The final NEW helper completes **8 PASS/0 FAIL**: `/tmp/ux-editing-rows-evidence/ambiguity-minor/new-helper-final/{proofs.json,../new-helper-final.log}`. An intermediate8/0 run is retained as `new-helper-complete`; the final run uses the exact final guard. Initial old/new attempts retained their fixture results but then hit a stopped preview's connection-refused error; both logs remain `/tmp/ux-editing-rows-ambiguity-{old,new}.log`, and their partial JSON remains in `ambiguity-minor/{old-helper,new-helper}`. The immutable335 preview was restarted on strict5298 for complete reruns.

The original executed5775/2289 capture runtime remains untouched at `/tmp/ux-capture/editing-rows-lib.mjs`, SHA256 **89083de3916f7a5a8ae859fc40f7f78618fcf96d30e128901938279006521611**. The corrected proof runtime is separate at `/tmp/ux-capture/editing-rows-minor-lib.mjs`, SHA256 **b4eb8b7ab33d13d205404ab652d0a0eb0715160a95cdf43c42356a9f6a8fdbf7**, exactly matching the final source library. Runtime/source hashes and the selftest's sole import-path substitution are preserved in `/tmp/ux-editing-rows-evidence/ambiguity-minor/{runtime-source-proof.json,selftest-runtime-import.diff}`. This minor does not rewrite the earlier runtime/hash claim or repeat the full product capture.

Required minor checks were rerun in the existing immutable **376a625** verifier with its own engine dependency: **1216 tests/72 files PASS**, TypeScript/lint/default Knip/icons/build all PASS. Exact six commands are the UI checks listed above; all exit0 in `/tmp/ux-editing-rows-evidence/ambiguity-minor/gates.json`, with individual `ui-*.log` and `source.json`. Whole UI+engine diff versus captured335 remains empty. Root independently repeated the unchanged product's test/build; proof `/tmp/ux-editing-rows-root-repeat/PROOF.json`. Root's initial main-checkout typecheck hit stale engine declaration output, then own376 typecheck/tests/build passed; no product fix resulted. No new product screenshots or full capture rerun is claimed for this capture-only guard correction.
