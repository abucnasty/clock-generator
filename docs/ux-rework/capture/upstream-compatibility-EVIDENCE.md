# Upstream 0.15 compatibility evidence

Checkpoint: 2026-10-16. **Fix round 1: all final evidence gates passed; re-reviews pending.**
Round 0 code review returned FIX for exact-rate transport and unsafe synchronous rational arithmetic.
Round 0 UX review returned PASS with an invalid-Copies blurred-display minor. All three findings were batched
into round 1. Design reviews approved the implemented mechanisms; they are not final acceptance.
Phase 3, 2.7B, 3.3 and owner install/phase/final checkpoints remain separate.

## Pinned source and scope

- Frozen upstream: `1d27cde`; no newer master changes in this evidence cycle.
- Reviewed round 0: `bcc6db7`, product `ded521b`, phase base `5a5693f`.
- Round 1 product: `aebaf9b` (exact ratio, guarded arithmetic, invalid Copies display), followed by
  `4c8a6b9fbeb4355cef80bb2f3ed44fdeb8b0a8b1` (untouched tiny values survive focus/blur).
- Final capture source: `eb686919899b5b45c223aba970628f7469c43719`.
- Current phase head `f43ed4a` differs from `5a5693f` only in PROGRESS.md; no product baseline change.
- Worktree `/tmp/ux-upstream-compatibility`; built production preview `http://127.0.0.1:5272`.
- Runtime `/tmp/ux-upstream-capture`; scripts/fixtures byte-matched to committed provider source before final runs.
  External Playwright/axe dependencies are supplied by `/tmp/ux-capture/node_modules`.

The hook now preserves exact worker ratios and their memo identity. Unsupported fraction sum/product/target
normalization returns unknown capacity and defers to existing worker validation instead of throwing during render.
Both formatting consumers handle unknown capacity. Supported comparisons retain the engine's normalization:
1.35 and its next JS double pass at Copies2.25/crafting speed0.3; 1.351 fails. Copies0.5 accepts0.3 and its next double,
and rejects0.301. These are genuine file/worker/App cases, not mocked facts.

Invalid Copies retains its full input text on blur. The shared default input format retains20 fraction digits for
Base UI validation and21 significant digits for controlled-value text. A bounded guard cancels only untouched,
default-format, in-bounds input-blur quantization. Actual edits, steps, clear, custom formats and bounds clamping
remain outside that guard. Tiny1e-23 import, repeated focus/Tab, reload, export, worker refusal, and correction to1/s
are exercised in the real production page; the build remains intact.

## Local and independent checks

Engine source is unchanged since `fe18341`; original logs remain under `/tmp/ux-upstream-evidence/compat-final`:

| Engine command | Result | Log |
|---|---|---|
| `npm run build` | PASS | engine-build.log |
| `npm test` | 1008 tests /76 files | engine-test.log |
| `npm run test:generation` | 142 tests /11 files | engine-generation.log |
| `npm run lint`, `npm run knip` | PASS; three existing knip configuration hints | engine-lint.log, engine-knip.log |

Fresh full UI gate at `4c8a6b9`; all commands exit0. Logs `/tmp/ux-upstream-evidence/compat-fixround1-format`:

| UI command | Result | Log |
|---|---|---|
| `node scripts/copy-factorio-data.mjs` | PASS | copy.log |
| `npx tsc -b` | PASS | tsc.log |
| `npm test` | 948 tests /54 files | test.log |
| `npm run lint`, `npm run knip` | PASS | lint.log, knip.log |
| `npm run check:icons` | 53 always-drawn icons present;378/737 optional names available | icons.log |
| `npm run build` | PASS; existing >500kB chunk advisory | build.log |

Luna independently repeated UI test/build on exact `4c8a6b9` in a detached tree with its own engine/UI dependencies:
`/tmp/ux-upstream-194-evidence/round1-4c8a6b9/RESULTS.md`. Root read actual948-test totals, build completion,
package-resolution identity and exit0 lines. Earlier926/939-test gates are historical, not the current gate.

## Final production browser evidence

Final root: `/tmp/ux-upstream-evidence/compat-round1-final`. Commands and exit codes are in CHECKPOINT.md;
complete assertion logs in `logs/`, indexes/screenshots under each named stage. All final commands are unfiltered.
Set `BASE_URL=http://127.0.0.1:5272`, `UI_DIR=/tmp/ux-upstream-compatibility/clock-generator-ui`, and
`SAMPLES_DIR=/tmp/ux-upstream-compatibility/clock-generator/resources/config-samples`.

