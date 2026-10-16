# 2.F factual copy and fractional scope evidence

Implementer: GPT-6.1 Sol, high reasoning, fast mode off. First recorded UTC: 2026-10-16 10:22:41.
Product head: `8e0b53dc45fc238caedde71a449b8c010574a7af`, from P2 `d90c9c4`; reviewed prior product
`3115caf106f0c0c0894ca448700553325413217b`. Later capture/evidence commits do not change that product.
Independent code/UX reviews and all three affected phase-persona rechecks remain the orchestrator's next steps.
This note does not approve installation, a phase merge, or any deferred work.

## Product and tests

Exactly five product files change: glossary.ts exports its unchanged approved provisional wake-up account;
wakeWindowCopy.ts retains its public alias; ClockAlternativesPanel.tsx composes the same account with its existing
per-minute/one-copy/long-run/sufficient-run/start-point qualifications; clockSummary.ts shows scope whenever Copies
is not exactly one; sidecarGuide.ts describes fewer inserter wake-ups without promising net UPS savings.
The provisional marker and owner's later strict-definition experiment remain. No engine, sidecar, arithmetic,
dependency, settings, version or layout change.

Existing clockSummary tests cover 0.0625, 0.5, 0.9999, 1, 1.0001, 2.25 and 11, preserving exact Copies, total-rate
rounding and one-copy wake-up scope. The existing glossary suite checks glossary/alias/Terms equality plus the
comparison's shared-source composition; the browser additionally compares all three actual rendered definitions.
These checks protect the counting distinction and shared source rather than mirroring a whole reversible sentence.

A separate diagnostic copy, `/tmp/ux-phase2-copy-regression-8e0b53d/clock-generator-ui`, used the new numeric tests
with the actual old 3115caf clockSummary.ts. It produced **3 failures / 42 passes**, precisely for 0.0625, 0.5 and
0.9999: the old result omitted the total caption while preserving the rate. Log:
`/tmp/ux-phase2-copy-gates-8e0b53d/old-summary-regression-corrected.log`. The first standalone diagnostic setup failed
before tests because Vite could not find its parent CHANGELOG.md; that log remains separately preserved as
`old-summary-regression.log` and is not claimed as an old-behavior regression. The immutable verifier was never modified.

## Immutable verification

Verifier: `/tmp/ux-phase2-copy-verifier-8e0b53d`, detached at the full product SHA above, outside ignored worktree paths.
Fresh `npm ci` in engine/UI used existing lockfiles unchanged. Actual UI dependency resolves to
`/private/tmp/ux-phase2-copy-verifier-8e0b53d/clock-generator`; it does not use the owner's engine dist.
Node v25.2.1, npm 11.6.2; no lockfile regeneration or dependency change. Engine and sidecar trees are byte-identical
to 3115caf. Their **1008 unit / 142 generation** evidence is explicitly inherited, not rerun for this UI-only correction.

Logs: `/tmp/ux-phase2-copy-gates-8e0b53d/`.

