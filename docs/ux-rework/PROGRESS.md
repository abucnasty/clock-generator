# UX rework: progress ledger

The orchestrator updates this file after every step (see [ORCHESTRATOR.md](ORCHESTRATOR.md)). Its updates to the owner
come from here.

**Links:**
- **Docs:** [PLAN.md](PLAN.md) · [ORCHESTRATOR.md](ORCHESTRATOR.md) · [specs/](specs/) ·
  [capture/README.md](capture/README.md)
- **Review:** [SYNTHESIS.md](review/SYNTHESIS.md) · [A-newcomer.md](review/A-newcomer.md) ·
  [B-power-user.md](review/B-power-user.md) · [C-visual-a11y.md](review/C-visual-a11y.md) · [BRIEF.md](review/BRIEF.md)
- **GitHub:** [feat/ux-rework](https://github.com/abucnasty/clock-generator/tree/feat/ux-rework) ·
  [Phase 1 snapshot](https://github.com/abucnasty/clock-generator/tree/17a889d55e334e2dfbec2640a0f28444613c7693) ·
  [child PRs into feat/ux-rework-p1](https://github.com/abucnasty/clock-generator/pulls?q=is%3Apr+base%3Afeat%2Fux-rework-p1) ·
  [phase PRs into feat/ux-rework](https://github.com/abucnasty/clock-generator/pulls?q=is%3Apr+base%3Afeat%2Fux-rework)
- In the item tables, the item number opens its spec, and the PR column links the child PR once it is open.

**Status values:**

| Status | Meaning |
|---|---|
| `todo` | not started |
| `spec` | the spec is being drafted or reviewed |
| `impl` | being implemented |
| `evidence` | going through the evidence gate |
| `review` | the code review and the UX audit are running |
| `fix-1`, `fix-2` | fix rounds 1 and 2 |
| `merging` | the PR is open and waiting for CI |
| `blocked` | waiting on a checkpoint |
| `merged` | merged into the phase branch |
| `carried` | moved to a later phase |
| `dropped` | the owner decided against it |
| `deferred` | scoped for later; excluded from the current implementation queue |

## Current state

- **Phase:** 2 (Phase 1 merged into `feat/ux-rework`, #170, 877989d)
- **Branch:** [`feat/ux-rework-p2`](https://github.com/abucnasty/clock-generator/tree/feat/ux-rework-p2); the ledger lives here now. Phase 1 history is linked by its permanent commit and merged PR.
- **Open checkpoints:** 2.5 A's install steps in game (owner)
- **Phase 1:** merged into `feat/ux-rework` (#170) after the end review, its fixes (#168) and the owner's approval
- **Phase 2 remaining:** all items merged. Fresh four-width phase captures, three independent Sol/high personas, retro and owner install/phase checkpoints remain. 3.3 is merged into p3; combined P2/P3 verification is underway before 3.2 A.
- **Phase 2:** started early in idle slots on [`feat/ux-rework-p2`](https://github.com/abucnasty/clock-generator/tree/feat/ux-rework-p2) (cut from `feat/ux-rework-p1`; merges p1 in after each p1 merge)
- **Phase 2 end:** fresh main four-width walkthrough28/0/0 and extra two-width6/0/0; root caught a dialog entry-frame screenshot, preserved originals and verified rest-settled1440/extra reruns7/0/0 and6/0/0. [Evidence](capture/phase2-end-EVIDENCE.md). All three independent Sol/high/fast-off personas are reviewing the final images in parallel. Their verdicts and retro remain pending; install/phase owner checkpoints remain.

- **Upstream compatibility:** 0.15.1 and 0.15.2 (#193) downmerged and pushed through feature (`41eb648`),
  p2 (`9e2646c`) and p3 (`df21248`). Root checked the recorded test result lines; these historical integration gates
  do not replace the reviewed compatibility child's independent evidence. #194 at master `1d27cde` is frozen for
  the current integration cycle; fresh full gates passed and feature `cdf2425`, p2 `cf7a8c7` and p3 `66dc5c9` are pushed.
  Compatibility provider merged as [#195](https://github.com/abucnasty/clock-generator/pull/195), `c8ba1dd`:
  code and UX PASS after one fix round; CI unit/UI jobs pass (generation job skipped by existing workflow;
  local 142 generation tests pass). Full evidence: [provider evidence](capture/upstream-compatibility-EVIDENCE.md).
  Completed provider remote/local branch and worktree removed. Its [p3 adjunct](specs/upstream-0.15-compatibility-p3.md)
  merged as [#196](https://github.com/abucnasty/clock-generator/pull/196), `1d955b2`: independent GPT-6.1 Sol/high code and UX PASS after one evidence fix round; CI unit/UI pass, local142 generation tests pass. Source evidence is committed on p3. Completed adjunct remote/local branch/worktree removed; owner preview remains live. P3 now includes #197 at `865f460`; combined P2/P3 integration is being verified before promotion.
- **Worker checkpoints:** 2.7 B merged in #198 and 3.3 merged in #197 after final independent code/UX PASS and exact-head CI. See their item rows and evidence notes for final gates and retained failed runs. Combined merge product `83e2573` passes engine1008 unit/142 generation and UI1199 tests/69 files plus all other gates; root's independent test/build repeat passes. Capture-only `effe58e` repairs stale selftests; the three-width PHASE3 selector matrix now passes. Combined browser evidence and independent conflict-delta reviews remain before P3 promotion.
  The nested `.claude/worktrees` path makes Knip ignore its own npm script entries; standard Knip passes on identical detached trees outside that path. No source/configuration suppression was used. Future immutable verifiers use the established external layout; detailed failed/valid logs stay in the local evidence directories.

## Phase 1: stop the harm, quick wins

| Item (spec) | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| [1.1](specs/1.1-stale-results.md) | Never offer a stale blueprint | opus | merged | [#147](https://github.com/abucnasty/clock-generator/pull/147) | 1 | Code review Fable PASS, UX audit opus PASS (A5, B1, C5 fixed); cheap minors fixed before merge. CI green |
| [1.2](specs/1.2-header.md) | Header usable at every width | sonnet | merged | [#149](https://github.com/abucnasty/clock-generator/pull/149) | 2 | Code review opus PASS; UX audit FIX (focus under the header, 2.4.11) then PASS after round 1; a one-line minor in round 2. CI green |
| [1.3](specs/1.3-undo.md) | Undo snackbar for destructive actions | opus | merged | [#157](https://github.com/abucnasty/clock-generator/pull/157) | 2 | Bundle with 1.5. Code review opus PASS (minors); UX audit opus FIX: Undo timed out for keyboard users (2.2.1) → owner: no timer. A18, C15 fixed; B2 fixed within the plan; B3 partly (delete buttons unnamed: fixed in round 1). Re-review after round 1: both FIX on one shared major (the polite region sits in `#root`, which MUI's modal hides, so messages raised in or while closing a dialog aren't read). Round 2 (last): announce into an unhidden region→ both re-reviews PASS (announcer with a spare body-level region; checked in a browser). CI green |
| [1.4](specs/1.4-first-problem.md) | Disabled actions say what is missing | opus | merged | [#155](https://github.com/abucnasty/clock-generator/pull/155) | 1 | Bundle with 1.14 (`feat/ux-rework-p1-first-problem-warning`). Code review opus PASS, UX audit opus PASS (A6, B21, C10, C4 fixed); a minors round (8 cheap items). Also the 1.7 and 1.2 follow-ups (Search deeper's reason, Validate's scroll). 257 tests; capture 901 PASS, 2 FAIL (pre-existing 390 sideways scroll when stale, 2.9) Code re-check PASS; CI green |
| [1.5](specs/1.5-messages-footer.md) | Messages above the footer; quieter Ko-fi | opus | merged | [#157](https://github.com/abucnasty/clock-generator/pull/157) | 2 | Bundle with 1.3 (`feat/ux-rework-p1-messages-undo`). Merged #151 in (import-line conflict only). A14, A29, B30, C6 fixed; C3 partly (one filled button per state is 1.4's). Round 1: the untimed Undo, focus after Undo/Close, one live region with `announce()`, named delete buttons, 9 minors. Re-review after round 1: both FIX on one shared major (the polite region sits in `#root`, which MUI's modal hides, so messages raised in or while closing a dialog aren't read). Round 2 (last): announce into an unhidden region→ both re-reviews PASS (announcer with a spare body-level region; checked in a browser). CI green |
| [1.6](specs/1.6-recommended-clock.md) | Make the clock pick explainable | opus | merged | [#151](https://github.com/abucnasty/clock-generator/pull/151) | 1 | Bundle with 1.7. Code review opus PASS; UX audit opus minors only (A9, A11, B12, B14 fixed, C7 partly). Round 1: 13 cheap minors; orchestrator read the diff and shots. Runner re-ran checks after merging 1.9 in (235 tests). CI green |
| [1.7](specs/1.7-search-deeper.md) | "Search deeper" button | opus | merged | [#151](https://github.com/abucnasty/clock-generator/pull/151) | 1 | Bundle with 1.6. A22, B15, C27 fixed |
| [1.8](specs/1.8-expert-bugs.md) | Fix the dangerous expert bugs | opus | merged | [#148](https://github.com/abucnasty/clock-generator/pull/148) | 1 | Round 0: code review Fable PASS, UX audit FIX (prompt contrast). Round 1: both opus PASS. Minors fixed before merge. CI green |
| [1.9](specs/1.9-renumber.md) | One number per entity, everywhere | opus | merged | [#150](https://github.com/abucnasty/clock-generator/pull/150) | 1 | Round 0: code review and UX audit FIX (keyboard on the stale plan; 720 row). Round 1: both PASS. CI green |
| [1.10](specs/1.10-numbers-units.md) | Readable numbers and units | opus | merged | [#146](https://github.com/abucnasty/clock-generator/pull/146) | 1 | Code review Fable PASS, UX audit opus PASS; cheap minors fixed before merge. CI green |
| [1.11](specs/1.11-a11y-basics.md) | Accessibility basics | opus + sonnet | merged | A [#160](https://github.com/abucnasty/clock-generator/pull/160), B [#162](https://github.com/abucnasty/clock-generator/pull/162) | A 1, B 1 | A (opus): round 0 both FIX (`checkAnnounced` uncommitted; the inserter editor's Save bar covered a field), round 1, re-review both PASS. B (sonnet, stacked on A): round 0 code PASS, UX FIX (focusable chips inside the Transfer Plan's accordion button; no axe run), round 1 (+ an axe step that found a stepper id bug), re-review both PASS. C8, C9, C10, C13, C22, C25 fixed. CI green |
| [1.12](specs/1.12-glossary-copy.md) | Glossary and copy pass | sonnet | merged | A [#153](https://github.com/abucnasty/clock-generator/pull/153), B [#164](https://github.com/abucnasty/clock-generator/pull/164) | A 1, B 1 | A (sonnet): one minors round. B (sonnet, 40 files, stacked on 1.11 B): round 0 both FIX (the clock status detail; the Validation panel's hands/transfer plan), round 1, re-review both PASS. A25, B32, C30 fixed. README "Words in the UI" adds two rows for the owner (swing plan, start point). CI green |
| [1.13](specs/1.13-enable-chip.md) | Enable mode shown on the row | sonnet | merged | [#145](https://github.com/abucnasty/clock-generator/pull/145) | 1 | Code review opus, UX audit sonnet: FIX, then PASS/PASS. CI green. Forced-ALWAYS wiring moves to 1.9 |
| [1.14](specs/1.14-warning-colour.md) | Warning colour apart from the brand orange | opus | merged | [#155](https://github.com/abucnasty/clock-generator/pull/155) | 1 | Bundle with 1.4. C4 fixed Code re-check PASS; CI green |

## Phase 2: newcomer-first structure

| Item | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| [2.1](specs/2.1-first-visit.md) | First visit and the way in | opus | merged (p2) | [#172](https://github.com/abucnasty/clock-generator/pull/172) | 1 | Round 0: code review opus FIX and UX audit opus FIX on one major (focus fell to body after the intro card's actions). Round 1: one focus target (the Target Output heading), announced paste prompts, plain errors, wording, one filled button on first visit. Re-checks both PASS. A1, A2, A3, A4, A15, A17 and Phase 1 end 1, 2, 3, 13, 14, 20 fixed. Capture 368/350/349 PASS; 2 FAIL at 390 are 1.5 F's (message over the heading). CI green. The target-rate addendum split into 2.1 W |
| [2.1 W](specs/2.1-first-visit.md) | Target-rate limit | opus | merged (p2) | [#173](https://github.com/abucnasty/clock-generator/pull/173) | 2 | Split from 2.1. Owner: block with the clear line (the engine refuses such targets). Round 1 code review opus FIX (2-decimal boundary let a refused target through; engine compares exactly and picks machines by output item); UX sonnet PASS with wording. Round 2: exact compare, figures rounded down, machines by output item, "At most 252.65/s: …" wording; re-check PASS (agrees with `validateConfig` at every boundary). Capture 153 PASS. CI green. Implementer wrote its own capture |
| [2.2](specs/2.2-sidecar.md) | Sidecar mod changes | opus | merged (p2) | [#154](https://github.com/abucnasty/clock-generator/pull/154) | 0 | Into `feat/ux-rework-p2`. CI green. **In-game check: passed** (owner, 2026-10-14: "looks good"). Code review opus PASS (Lua read line by line; checks re-run); UX audit sonnet FIX on the owner steps only (fixed by the orchestrator). A17, Q3 fixed; A2, A3 partly (site side is 2.1); B19 to 2.1. Started early on `feat/ux-rework-p2-sidecar` (from `feat/ux-rework-p2`, cut from p1 at 9505eca). Checkpoint: owner runs the in-game steps |
| [2.3](specs/2.3-validate-into-generate.md) | Fold Validate into Generate | opus | merged (p2) | [#161](https://github.com/abucnasty/clock-generator/pull/161) | 1 | Round 0: code review opus PASS (races fine); UX audit opus FIX (a mouse click on Check only looked silent). Round 1: a visible landing and the reason in the tooltip, plan stays mounted, alert named, announcements in 1.11 A's rule set; merged 2.11 and 1.11 A. Re-review both PASS: A12, B10 fixed. CI green |
| [2.4](specs/2.4-belt-question.md) | Ask the belt question | opus | merged (p2) | [#163](https://github.com/abucnasty/clock-generator/pull/163) | 0 | Code review opus PASS (storage, 2.3 interplay, double press, hint all checked; deviations accepted); UX audit opus PASS: A10 fixed, C7 (2.4's part) fixed. 498 tests; capture 274 PASS, 1 FAIL = 1.5's message over the action at 720 (ledgered). CI green |
| [2.5](specs/2.5-results-answer.md) | Results lead with the answer | opus | merged (p2) | A [#176](https://github.com/abucnasty/clock-generator/pull/176), B [#182](https://github.com/abucnasty/clock-generator/pull/182) | A 2, B 1 | A: the "Your clock" card, plain clock names and tiles, install steps from the clock, wiring list with **item icons** (owner), drills from the clock. Round 0 both FIX; round 1 both PASS; minors round PASS; Never on wording corrected (owner kept "keep it off yourself"); merges with 2.1, 2.1 W, 1.5 F, 2.8 b; final re-checks PASS. A21 fixed; A8 in app. **Owner approved merging before the in-game check; the check now holds the Phase 2 PR.** CI green. B merged at c95d964. Round 0: code PASS, UX FIX on five cheap minors; round 1 both PASS. Captures: results-b 654/0, results-answer 264/264/262 PASS at 1440/720/390 (0 FAIL), text-names 1113/0; 878 tests. |
| [2.6](specs/2.6-wake-windows.md) | Wake windows view | opus | merged (p2) | [#156](https://github.com/abucnasty/clock-generator/pull/156) | 1 | Code review opus PASS (window maths correct; checks re-run), UX audit opus PASS (C2 fixed for the new chart; old charts → 2.5/2.10); one minors round, re-checked. CI green. Follow-up PR: switch to `announce()`, drop `scrollMarginBottom` |
| [2.7](specs/2.7-gui-grammar.md) | Factorio GUI grammar pass | opus; Sol rechecks | A+B merged (p2) | A [#177](https://github.com/abucnasty/clock-generator/pull/177), B [#198](https://github.com/abucnasty/clock-generator/pull/198) | A2; B1 | B merged869318b after final minors and owner-approved explicit Stack helper removal. Historical round1 PASS retained; final Sol/high code and UX PASS. Full gates engine1008/142/UI961+repeat; Build fivewidth1856/0/0, firstvisit1090/0/0, repaired GUI dialogs426/0/0 and beltDiagram27/0/0. Failed originals preserved in [evidence](capture/build-card-EVIDENCE.md). Halfwidth775/9/0 reproduces exact historical390 limitations;720–1440 PASS. One cosmetic Automatic-helper filter alignment follow-up assigned to3.2A; explicit alignment closed. CI green; install/phase owner checkpoints retained. |
| [2.8](specs/2.8-item-names.md) | In-game item names | opus + sonnet | merged (p2) | a [#171](https://github.com/abucnasty/clock-generator/pull/171), b [#175](https://github.com/abucnasty/clock-generator/pull/175) | a 1, b 2 | a (opus): pickers show game names; ids stored. b (sonnet): names in every text site; **owner: item icons in the Wake windows rows** (game name as hover and screen-reader name); internal and hidden entries out of the pickers, recycling recipes found by typing (orchestrator); sentence-case type labels. b round 0 code PASS / UX FIX (rows broke at 390, no icon shots); round 1 both PASS; minors round PASS. A27 fixed (Insights engine prose partly). Capture b 1005/0. CI green. 2.5 A's wiring list gets the icons when it merges (`row.detail` removed) |
| [2.9](specs/2.9-half-width.md) | Half-width layout | sonnet | merged (p2) | [#184](https://github.com/abucnasty/clock-generator/pull/184) | 1 | Merged at 96a69c7. Round 0 code PASS / UX FIX; round 1 both PASS. C#1 fixed at 720–960; C#10 fixed. Capture 775 PASS / 9 FAIL, all at out-of-scope 390; 884 tests. Shared AXE_RULES now includes landmark-unique. |
| [2.10](specs/2.10-timelines.md) | Developer timelines: light fixes | sonnet | merged (p2) | [#165](https://github.com/abucnasty/clock-generator/pull/165) | 1 | Sonnet. Code review opus PASS, UX audit sonnet PASS (C11, C12, the fuel chart's name); one minors round (Blocked painted last, device-pixel rounding), re-check PASS. CI green |
| [2.11](specs/2.11-diagram.md) | Diagram readability | opus | merged (p2) | [#159](https://github.com/abucnasty/clock-generator/pull/159) | 1 | Code review opus and UX audit opus: ESCALATE on the 720 fullscreen fit ("No minZoom"); orchestrator ruled lowering minZoom allowed (spec clarified). Round 1: minZoom 0.1, compact layout, React Flow descriptions, in/out twins, Tab order. Re-review: both PASS (B17, C20 fixed; B16 partly by decision). White node focus ring by design. CI green |
| [1.5 F](specs/1.5F-messages-clear.md) | Messages that don't cover the page | opus | merged (p2) | [#174](https://github.com/abucnasty/clock-generator/pull/174) | 0 | Messages in the sticky header (and the fullscreen title bar); Undo ends when a check or generation starts (owner); stale errors close on a dialog or a retry; one polite announcement each. Code review opus PASS, UX audit opus PASS (the raised-priority follow-up, A6, A7, B1, B11, C5 fixed); merged 2.1 and 2.1 W (stale errors on 2.1's flows), re-check PASS. Capture clear 1045/5, undo 1372/3 (all pre-existing; Copy tooltip → 2.7 A). CI green |

**Phase 2 chains** (re-derived at the Phase 1 end, coach run 5; a freed slot goes to the unblocked item heading the longest chain):

| Chain | Length | Next unblocked |
|---|---|---|
| Reviewed compatibility → 2.7 B → 3.2 A → 3.2 B | 2 | Compatibility and2.7B merged; propagate updatedP2 intoP3 and verify combined tree, then3.2A;3.2B two units afterA |
| 3.3 | complete | #197 merged865f460, formalround2 codePASS/round1UXPASS; owner checkpoints retained |
| Frozen master #194 → feat/ux-rework → p2 → p3 | complete | All three full gates and pushes done; in-flight merged-tree type-check sweep underway |
| Phase 2 end | | All items merged; freshfourwidth capture, three Sol personas and phase coach next. Install check holds phase PR, owner approval holds phase merge |

## Phase 3: expert depth

| Item | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| [3.1](specs/3.1-rule-editor.md) | Rule editor upgrades | opus | merged (p3) | [#179](https://github.com/abucnasty/clock-generator/pull/179) | 1 | Stacked on 2.7 A, reviewed against its head (coach run 6). Live "In words" sentence, "In the blueprint" note (rules shape the planning run only; engine-verified), Clocked strip against the clock's windows, inline problems block Save (shown after leaving a field or a refused Save), templates ask item and amount; latched template releases on the source's level (owner; engine-verified to match the sample). Round 0 code PASS / UX FIX (errors on untouched fields); round 1 both PASS. B8, B9 fixed. Capture 902/0. CI green. First Phase 3 merge |
| [3.2](specs/3.2-editing-at-scale.md) | Editing at scale | opus | spec | | | Spec final. Two PRs: A (one inserter editor, draft dialogs, B26; one unit) after 2.7 B and 2.8 b; B (duplicate, reorder with Undo, bulk edit; two units) after A and 1.5 F |
| [3.3](specs/3.3-cancel-keep.md) | Cancel, and keep the results | opus; Sol fix/rechecks | merged (p3) | [#197](https://github.com/abucnasty/clock-generator/pull/197) | 2 | Merged865f460. Native IndexedDB10builds/~64MB, kept choice/results, immediate Cancel and worker recovery. Sol/high UX round1 PASS; code round1 FIX on startup-dead-worker next-action hang, formalround2 PASS after9 meaningful lifecycle regressions. UI1186/full gate+independent repeat PASS; original full661/0/library375/0, affected489/0/0 and strengthened startup237/0/0. Capture minor closed; no unresolved blocker/major. [Evidence](https://github.com/abucnasty/clock-generator/blob/865f460c36b71108e7e9b2d20ef40f13997de836/docs/ux-rework/capture/cancel-keep-EVIDENCE.md). CI green; no engine/dependency/version change. |
| [3.4](specs/3.4-build-library.md) | Build library and share links | opus | merged (p3) | [#180](https://github.com/abucnasty/clock-generator/pull/180) | 1 | "Your builds" switcher, migration of the single save, other-tab warning, share links (`CompressionStream`, no dependency; owner-approved terms). Round 0 code PASS / UX FIX (a new build showed the previous recipe — `ItemSelector` now controls its input, closing the 1.3 stale-text follow-up); round 1 both PASS; a flaky first-visit check was a script race (menu exit time), fixed in the script. Post-merge type-check caught duplicate hooks with 2.5 A. B20 fixed. Capture 1077/0. CI green |

## Deferred roadmap

| Item | Title | Status | Notes |
|---|---|---|---|
| [D1](specs/D1-compact-view.md) | Compact view | deferred | Owner requested roadmap scope only: denser Results/forms, fewer redundant labels/helpers, shorter title/workflow header, version visible without scrolling. Preserve essential feedback/accessibility; revisit after broader audit. No implementation or current release-scope expansion. |
| [D2–D8](specs/deferred-design-discussion.md) | Design discussion drafts | deferred | Owner requested later discussion of theme switching, task-based audit, recommendation rationale, exception hierarchy, display settings, working-context preservation and per-machine target/max/achieved rates. Reconcile overlaps with D1/3.3; no current implementation scope added. |

## Decisions log

- 2026-10-16: Phase-end coach verified PR handling already takes about 2.5 minutes and final parallel reviews about 5 minutes; capture drift was the larger avoidable delay. Applied two routine recommendations: reconcile all affected capture consumers with bounded probes before full runs, and standardize immutable verifiers outside ignored worktrees with local-engine source proof. Full gates, independent reruns, three phase personas and owner checkpoints remain. Deferred source-review/capture overlap suggestion; current physical slots are occupied and complete fresh evidence is imminent.
- 2026-10-16: #197 merged865f460 intoP3 and #198 merged869318b intoP2 after exact-head CI and independent passing reviews. Completed child origin/local branches, original worktrees and placeholders removed after clean-tree verification; phase/master boundaries retained.
- 2026-10-16: Reconciled3.2 spec with resolved Q2/Q3(a), sentence-case Stack size and approved shared metadata/helper behaviour. Carry Automatic-helper filter alignment into3.2A with explicit input-box geometry acceptance (31.86px baseline at1440/800/720); no deferredD1–D8 scope added.
- 2026-10-16: Owner requested showing each machine’s target production rate, alongside maximum capacity. Added deferred D8 draft, with likely engine/worker/UI scope, explicit units and distinction from achieved output; no current engine changes authorized.

- 2026-10-16: Owner requested recording the additional design recommendations for later discussion. Added deferred D2–D7 draft backlog; existing implementation queue, phase gates and release scope remain in place.

- 2026-10-16: Owner requested compact-view planning and explicitly deferred implementation. Added PLAN's deferred D1 section and scoped spec; current roadmap execution and phase criteria remain in place.

- 2026-10-16: Temporary owner model override: every worker, including every reviewer and all three phase-end personas, uses GPT-6.1 Sol / high reasoning / fast off until revoked. Owner handles parent model. Replace Astra workers on next use; preserve role independence, review rounds and all verification/checkpoints.

- 2026-10-16: Owner preview correction: remove “Items per swing. Clear for Automatic.” under explicit Stack size fields and reclaim its helper space, in both List and Diagram. Include in the pending P3 compatibility adjunct and carry to2.7B; preserve Automatic explanations, values and clearing semantics. Focused five-width visual/accessibility checks passed (1483/0/0); owner approved the preview improvement, reserving a broader audit for later. Existing review counters and phase/install checkpoints retained.

Owner decisions made after the plan was written, and every change to [PLAN.md](PLAN.md), with the date.

- 2026-10-16: Owner requested cleanup of obsolete origin branches. Deleted `feat/goal-2-true-starts` (#185),
  `feat/rule-count-advice` (#178), `feat/true-start-count` (#181), `fix/recorder-near-lane` (#193), and
  `feat/ux-rework-p1` (#170). Root verified each current remote tip exactly matched its merged PR head,
  each merge commit remained reachable from its target branch, no open PR or attached worktree used the branch,
  and the five remote refs were absent after deletion/prune. Phase 1 ledger links now use a permanent commit.
  Retained active feature/phase/child branches and `trial/s5-slack-first`, which has no matching merged PR.
  Inventory and pre-deletion SHAs: `/tmp/ux-origin-cleanup/INVENTORY.md` and `source.json`.

- 2026-10-16: Owner paused and explicitly resumed the session. Runtime now reports unrestricted filesystem/network
  and no command approvals. Previous agents were unavailable; replacements retain Astra/high implementation,
  Luna/high checks and Sol/high capture roles. No owner checkpoint was waived.
- 2026-10-16: Corrected the post-merge check setup: linking main UI dependencies resolved stale main engine dist,
  so those TypeScript failures were invalid evidence. Fresh isolated local-engine builds passed merged-tree tsc for
  build-card `90ce76c`, cancel-keep `49f6cc6` and compatibility `d33b6e1`. Independent compatibility product
  `fe18341` passed UI 926 tests, tsc and build; root inspected command exits and counts. Logs:
  `/tmp/ux-upstream-194-evidence/independent-postmerge/`. New product repairs will need fresh checks.
- 2026-10-16: Compatibility browser evidence identified genuine Destination truncation and a Diagram beta
  accessible-name mismatch alongside capture setup defects. Orchestrator authorized minimal reuse of the existing
  ce131ae inserter grid for changed metadata rows, retaining the old outer card and deferring full Build card,
  Panel and filter-slot work to 2.7B. Both specs record the shared-hunk reconciliation; final geometry remains required.
  Finalized the Phase 3 adjunct spec around the two effective-capacity rule callers and genuine persistence/share
  boundary tests; pending 3.3 retains its cache feature and current review rounds.

- 2026-10-16: Fresh session resumed from the owner's handover after the previous session stopped. The owner confirmed
  parent Astra / High / fast off in the client; tools could not independently verify or change the parent setting.
  Fresh worker assignments explicitly set: compatibility implementation `gpt-6-astra/high` (two units), #194 mechanical
  gates/merges `gpt-6-luna/high`, capture authoring `gpt-6.1-sol/high`. Every review and coach remains Astra/high.
  Preserve the dirty compatibility worktree; backups are recovery-only. No new scope decisions were reopened.
- 2026-10-16: Reconciled the completed #193 chain from fetched refs and durable logs: feature `41eb648`
  (943 engine unit / 142 generation / 349 UI), p2 `9e2646c` (1004 / 142 / 885), p3 `df21248`
  (1004 / 142 / 1010). The #194 local merge `cdf2425` had no completed gate before the stop and was not pushed.
  Freeze master `1d27cde` while gathering fresh integration/compatibility evidence. No game harness result is claimed.
- 2026-10-16: Fresh Luna integration gates completed and root inspected durable result lines for #194:
  feature `cdf2425` (946 engine unit / 142 generation / 349 UI) and p2 `cf7a8c7` (1007 / 142 / 885),
  with engine/UI build, lint, knip, UI tsc and icons passing. Both were text-clean and fast-forward pushed;
  main p2 fast-forwarded with its documentation edit preserved. P3 `66dc5c9` then passed the same full gate
  (1007 / 142 / 1010) and was fast-forward pushed. No conflict resolution, game harness run or new version bump.
  The compatibility implementer preserved/completed WIP in `100b704`, added capture tooling in `a0a6084`, and
  merged the tested p2 base at `fe18341`; final child evidence/reviews remain pending.

- 2026-10-16: Upstream 0.15.1 integration completed through feature → p2 → p3. Reported gates, checked against logs:
  feature 943 engine unit / 142 generation / 349 UI tests; p2 1004 / 142 / 885; p3 1004 / 142 / 1010.
  Locale names and UX conflict resolutions retained. Post-merge checks of the two active item branches are text-clean;
  scratch merged-tree type checks remain queued for a Luna runner. This is integration evidence, not final product review.
- 2026-10-16: Master moved again to `da6867f` (#193, 0.15.2; sidecar 0.7.1). Root inspected the lane-signature fix.
  Integrate this existing upstream bugfix separately through the same chain, under the owner's upstream authorization.
  PLAN release baselines updated; final sidecar 0.8.0 unchanged. Deferred new metadata export stays out of scope.
- 2026-10-16: Owner asked that finished Astra workers give way to the agreed role models. Completed workers receive
  no unrelated small tasks: Sol handles capture/scouting/contained implementation, Luna mechanical gates/merges,
  Astra high complex implementation and every review. Fast mode remains prohibited.

- 2026-10-14: The orchestrator runs on Opus 5.5. Code review of the items implemented on `opus` uses Fable 5.1.
- 2026-10-14: 1.9, the id question: the owner chose the recommendation. Delete renumbers the remaining ids of its kind
  and remaps every reference; the UI-only `next_ids` and `retireId` go, and old saved forms that carry `next_ids` still
  load (the field is ignored).
- 2026-10-14: The owner allowed specs to be drafted ahead without limit; implementation stays at two items at once with
  no file in common. [ORCHESTRATOR.md](ORCHESTRATOR.md) ("The loop for each plan item") is updated to say so.
- 2026-10-14: The owner raised the implementation cap from two items at once to three (still no file in common).
- 2026-10-14: The owner gave the orchestrator the call on implementation and merge order. [ORCHESTRATOR.md](ORCHESTRATOR.md) says so.
- 2026-10-14: Order change from the plan's "1.1 to 1.3 first": 1.5 goes before 1.3, so the Undo snackbar is built
  once on 1.5's `notify()`. Planned order for the shared-file chain: 1.1 → 1.2 → 1.5 → 1.3 → 1.4 → 1.14; 1.6 and 1.7
  after 1.1 (1.10 before 1.6); 1.9 after 1.8.
- 2026-10-14: The owner approved the 1.12 glossary, question by question; the answers are in
  [specs/1.12-glossary-copy.md](specs/1.12-glossary-copy.md) ("Owner's glossary decisions"). Changes from the proposal:
  "jammed" (output blocked) and "starved" (input runs out) are two words, not one "jam". "Wake-up" is provisional: the
  owner will write a strict definition after a separate experiment, and updating the definitions is then the first
  task.
- 2026-10-14: [PLAN.md](PLAN.md) 2.5 gains the Terms popover (the owner's glossary decision).
- 2026-10-14: The owner asked the orchestrator to stay responsive and to delegate mechanical steps (check runs, PR,
  CI wait and merge, rebases) to background agents. [ORCHESTRATOR.md](ORCHESTRATOR.md) "Staying responsive" says how.
- 2026-10-14: The owner asked for stale branches to be removed as the work goes. [ORCHESTRATOR.md](ORCHESTRATOR.md)
  "Staying responsive" has the branch sweep.
- 2026-10-14: The owner moved every code review to `opus`, replacing Fable 5.1 for the items implemented on `opus`.
  The first-round reviews of 1.1, 1.8 and 1.10 ran on Fable; every review from now on, re-reviews included, runs on
  `opus`.
- 2026-10-14: To speed the work up, the owner approved three changes, now in [ORCHESTRATOR.md](ORCHESTRATOR.md):
  bundles (1.5 + 1.3, 1.4 + 1.14, 1.6 + 1.7), items that share files may run at once (each merges the phase branch and
  resolves its conflicts), and lighter evidence (a shared capture helper, "before" shots only where the review has
  none, no re-capture after a minors-only fix round). [PLAN.md](PLAN.md) "Child PRs" notes the bundles. Fast mode is
  off limits (the owner).
- 2026-10-14: The owner asked for an agent that suggests process improvements. [ORCHESTRATOR.md](ORCHESTRATOR.md)
  "Process coach": a read-only `opus` agent run after every third merge, at each phase end, and on request; the owner
  approves any change it suggests. Its brief is in the role briefs (no `.claude/agents` file, so nothing outlives the
  rework).
- 2026-10-14: Process coach run 1. The owner approved its suggestions 1-4, and gave the orchestrator the call on future
  coach suggestions (asking only when unsure or when a suggestion lowers the bar). Applied in
  [ORCHESTRATOR.md](ORCHESTRATOR.md): faster capture in `lib.mjs`; four units at once (a 20+ file item counts as two); a
  `sonnet` capture writer alongside each implementer; contrast and accessible names in the evidence gate. The
  orchestrator also applied suggestion 5: Phase 2 specs are drafted now, 2.2 and 2.5 go first in Phase 2 so the owner's
  in-game checks overlap other work, and `capture.mjs` is kept working as items merge.
- 2026-10-14: The owner asked for distinct agent names. Agent descriptions now follow `<item> <role>: <topic>`
  ([ORCHESTRATOR.md](ORCHESTRATOR.md) "Staying responsive").
- 2026-10-14: The rounded clock's non-integer decider constant (`decider-combinator.ts:82`, e.g. `signal-clock <
  90.947…` for a clock labelled as rounded to 90): the owner chose to leave it as a known issue for after the rework.
- 2026-10-14: The owner wants every issue found filed on GitHub, in one pass at the end with a review step by the
  owner. [PLAN.md](PLAN.md) "The final PR" gains step 0 (draft `ISSUES.md`, owner review, `gh issue create`). No
  issues are filed before then.
- 2026-10-14: 1.8 runs alongside 1.1 (no file in common), ahead of 1.2 and 1.3, which share files with 1.1.
- 2026-10-14: **Undo has no timer** (the owner, on the 1.3 UX audit's WCAG 2.2.1 major): the Undo message stays until
  the next edit, the next undoable action, Close or Escape, and Ctrl/Cmd+Z works while it is offered. Other messages
  keep their timers. [PLAN.md](PLAN.md) 1.3 updated.
- 2026-10-14: Process coach run 3 ([ORCHESTRATOR.md](ORCHESTRATOR.md) updated). Throughput rose from one merge per
  23.7 min to one per 19.2 min. Applied: (1) a unit that only waits on another branch counts as zero units, a stacked
  item starts once its predecessor's interface is committed (1.11 B started on 1.11 A's head), and a cross-item API
  decided mid-flight is written into both specs as an exact export; (2) a Phase 2 chain table drives slot choice (2.3
  next), and 2.11 merges when ready with 2.9 re-sweeping the diagram; (3) an implementer sends the code reviewer a
  short design note before building a new mechanism in a fix round, and `lib.mjs` gains `checkAnnounced`; (4) an
  implementer skips merging the phase branch when only the ledger moved, and ledger updates are batched with merges.
  Note on run 2's rule: 1.12 A's minors round was re-checked by the orchestrator reading the 3-line diff, not by the
  reviewer.
- 2026-10-14: 2.2 checkpoint closed: the owner installed the built sidecar from `feat/ux-rework-p2` and reported "looks good".
- 2026-10-14: One polite announcements region for the whole app: 1.5's message host owns it and exposes `announce()`;
  1.11 PR A routes its workflow announcements through it instead of adding a region in the workflow bar.
- 2026-10-14: Process coach run 2 ([ORCHESTRATOR.md](ORCHESTRATOR.md) updated). Applied: (1) a freed slot goes to the
  item at the head of the longest remaining chain, so 1.11 PR A starts now, and tail items stack on the one before;
  (3) `lib.mjs` gains `tabTo`, `focusNotObscured` and `inertFromKeyboard`, and every capture script checks keyboard reach,
  focus not obscured and keyboard-inert disabled states for what the item changes; (4) the handoff note is kept current
  on every step, agent reports are capped at about 30 lines (details in EVIDENCE.md), and a minors-only fix round is
  re-checked by the reviewer whose minors were fixed; (5) after each merge, `git merge-tree` checks every in-flight
  branch and a conflicting one merges at once, and merge runners use `gh pr merge --squash` then
  `git push origin --delete`. Suggestion 2 (start Phase 2 items before Phase 1 merges) changes a PLAN.md rule, so it
  went to the owner, who approved it: `feat/ux-rework-p2` is cut from `feat/ux-rework-p1`'s head when a slot goes
  idle, starting with 2.2 and 2.6 (then 2.11); [PLAN.md](PLAN.md) "Phase branches" updated.

- 2026-10-14: Process coach run 4 ([ORCHESTRATOR.md](ORCHESTRATOR.md) updated): one merge per 18 min (about 10
  without the 48-min restart stall). Applied: (1) read-only agents count as zero units; 2.10 gets its own chain and the
  next free slot; `master` is merged into `feat/ux-rework` now (merge-tree clean); (2) after 1.12 B merges, its
  implementer does the p1→p2 merge and applies the glossary to Phase 2's new copy; post-merge conflict checks include
  p1→p2 merges; phase-end findings on screens Phase 2 rebuilt are carried to that item; (3) `checkAxe` on every
  captured state, focus-not-obscured at a short height, and a visible change after a mouse activation; (4) resume
  lines in the handoff, push after every commit, resume all agents first after a restart; (5) capture writers start
  as soon as a spec is final.
- 2026-10-14: `master` moved outside the rework: the owner merged #158 (engine fix for issue 152, release 0.9.1;
  24 files in `clock-generator/`). Done (coach run 4): `master` merged into `feat/ux-rework` at 2d6aff4; engine 734 tests and UI checks pass; generation tests run 38651863631 passed; both phase branches merge it cleanly, run the engine and generation tests there, and start the final PR's version bump from
  0.9.1.

- 2026-10-14: Phase 1 end review ([reviews and synthesis](review/phase1-end/)). Owner: **the Undo offer ends when a check
  or a generation starts** (review B; recommended); [PLAN.md](PLAN.md) 1.3 updated; built in the new item 1.5 F
  (messages in the sticky header). Phase-end fixes on p1: the chip focus ring, the belt lane row at 390, the stale
  "Clock-only output" copy.
- 2026-10-14: Process coach run 5 ([ORCHESTRATOR.md](ORCHESTRATOR.md) updated). Applied: (1) Phase 3 scouts start now
  and specs name the items they follow; (2) stack whenever the predecessor is only in review, fix, minors or owner check
  (2.7 A on 2.5 A), and the install steps go to the owner alongside the minors round; (3) a chain edge needs a file or an
  API, not a final layout: 2.9 runs after 2.5 B, beside 2.7; (4) the 20-file rule counts existing files only (2.1 is
  one unit), and a two-unit chain head is passed over at most once; (5) a shared selector map and tooltip and menu
  helpers in `lib.mjs`. Not paying off: the chain table went stale (re-derived now, after every unblocking merge).
- 2026-10-14: 2.8 a: the spec's "science pack lists Logistic first" and "fluoroketone cold lists the fluid" can't hold
  (ties keep data order; no picker lists fluids). The orchestrator changed both checks; the spec is corrected.

- 2026-10-14: Phase 1 merged into `feat/ux-rework` (#170, merge commit 877989d; the owner approved; CI passed).
- 2026-10-14: `master` moved again outside the rework: #166 (the even hands clock, release 0.10.0). Merged into
  `feat/ux-rework` (3306841; engine 739 and UI tests pass; generation tests run 38661710992 passed) and on into
  `feat/ux-rework-p2` (3e4c8d7). A scout found no UI change needed: the clock is grouped, named ("Fewest wake-ups" in
  the card) and wired correctly. The final PR's version bump starts from 0.10.0.
- 2026-10-14: Owner decisions after the Phase 1 end review: a target above what the machines can make **warns, doesn't
  block** (2.1); drag reorder **stays with a message and Undo** and Move up/down (3.2); Diagram dialogs are **drafts
  with Save** (3.2); the terms **"Your builds" and "share link"** are approved with **no new dependency** (3.4);
  results storage **10 builds, about 64 MB, no fake-indexeddb** (3.3); the latched template **releases on the
  source's level** like the owner's sample (3.1). [PLAN.md](PLAN.md) 2.1 and 3.1–3.4 updated; Phase 3 specs committed.
- 2026-10-14: 2.5 A install steps: step 6 and the nothing-to-wire step were wrong for an inserter set to Never on (found
  by the 3.1 spec writer); corrected, and the owner is asked how a player should keep one switched off in game.

- 2026-10-14: Target above what the machines can make: the engine refuses it, so the earlier "warn, don't block" could
  only end in a failed run with the engine's text. The owner chose **block, with the clear line** (2.1 W).
  [PLAN.md](PLAN.md) 2.1 updated.
- 2026-10-14: Phase 3 started early in an idle slot: `feat/ux-rework-p3` cut from p2 (b8dc424) and fast-forwarded to
  p2 after each p2 merge while no Phase 3 item has merged. 3.1 stacked on 2.7 A. It was paused once when two waiting
  items went back into fix rounds and the four-unit cap was exceeded; the orchestrator now counts a waiting item's
  slot as reserved until its re-review lands.
- 2026-10-14: 3.1: a Clocked range ending at tick 0 is refused ("The end must be tick 1 or later."), since the engine's
  schema needs a positive end.

- 2026-10-15: Process coach run 6 ([ORCHESTRATOR.md](ORCHESTRATOR.md) updated). 32.6 min per item since run 5 (20
  min per PR); half the slots idle behind one owner check. Applied: (1) **owner approved**: 2.5 A merges when its
  reviews pass and the in-game check of the install steps holds the Phase 2 PR instead ([PLAN.md](PLAN.md) updated);
  (2) unit counting: an item counts while its implementer works and during its first review; re-reviews, owner checks,
  CI and predecessors count zero; a returning round over the cap pauses the newest item (replaces "reserved until
  re-review"); (3) stacked items take the phase branch only through their predecessor and are reviewed against its
  head; (4) premise check and one batched message for owner asks; `ISSUES.md` drafted at the Phase 2 end; (5) type-check
  merged trees after every merge; worktrees removed only after the agent's final report. Not paying off: the chain
  table went stale again — it now lives in the handoff and is re-derived at every merge.
- 2026-10-15: Owner: install step 6's Never on wording stays ("keep it off in the game yourself").

- 2026-10-15: The owner opened #178 into `master` (engine: clock-or-unwired advice from the rule count, release 0.11.0;
  33 files, all under `clock-generator/` plus the package versions). Its head merges cleanly with p2. When it merges,
  `master` is merged into `feat/ux-rework`, then into p2 and p3, with the generation tests run; the final PR's version
  bump starts from 0.11.0.

- 2026-10-15: Owner: **PR #178 (the clock-or-unwired advice) is out of scope** for the UX rework. No UI item is
  built for it; the drafted spec is not committed. `master` 0.11.0 is merged into `feat/ux-rework` (829befc,
  generation tests run 38731611174 passed), p2 (4e8619c) and p3 (e842f9a) as an ordinary upstream merge; the final
  PR's version bump starts from 0.11.0.

- 2026-10-15: The owner paused work. All in-flight branches were committed and pushed.
- 2026-10-16: Owner approved three token-saving process changes: coach only at phase ends or on request; background commands instead of command-only agents; detailed evidence stored once with compact reports and changed-field handoffs. Updated ORCHESTRATOR.md. All three phase-end reviewers, independent reruns, full evidence gates, model rules and owner checkpoints remain required.
- 2026-10-16: The owner resumed from the local handover. Model mapping: gpt-6-astra with high reasoning for orchestration, cross-cutting implementation and every review; gpt-6.1-sol for scouts/capture writers; gpt-6-luna for mechanical runners. Fast mode prohibited. This chat cannot change its own model through available controls; delegated roles explicitly set their models.
- 2026-10-16: master advanced from 0.11.0 to 0.15.1 (a67d5a2). Authorized down-merge: master → feat/ux-rework → p2 → p3, with semantic checks for fractional Copies, target-rate limits, library/share validation and optional stack_size, generation tests and full gates. No new version bump in the phases; the final PR starts from master’s then-current version.

- 2026-10-16: Upstream plan resolution complete (owner): preserve/display imported inserter type/quality, no selectors;
  clearing Stack size restores Automatic; **no sidecar metadata export extension** (focus on UX); repeated units get
  explanation/manual correction, no converter. PLAN and specs 2.1, 2.2, 2.7, 3.1–3.4 reconciled, with a bounded upstream
  compatibility spec. The old 2.1 warn-only addendum is superseded, and release baseline follows current master.
  Scope excludes new engine behavior/mod features. Audits are source-only; no merged-tree check claimed yet.

- 2026-10-16: Integration partition: pure master downmerges, reviewed p2 compatibility child, then p3 adjunct.
  Shared `inserterMetadata.ts` effective-size/read-only-text API recorded in provider and 3.2 A specs before coding.

- 2026-10-16: Owner requested Codex model names in ORCHESTRATOR. Replaced legacy role suggestions throughout with
  gpt-6-astra (high reasoning), gpt-6.1-sol and gpt-6-luna; every review uses Astra/high. Removed the obsolete fast-mode
  recommendation and review-downgrade exception. Actual parent-model limitations must be disclosed.

## Open questions

None.

## Follow-ups

Minor and nit findings, and anything noticed outside an item's scope. Whatever is still open at the end becomes a
GitHub issue in one reviewed pass before the final PR ([PLAN.md](PLAN.md) "The final PR", step 0).

- 1.13 → 1.9: wire `forcedAlways={inserter._forced_always}` in `InsertersForm` and add capture step 7 of
  `capture-enable-chip.mjs` (1.13 merged before 1.8).
- 1.13: after 1.8 merges, update the "Configure Enable Control" selectors in `capture/capture-expert-bugs.mjs` (on 1.8's branch until it merges).
- 1.13: the Diagram node chips ([InserterFlowNode.tsx](../../clock-generator-ui/src/components/InserterFlowNode.tsx), [EntityFlowNode.tsx](../../clock-generator-ui/src/components/EntityFlowNode.tsx), [InserterConfigPanel.tsx](../../clock-generator-ui/src/components/InserterConfigPanel.tsx)) still show
  the raw mode, and B7's "Show only overridden" filter is not built. For 2.11.
- 1.6: left to later items: B12's "Not picked because" column, B14's sorting and sticky tabs.
- 1.4: all Recipe inputs are labelled just "Recipe", so a jump to one announces only that. For 1.11.
- 1.14: the no-recovery, unstable and deadlock-risk warnings put no words on the Copy button (only the colour, icon,
  tooltip and snackbar). For the 1.12 glossary pass.
- 1.14 → 1.11: a `#fca300` focus ring is 1.55:1 on the yellow fill; draw it with an offset on the dark surface.
- 1.14 → 2.7: a warning-state yellow Copy replaces the green next-step button rather than sitting beside it.
- 1.10: one duration format (BlueprintOutput vs the timelines); right-aligned Insights columns; unrounded rates in the
  engine error at [plan-run.ts:1332-1333](../../clock-generator/src/crafting/plan/plan-run.ts#L1332-L1333); select-all on focus and silent fallbacks (B27); A16's live "per copy ·
  machine max" line.
- 1.9 → 1.3: whichever of the two merges second adds "the ones after it were renumbered" to a delete's Undo message.
- 1.12: [OverridesForm.tsx:80](../../clock-generator-ui/src/components/OverridesForm.tsx#L80) says "per output inserter" for Force Output Swings, while the note and
  [validate-config.ts](../../clock-generator/src/crafting/plan/validate-config.ts) sum over the output machine's inserters.
- 1.11 → 3.2: WCAG 2.5.7, the List's drag reorder needs a single-pointer alternative (e.g. Move up/down).
- 1.11 → Phase 2 retro: WCAG 1.4.10 Reflow at 320px conflicts with the owner's Widths decision.
- 1.11: the out-of-date plan's `opacity: 0.45` plus `pointer-events: none` (C21); hover-only override help (1.12).
- Tooling: `npm run knip` reports `scripts/*.mjs` as unused when run inside `.claude/worktrees/`; it passes on the main
  checkout. Judge knip on the main checkout or CI.
- Tooling: Playwright's ES module resolution ignores `NODE_PATH`; copy a capture script into `/tmp/ux-capture` to run it.
- 1.13 → 1.9: the AUTO tooltip gets its noun by parsing the label (`enableRuleLabel.ts`, `entityLabel.replace(/ \d+$/,
  '')`). When 1.9 changes the labels, pass `entityType: 'inserter' | 'drill'` instead. The 290px AUTO tooltip also
  covers the next row while open (`placement="top"` is an option).
- 1.13: the capture README doesn't mention `SAMPLES_DIR`.
- Tooling: `capture.mjs` `generate()` and `validate()` wait on `innerText` for "Generating..." / "Validating...", but MUI
  upper-cases button text, so the waits end at once. Use `textContent`.
- Tooling: under the dev server, React StrictMode runs MUI's dialog focus trap twice, so an `autoFocus` button may not
  hold focus. Check dialog focus on a `vite preview` build.
- 1.10 → 1.12 Part B: "Overload Multiplier" and the overload tooltip in `MachineFactsAccordion.tsx` while the diagram
  says "insertion limit"; one number, two names.
- 1.10 → 2.11: the diagram node line is `#666` at about 8.8px on `#232323` (about 2.7:1), failing 1.4.3. Use
  `text.secondary` and at least 0.7rem. Also one precision for craft ticks (facts 5.224, node 5.2).
- 1.10 → 1.6: Rate cells still read "240.00"; use `formatNumberText`.
- 1.10 → 1.11: the full-value `title` doubles as the accessible description on fields with no helper text.
- 1.1 → 2.3: the banner, dialog and tooltip say "Generate again", but after an edit Generate stays disabled until
  Validate. When 2.3 removes that gate, check these strings hold. 1.4 shows "Validate the build first" meanwhile.
- 1.1: the stale banner's `role="alert"` is inserted while Results is hidden, so it is rarely announced; consider
  dropping the live role (1.11).
- 1.1: after start-up, an uncaught worker crash during a Validate (no generation on screen) is now ignored, so
  Validate could stay pending. Rare; also cover a pending Validate in the `onerror` guard (Phase 3 cancel item, or 2.3).
- 1.8: the X in `EnableControlModal` has no accessible name, unlike `EntityEditDialog`'s (1.11).
- 1.8: wrapping the dialogs in fragments re-indented `EntityEditDialog.tsx` and `EnableControlModal.tsx`; expect
  merge care in 1.3, 1.12 and 3.2.
- 1.8 → 2.3 or later: the Transfer Plan has no per-row "keeps your Clocked rule" note on an excluded inserter that kept
  its own rule, and the rule isn't checked against the new clock period.
- 1.8 → 2.7: the new footer Save and the modal Save are filled orange, not green.
- 1.8 → 3.2: the diagram's inserter dialog is Save/Cancel; machine, belt, chest and drill dialogs still apply live.
- 1.8 → 1.12: the Transfer Plan chip tooltip says "its inserters are set to ALWAYS", true only for inserters whose
  items are all excluded.
- 1.8 → 1.11: "Unsaved changes" has no live region; the modal's "Clear Override" is 3.0:1 on #474747.
- 1.2 → 1.4: `handleValidate`'s smooth scroll stops short because the page grows while Validate runs. Scroll after the
  check completes, or instantly; `--app-header-height` gives the margin.
- 1.2 → 2.9: at 390 the Configure view scrolls sideways (459px) because of the "limit: 15" chip. Pre-existing.
- 2.11: a saved `near_lane` can go invisible if a belt's lanes later hold the same item.
- 1.2 → 1.12: in the ⋮ menu "Import Config" sits next to "Paste from Factorio"; consider "Import config file…".
- 1.2: the logo's alt text "Logo" says nothing (1.11).
- 2.8: the pickers list mod and hidden entries (746 recipes, recycling and `ee-*`); engine prose keeps ids.
- 2.2: Esc or E on the sidecar's copy popup closes the main window and orphans the popup (existing quirk).
- Final PR: open the built 0.8.0 sidecar zip in game once more (2.2's owner steps 4 to 6).
- 2.2: two final recipes that make the same item (casting iron in a foundry plus iron plate in a furnace) are ranked
  per recipe, so the suggested ceiling is too low; sum final groups that share a product, in TS and Lua
  (`suggested-target.ts:86-108`, `suggested-target.lua:69-130`).
- 2.2 → 2.1: the Lua's rate can carry float noise (1.8000000000000003); format it when showing it. Also the B19
  old-mod sentence (`sidecar-version.ts`), and saying Paste from Factorio is in the ⋮ menu.
- 2.2: recipes missing from the site's data are skipped in TS but counted in Lua (only matters for exports from mods
  older than 0.8.0, where the TS inference runs).
- Final PR: release sidecar 0.8.0 only with 2.1 merged (its tooltip says the site fills the target). Align "the text" /
  "JSON" / "build" wording in the mod.
- 2.7 found contrast failures in today's theme: green hover 3.98:1, error text 3.0-4.4:1 on cards and dialogs, input
  outlines and switch tracks 2.1-2.6:1, an orange Undo on MUI's snackbar 1.96:1, empty filter slots 1.46:1. 2.7 PR A
  fixes them; 1.5's snackbar and 1.3's Undo should not ship the 1.96:1 combination (checked in their evidence gate).
- Engine guard: in `alternatives.ts` (around line 483) clear `modulo_blueprint`/`modulo_schedule` in the subtick spread,
  with a test that every `-subtick` alternative exports a single blueprint. Changes no current output.
- 1.9 → 1.11: dnd-kit's reorder announcements read the `_uuid`; the row isn't a named group.
- 1.9: `useInserterValidation` keeps the previous config's issues for a moment after a delete, so a fix applied then can
  use old ids. Compare the issues to the config key, or check `machine_id` when applying.
- After the rework (owner, 2026-10-14): a rounded clock's decider gets a non-integer constant
  (`clock-generator/src/blueprints/entity/decider-combinator.ts:82`, `clock(period)` with no `Math.floor`). Check in
  game and fix in the engine.
- 1.11: the clock table's "How … is made" icon has an `aria-label` but `aria-hidden="true"` and no role, so it has no
  accessible role (found while repairing `capture.mjs`).
- Tooling: `lib.mjs` now runs widths in parallel (`forWidths`), waits on real signals instead of fixed pads (about 2.9x
  faster), measures contrast through MUI's overlay, and starts a `vite preview`. `capture.mjs` and `capture-extra.mjs`
  run against the current UI with 0 failures.
- 1.6 → 2.4: "Only if the belt stands still" on non-moving clock rows (C7).
- 1.7 → 1.4: a disabled Search deeper gives no reason.
- 1.6 → 1.11: the unstable divider cell is a plain data cell, not a group header.
- 1.9 → 2.9: check the inserter row at 900-1200px (the chip is now 72px).
- 1.7: a "found N fewer wake-ups" comparison after a deeper search needs the previous run kept. For 3.3.
- 1.5/1.3: Chrome's native Ctrl/Cmd+Z can revert a number field's last typed value when no Undo is offered (the
  browser's own field undo; pre-existing). Consider `preventDefault` outside text fields. Repro: type in Items per
  Second, Tab away, press Ctrl+Z.
- 1.5: messages sit top-centre below the header and can cover the top of the form (1440: the Items per Second label;
  390: a paste error covers Recipe until closed). Escape or Close reveals it; 2.4.11 passes. Optionally add the
  message height to `scroll-padding-top` while one shows.
- 1.5 → 2.1: the import error shows raw parser text ("Expected property name or '}' in JSON at position 2 …").
- 1.3: after Reset, Target Output's Recipe still shows the old recipe text without its icon (stale Autocomplete text;
  pre-existing, also in 1.1's before-shot).
- 1.12A → 1.11 PR B: other selects have no `labelId` either (`ChestsForm.tsx` type select, `ValueReferenceSelector.tsx`), and the List's Type select name includes the icon's alt text ("Type assembling-machine-3 Assembling machine").
- 1.12A → 1.12B: "Validate again, then Generate, after making changes" could read "After making changes, validate again, then Generate"; the `'Type'` tooltip in `MachineFactsAccordion.tsx` never renders (no FactItem has that label).
- 1.4 → 1.11: the fullscreen diagram renders a second `MissingInserterAlert`, so coverage-row ids are duplicated while it is open and a jump focuses the copy behind the modal. The Recipe inputs are all named just "Recipe".
- 1.5 → 1.11: 1.11's `announce()` callers must also land in an unhidden region (the 1.5 round-2 design handles MUI modals hiding `#root`).
- 1.4: Validate's late re-scroll skips when `scrollY` moved more than 2px; browser scroll anchoring after the header
  changes height (reason row going away, chip wrapping at 390) might trip it and leave the panel's top under the header.
  Not seen in the capture (P12 passes at 390); allow the header's change in height, or detect real player scrolling.
- 2.6 → 1.11: the sticky footer can hide anything focused near the window's bottom across the app (moot once 1.5's
  static footer merges); MUI's Switch vanishes in forced colours app-wide.
- 2.6 → 2.10: C2's other charts stay mouse-only (canvas state timeline, transfer bars); the fuel chart's role and label
  is covered by no item yet: add it to 2.10.
- 2.6: `CIRCUIT_LATENCY_TICKS` (2) and `MOSTLY_ON_SHARE` (0.8) are copied from the engine (`clock.ts:10`,
  `insights.ts:269`); export them from `clock-generator/light` instead (an engine change).
- 2.6: VoiceOver not run; a row group's label repeats its visible text and may be read twice (the spec's own risk).
- 1.5: the announcer's module state (`spare`, timers) isn't reset when `MessageHost` unmounts (HMR/tests only);
  spot-check its 100 ms write delay with NVDA and JAWS (1.11).
- 2.6: nits left: "Between its windows the inserter is off" (say "it"), Escape clears only a selection in the focused
  row, a missing space in `ID_PATTERN =/`.
- 2.11 → 1.11: the Diagram's node focus ring is white, not the theme's orange (nodes use orange for border, hover and
  selection); an intended exception. After 1.11 A merges, check no double ring on nodes.
- 2.11 → 1.5: the untimed "Build imported. Undo" message sits over the fullscreen Diagram and can cover a node; close it
  or anchor it below the dialog's title bar when fullscreen opens.
- (Fixed at the Phase 1 end on p1.) 1.11 A → 2.9: at 390 a belt lane's Stack Size field is squeezed to 14px beside the lane delete button (unusable;
  axe target-size); pre-existing `BeltsForm` layout.
- 1.11 A → 1.5: at 390 the message host draws "Build imported / Undo" over an open dialog (the changelog) and covers its
  text; stack messages below a modal's title bar or close them when a dialog opens.
- 1.11 A → 2.7: a focused unselected toggle gets an orange ring; recheck against "orange = selection" in 2.7.
- 2.11: a top-to-bottom layout when the canvas is taller than wide (phones); an edit that splits or unsplits a belt
  drops focus to `body` when the dialog closes.
- 2.3 → later: the failed-check alert disappears on the first keystroke of the fix, so the player loses the capacity
  figure while choosing the new rate (B23): keep the last reason, dimmed, "from the last check".
- 2.3: at 390 the swing plan scrolls in its own box with the "Exclude from LCM" column off-screen and no sign it
  scrolls; a right-edge fade or stack the chip on xs.
- 2.3 → 2.7: two kinds of red chip share the bar slot ("2 problems" filled, "Check failed" outlined).
- 2.11: inside the 2 s refit window the twin outline's className re-measures the node, so the view can refit twice;
  facts that load after 2 s don't refit; Tab order sorts by left x not centre; the lane select cuts long item names.
- 2.3: after a worker crash the check is recorded as failed for that build, so Generate shows the crash message
  without retrying; only Check only or an edit retries. Let Generate retry after a crash.
- 1.11 A: checkboxes still show MUI's focus ripple inside the ring; a wrapped row of chest filters at 390 isn't
  captured; on a focused AUTO slot the badge and × cover part of the ring.
- 1.11 B: NumberField steppers are all named "Increase"/"Decrease" (allowed gap in the spec); include the field's label.
- 2.3: the swing plan's own "Check only" (before the first check) unmounts when pressed, so focus falls to `body`; move focus to the plan's summary after the check. Exclude chips stay keyboard-operable but inert while re-checking.
- 1.11 B: the enable-rule dialog's heading still wraps its title-bar buttons ("… Fullscreen Close" in the heading list); an empty unstable row group when there are none.
- **1.5, raised priority (three reports: 1.11 A, 2.11, 2.4):** the untimed Undo message ("Build imported. Undo") sits
  over the page: over an open dialog at 390, over the fullscreen Diagram, and over 2.4's Results action (36% at 720;
  the whole assumption line at 390). Plan a small Phase 2 fix: put messages in the page flow under the bar (or move
  them clear of focused controls), keeping the owner's no-timer rule. Candidate owner: 2.7 B (layout) or its own item.
- 2.4: "may do with 0 wake-ups a minute instead of 177" is true but not self-explaining (fewer = less UPS; 0 can
  read as broken) → 2.5 B terms / copy; the Standing option doesn't say what goes wrong if picked wrongly → 1.12 B copy;
  the Results assumption line sits before the "Potential Clocks" h2 (2.5 A moves it into its card); "Not sure? Leave it
  on Moving." isn't linked to the group (`aria-describedby`); the Belt column's "non-moving"/"moving (+4 ticks)" and
  engine clock names differ from the radio's wording → 2.5 B.
- `capture-enable-chip.mjs` "Delete buttons line up in one column" fails on the Phase 1 base too (1.9/1.13 row layout): the delete buttons don't share a column across rows. For 2.9.
- 1.12 B leftovers for 2.x copy: the diagram dialog's "Config" tab beside "Enable rule"; the Auto chip tooltip "runs" vs the modal's "switched on"; "Latched Mode … Once enabled"; "Mining drills are disabled… setup"; Stable/Unstable until 2.5. 2.11 spec line 88 should name `CONDITIONAL_CHIP_MAX_CHARS` (36).
- 2.5 A → 2.7: two filled green buttons on Results (Generate in the bar, Copy in the card); outline Generate while results are fresh, or record the exception. → 2.5 B: "among the Stable clocks" in the reason (glossary "holds the rate"); the table's own "Back to recommended" duplicates the card's.
- 2.10 → 2.5 B: the Fuel chart paints swings orange while Detailed state charts use orange for "No fuel"; unify the fuel palette with `colors.ts` when the charts move behind Developer tools. Keyboard/hover access to the canvases is left out (light fixes only).
- 1.4: after an Import or a fix, coverage problems can name the previous build for one worker round-trip
  (`hooks/useInserterValidation.ts` keeps the old issues), so the bar shows old issues instead of "Checking the build…"
  and a click finds no element. Reset the coverage result to null when the build is replaced.
- 1.4 → 2.8/2.5: "Machine 1 has no inserter bringing in inserter" reads like a typo (item names), and the bar's wording
  differs from the coverage alert's ("missing input inserter for …").
- 1.14: the "Copied. …" message is `warning.dark` #b29d35 (olive), not the spec's #ccb43d; text 6.8:1. Accepted.
- 1.14 → 1.10/2.7: MUI's upper-casing turns "200/s" into "200/S" on the below-target Copy button.
- 1.5 → 2.1: "No items selected for import." and the menu names (Reset Configuration, Import/Export Config) keep
  "configuration"/"config" until 2.1 renames them.
- **Phase 1 end review:** the deduplicated new findings, each with an owner, are in
  [review/phase1-end/SYNTHESIS.md](review/phase1-end/SYNTHESIS.md) section 3; the 16 not listed above are filed from
  there at the end. Open owner questions: drag reorder renumbering (3.2), diagram dialog commit model (3.2), a target
  above what the machines can make (block or warn).
- 1.12 B on p2: the swing plan says "Each output inserter makes N swings", but N is the total over the first output
  machine's inserters (`validate-config.ts:41-48`); pre-existing (1.12 spec Risks) → 2.5 B or the engine.
- capture-wake-windows: the drills sample's "one row per inserter then drill" check fails on p2 (6 inserters and 1
  drill against an expected developer-timeline count of 0); script or 2.5 B.
- 2.5 A: in the nothing-to-wire case the bar still shows the yellow Copy blueprint → 2.7 A.
- 2.8 a: knip inside `.claude/worktrees` lists the 3 `scripts/*.mjs` as unused (location only; passes elsewhere).
- master 0.10.0: `SLOW_TASKS` (`useSimulationWorker.ts:87`) does not list `even-hands`; add it if timing shows it is
  slow. The engine's even hands name and description use "hand" for a trip and a bare "window" → the engine-text pass
  (2.5).
- 2.5 A: when the first clock arrives with no belt, the belt action unmounts and focus can drop to the body.
- 2.1: the 0.6.0 notice should be info, not warning colour; paste counts and an Append option (B19) are in no spec;
  `ignore-scripts` builds skip the example copy until `copy-factorio-data.mjs` is run; the recipe box keeps stale
  text after Undo or Reset (1.3; priority raised: it contradicts 2.1's start line).
- 1.5 F evidence: pre-existing p2 failures "diagram delete: focus stays in the diagram" (every width) and a 15 s click
  timeout in "D Paste and Undo" at 390; Copy's and Check only's tooltips (WorkflowBar, 2.7) cover the message and ⋮.
- 2.3: Check only's interactive tooltip stays open over ⋮ while hovered.
- 2.1 W: machines whose facts come back empty are left out of the sum (could block a build wrongly); a limit under
  0.01/s could print rounded up.
- 1.5 F (review PASS): Copy's tooltip covers the message row at 720/390 (2.7 A is moving it on top); in fullscreen,
  Tab from Exit takes 16 presses to reach Undo; Safari may shift the page 39px at any scroll position (untested).
- 2.8 b: the Swing Plan's type chip is redundant; Source/Destination says "Machine 1 - Name" where elsewhere it is
  "Machine 1 (Name)"; a bracket holding more than an id keeps its ids.
- Process: `git merge-tree` reports text conflicts only. 2.8 b removed `WakeWindowRow.detail`, which 2.5 A uses, and the
  merge was clean but would not compile. Type-check (`tsc -b`) the merged tree of in-flight branches when an item
  changes a shared type (coach run 6).
- Process: the orchestrator removed 1.5 F's worktree while its implementer was still re-running captures; a
  post-merge rerun on p2 closed the gap (no new failures). Remove a worktree only after the agent's final report.
- Engine (from 2.5 A's re-check): Never on is ignored in agriculture science (an inserter set to it still moves and
  appears in the wiring list) and empties the whole schedule in logistic science (0/s). Engine follow-up; 2.5 B fixes
  the `installSteps.ts` comment that claims Never on gets no combinator.
- 3.1 (review): the Never on and Auto notes depend on the engine follow-up above; a stored rule's problem blocks a
  Config-only save in the Diagram dialog (spec allows). capture-a11y-names has 6 stale Phase 1 checks (Validation /
  Swing Plan headings, LCM chip) failing on p2 since 2.3 — update the script.
- 3.4 × 2.5 A: the merged tree did not type-check (both added the same message hooks to App.tsx); caught by the new
  post-merge type-check (coach run 6) before any PR.

- 2.5 B (#182): engine text still uses old terms (Even hands, Observed windows, Full-hand output swings and Insights prose); Works? is off the right edge at 390; glossary definitions for hand and assembling machine read as notes to copywriters (owner).
- 2.9 (#184): below 720, the compact table overflows by 174px and Check passed wraps; Fuel clocks is 5px over at 960; front-load the key fact in the two longest problem notes; macOS Chrome uses overlay scrollbars; a focused scroll box loses focus when it stops overflowing.
- 3.3: a stopped run keeps a pick even when that clock was not made yet. Check the spec’s PLAN-note against current PLAN (Undo restores clocks and stale changes are already present) before adding duplicate bullets.

- Deferred by owner (2026-10-16): sidecar type/quality export; current exports omit metadata and retain the legendary stack timing assumption. No mod change in this UX rework.

## Retros

One section per phase, written at the phase end.

### Phase 1 (2026-10-14)

**Result:** all 14 items merged in 13 PRs (#145–#164; three bundles: 1.5+1.3, 1.4+1.14, 1.6+1.7; 1.11 and 1.12 in two
PRs each). The phase-end review (three opus designers, capture at 4 widths) graded 34 of 47 finding ids fixed and 13
partly fixed. Measured: a11y 256 PASS / 10 FAIL, a11y-names 482 PASS / 1 FAIL, from two defects. Phase-end fixes on p1:
the chip focus ring, the lane row at 390, the stale "Clock-only output" copy. 12 findings carried (below).

**What went well**
- Fix rounds stayed small: 11 of 14 items merged after one round, often minors only; 1.2 and 1.5+1.3 used both rounds.
  No item hit the cap with a FIX outstanding.
- Round-0 FIX verdicts caught real defects that capture alone would have shipped: focus under the header (1.2),
  the polite region inside `#root` hidden by MUI's modal (1.5+1.3), prompt contrast (1.8), keyboard on the stale plan
  (1.9), the Save bar over a field (1.11 A), focusable chips inside an accordion button (1.11 B).
- Escalations were few and quick: the Undo timer (2.2.1 → owner: no timer), the 1.9 id question (owner), the 2.11
  minZoom ruling (orchestrator).
- Throughput rose with the coach's changes: 23.7 → 19.2 → 18 min per merge (runs 1–4); bundles, four units, zero-unit
  waiting and read-only agents, and Phase 2 started early in idle slots (6 Phase 2 items merged before Phase 1 ended).
- Model choices: opus implementers for anything touching layout, focus or the worker; sonnet did well on mechanical
  breadth (1.12 B, 40 files, one round; 1.13; 1.11 B stacked on A). Opus code review throughout after the first three
  Fable reviews.

**What didn't**
- Per-item captures check only the item's own states. 1.11 B made the Status chips focusable (`tabIndex={0}`) and
  nobody ran the ring check on Results until the phase end: 8 FAILs. → Run the full `a11y` capture before the last
  a11y-touching item of a phase merges.
- A follow-up was routed to an item whose scope excludes it: the 390 lane field went to 2.9, which requires nothing
  below 720. → When ledgering to an item, check its spec's scope; measured AA failures stay with the phase that can fix
  them.
- Copy drift between items: 1.10 renamed a column, and the sentence naming it (one line from 1.12 B's edit) kept the old
  name. → The glossary pass greps for every renamed header and label, not only the glossary terms.
- The untimed Undo message was flagged by three audits during the phase (1.11 A, 2.11, 2.4) and still shipped over the
  page; all three phase-end reviewers raised it. A raised-priority follow-up needs an owner and a slot at once (now 1.5 F).
- A 48-minute stall after a restart (coach run 4) before agents were resumed.

**Carried into Phase 2/3:** A6 (red count on a blank form → 2.1), A16 and B27 (target range check, select-on-focus,
silent fallback → owner Q4), A25/B32/C30 (Stable/Unstable, Fuel copy → 2.5 B; Paste "items" → 2.1; legend chips → follow-up),
B14 and C7 (compact table, sorting → 2.5 B; widths → 2.9; chip colour → 2.7 A), C3 (one filled button → 2.7 A),
C10 (hover-only help → 2.7 A, 2.5 B Terms), C24 (red trash, row grid, empty slots → 2.7 A/B), C26 (durations,
Insights alignment → 2.5 B).

**New findings:** 53 deduplicated; 8 already fixed on p2 (2.3, 2.4, 2.10, 2.11); 3 fixed at phase end; Undo lifetime
and messages over dialogs → 1.5 F; reorder renumbering, diagram commit model, target check → owner; the rest → 2.1,
2.5 B, 2.7 A/B, 2.8, 2.9, 3.2, 3.3 or Follow-ups (16 new lines added).

**PLAN.md changes:** 1.3 (made: the owner chose that the Undo offer ends when a check or generation starts); 2.1 (a blank build shows its
next step neutrally, not as red problems); 2.5 B (gains: the clock (i) popover, the blueprint string's padding, the
recommended row first, "Copied" reset on a change, Debug Output while generating); 2.9 (header height and the reason
line); 3.2 (reorder message and Undo per Q2, diagram dialogs per Q3); 3.3 (Undo of an import restores the clocks; the
stale banner lists what changed). Ledger corrections: 2.2's "A17 fixed" → only the export part (2.1 owns the warning);
close line 318 (lane field, fixed on p1).