| Script | Widths | Result | Output / log |
|---|---|---|---|
| `capture-upstream-compatibility.mjs` |1440/960/800/720/390|5078 PASS,0 FAIL,0 failed steps; exit0|core/INDEX.md; logs/core.log|
| `capture-rate-limit.mjs` |1440/720/390|156 PASS,0 FAIL,0 failed steps; exit0|rate/INDEX.md; logs/rate.log|
| `capture-first-visit.mjs` (`GEN_EACH` unset) |1440/720/390|1090 PASS,0 FAIL,0 failed steps; exit0|first-visit/INDEX.md; logs/first-visit.log|
| `capture-results-answer.mjs` |1440/720/390|790 PASS,0 FAIL,0 failed steps; exit0|results/INDEX.md; logs/results.log|

Updated selector selftest ALL PASSED on the same scripts, including new numeric/tooltip selectors:
`/tmp/ux-upstream-evidence/compat-fixround1-format/author-selftest.log`. Source identity was independently checked;
no redundant repeat was needed. Phase3-only stages explicitly report NOT RUN, never PASS.

Core totals:1020 each at1440/960/800/720;998 at390. At390 row geometry is observational; reachability, keyboard/focus,
actions, names and axe remain required. The expanded author run preceding the final core was2079/0/0 at three widths.
Core includes real fractional input and persistence, invalid blur, exact decimal equality/excess, tiny-rate recovery,
ordinary numeric no-drift/keyboard selection/steppers/typing, metadata and Automatic, Diagram Cancel/reopen/Save,
repeated-unit Check announcement and Generate error-note focus/name/description, examples and shared row geometry.

All nine example generations passed <=60s: logistic0.5s, automation0.9s, utility0.5s, chemical(shared-foundry)2.7s,
electromagnetic1.9s, military2.6s, production1.8s, metallurgic11.0s, agriculture13.4s. Root read all nine lines.

Measured original/new text contrasts remain in the per-width indexes: Copies helper8.37:1; inline errors7.42:1;
List metadata/Automatic7.00:1; Diagram metadata/Automatic8.37:1/7.00:1; repeated-unit guide14.06:1.
Shared axe runs15 selected rules and excludes canvas/React Flow by default; this is not exhaustive WCAG certification.

Root independently opened these final core shots:
- w720/05-f2-invalid-third-blurred-720.png
- w1440/09-r2-exact-capacity-2.25-1440.png
- w390/16-r3-tiny-rate-reload-visible-390.png
- w390/18-r3-tiny-rate-checked-visible-390.png
- w390/19-r3-worker-failure-visible-390.png

Visible-rate/error/corrected shots are separate from completed keyboard audits. Repositioning for a screenshot earns
no keyboard PASS. Full paths and accessible-name snapshots for every state are listed by the stage indexes.

## Capture diagnostics and historical evidence

All failed runs remain on disk, with exact runtime source archives. No failure was relabeled PASS and no original
assertion was dropped. The new core retains all69 original assertion lines.

- Initial round1 author run exposed real tiny-rate data loss after focus/blur. Sol's isolated log proved import1e-23,
  focus text0, blur storage0, reload0. Product4c8a6b9 fixes this; see compat-fixround1/tiny-focus-isolated.log.
- The first significant-digits-only proposal was rejected before implementation: installed Base UI would validate
  typed values at three fractional digits. The approved design preserves its original20-digit validation precision.
- R2 fixture comparison now projects target fields in a stable order; JSON key ordering is not a value difference.
- R2's transient axe region failure was the dismissed Facts tooltip still mounted with child opacity0. The capture
  waits for that tooltip to detach before Check/audit; no axe exclusion or product change. Exact DOM evidence:
  compat-fixround1-format/r2-tooltip-diagnosis.log.
- Save-file capture handles its pending download rejection, closes only an older Save notice and waits for the real
  menu layer to exit. This repairs capture focus sequencing without dropping keyboard assertions.
- N1 pointer traces showed a12ms press/release landing on different controls after focus-induced scrolling at narrow
  widths. The capture centers the field after its keyboard assertions, then performs a genuine mouse click and
  retains exact+0.1/restoration checks. See author-affected3.log and n1-pointer-summary.log; no precision relaxation.
- Previous round0 final runs remain at compat-core-final, compat-rate-final, compat-first-visit-repaired-final and
  compat-results-repaired-final. Their3088/156/1090/790 counts are historical; fresh shared-format regressions above
  supersede them. Earlier menu/clipboard/selector failures and interrupted runs are likewise retained.

## Scope boundaries

The minimal shared InsertersForm subgrid retains p2 Paper/filter behavior,130px Stack width,1600px one-row breakpoint
and full-row metadata. Diagram's visible/accessibility name includes beta. Full Build card/Panel/filter-slot features
and their final geometry remain2.7B. Phase3 library/share/rule timing/cache acceptance belongs to the adjunct and3.3.
No sidecar metadata extension, automatic repeated-unit converter, simulation/ranking change, dependency, settings,
CI or release change is included. Independent code/UX re-reviews and all owner checkpoints remain open.