| Command in clock-generator-ui | Result |
|---|---|
| `node scripts/copy-factorio-data.mjs` | exit 0; generated data/examples only |
| `npm run build` | exit 0; builds this verifier's engine, tsc and production Vite assets |
| `npm test` | exit 0; 967 tests / 57 files passed |
| `npx tsc -b` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run knip` | exit 0; default invocation, no exclusions added |
| `npm run check:icons` | exit 0 |

Each independent check has its log and timestamped JSON exit record. `IDENTITY.json` records tool versions and
engine resolution. `SOURCE-ASSETS.json` records source trees, clean verifier status, all 412 production asset hashes
and exact full/affected capture runtime hashes. The existing Vite large-chunk advisory remains informational.

## Fresh browser evidence and retained failures

Only ordinary immutable production previews were automated: baseline5274 and own5300. Owner5280 was untouched.
No clipboard operations, fake worker results, request interception or direct persistence writes. Genuine test input
files derive from SMALL_SAMPLE with machine/inserter/belt configuration retained. Copies0.5/1/2.25 request total
10/20/45 per second, each20/s per copy below the real one-copy capacity. INPUTS.json preserves inputs and hashes.
Every fixture is imported through the actual file control, Check only is clicked and Check passed observed, then
Generate is clicked once and actual finished Recommended results plus enabled idle actions and no check error are
required within60 seconds. One completed0.5 result is reused across all definition surfaces at each width.

| Run | Result | Evidence root and UTC |
|---|---|---|
| Original baseline attempt retained by root | 24 PASS / 0 FAIL / 3 failed steps | `/tmp/ux-phase2-copy-before`; preserved original log/index |
| Corrected baseline, before any product edit | **99 PASS / 0 FAIL / 0 failed steps** | `/tmp/ux-phase2-copy-before-reconciled`; 10:23:17.102–10:23:20.585Z |
| Full after run, all three Copies controls | **777 PASS / 3 FAIL / 0 failed steps** | `/tmp/ux-phase2-copy-after-8e0b53d`; 10:25:30.875–10:25:44.220Z |
| Affected Terms/help keyboard rerun, same product | **498 PASS / 0 FAIL / 0 failed steps** | `/tmp/ux-phase2-copy-help-reconciled-8e0b53d`; 10:26:54.828–10:27:04.432Z |

All runs cover1440/720/390. Each root has INDEX.md, width indexes, actual PNGs/aria snapshots, INPUTS.json and RUN.json.
Logs are the sibling `.log` files. Final after/affected roots include exact executed `runtime/` files and
FILES-SHA256.json; runtime hashes agree with each RUN.json. Baseline SOURCE.json links root's frozen original manifest.

The first baseline runner incorrectly waited for Check passed after completed generation. Source checkChipOf
intentionally hides that redundant chip once fresh clocks exist. Root authorized moving its observation to an
actual Check only before Generate, retaining finished real results/idle/no-error/time requirements. The original
failed attempt remains unchanged. Root opened the corrected390 baseline and accepted the missing-caption proof
before product editing started.

The full after run's only three failures were the writer's assumption that Tab visits the Terms menu item.
MUI's real menu uses roving focus: Tab exits; ArrowDown visits items. The read-only probe in `menu-probe.log` showed
Open build file → Save build file → Try an example → Getting started → Terms. Root independently approved the
capture-only correction: Tab reaches the header button; bounded ArrowDown while the menu remains open must place
actual focus on Terms, fully in the viewport and unobscured; accessible name/visible label and actual mouse-open
checks remain. Existing openMoreMenu/chooseMenuItem are still the sole opening/selection helpers. The affected rerun
passes these checks and all Terms/expanded-help definition, mouse, keyboard, short-height focus, contrast and axe
checks. The previously passing first-visit and1/2.25 result evidence remains valid for the identical product. The
777/3 run is not relabeled PASS, and no fixture regeneration was needed outside the affected0.5 help path.

Adopted capture starts from writer SHA953f8999… (full writer manifest `/tmp/ux-phase2-copy-capture/HASHES.json`).
The shared lib preserves all89 pre-existing ui entries and adds16; no shared helper behavior, axe rules or exclusions
change. The final runner validates32 required ui bindings; `STATIC_ONLY=1` launches no browser. HELP_ONLY=1 selects
only the affected path; the default still covers first visit and all three real Copies controls.

## Observed results and screenshots

At every width, actual Makes results are10/s (`all 0.5 copies`),20/s (concise one-copy caption),45/s
(`all 2.25 copies`). Wake-ups remain75 a minute, `one copy` for all three. Rendered Wake windows and Terms definitions
are exactly equal; expanded help contains that account and every counting/run/start-point qualification.

Measured text contrast at all three widths: intro and expanded help15.72:1; Wake windows/Terms8.37:1; Makes13.58:1;
fractional caption and one-copy scope7.49:1. All exceed4.5:1. Every captured state runs the unchanged shared axe rules;
zero axe failures or missing-axe skips. Actual mouse visibility, accessible names, keyboard/focus and short-dialog
focus checks pass on the affected rerun. No sideways page overflow was found in these states.

Review images: full after `w{width}/01-first-visit-{width}.png`, `02-answer-copies-0.5-{width}.png`,
`08-answer-copies-1-{width}.png`, `09-answer-copies-2.25-{width}.png`; affected rerun
`w{width}/02-wake-windows-definition-{width}.png`, `03-terms-wake-up-{width}.png`, `04-terms-short-{width}.png`,
`05-expanded-table-wake-up-help-{width}.png`, `06-expanded-help-short-{width}.png`.
The implementer opened the actual390 fractional answer and720 expanded-help PNGs. Root separately verifies images,
UI tests/build and independent reviews. Historical phase390 limitations and explicit3.F/D1–D8 carries are unaffected.
