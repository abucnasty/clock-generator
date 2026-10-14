# UX rework: progress ledger

The orchestrator updates this file after every step (see [ORCHESTRATOR.md](ORCHESTRATOR.md)). Its updates to the owner
come from here.

**Links:**
- **Docs:** [PLAN.md](PLAN.md) · [ORCHESTRATOR.md](ORCHESTRATOR.md) · [specs/](specs/) ·
  [capture/README.md](capture/README.md)
- **Review:** [SYNTHESIS.md](review/SYNTHESIS.md) · [A-newcomer.md](review/A-newcomer.md) ·
  [B-power-user.md](review/B-power-user.md) · [C-visual-a11y.md](review/C-visual-a11y.md) · [BRIEF.md](review/BRIEF.md)
- **GitHub:** [feat/ux-rework](https://github.com/abucnasty/clock-generator/tree/feat/ux-rework) ·
  [feat/ux-rework-p1](https://github.com/abucnasty/clock-generator/tree/feat/ux-rework-p1) ·
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

## Current state

- **Phase:** 1 (started 2026-10-14)
- **Branch:** [`feat/ux-rework-p1`](https://github.com/abucnasty/clock-generator/tree/feat/ux-rework-p1) (from `feat/ux-rework` at c8896e2)
- **Open checkpoints:** none (2.2's in-game check passed: the owner tested the built mod, 2026-10-14)
- **Phase 2:** started early in idle slots on [`feat/ux-rework-p2`](https://github.com/abucnasty/clock-generator/tree/feat/ux-rework-p2) (cut from `feat/ux-rework-p1`; merges p1 in after each p1 merge)

## Phase 1: stop the harm, quick wins

| Item (spec) | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| [1.1](specs/1.1-stale-results.md) | Never offer a stale blueprint | opus | merged | [#147](https://github.com/abucnasty/clock-generator/pull/147) | 1 | Code review Fable PASS, UX audit opus PASS (A5, B1, C5 fixed); cheap minors fixed before merge. CI green |
| [1.2](specs/1.2-header.md) | Header usable at every width | sonnet | merged | [#149](https://github.com/abucnasty/clock-generator/pull/149) | 2 | Code review opus PASS; UX audit FIX (focus under the header, 2.4.11) then PASS after round 1; a one-line minor in round 2. CI green |
| [1.3](specs/1.3-undo.md) | Undo snackbar for destructive actions | opus | fix-2 | | 2 | Bundle with 1.5. Code review opus PASS (minors); UX audit opus FIX: Undo timed out for keyboard users (2.2.1) → owner: no timer. A18, C15 fixed; B2 fixed within the plan; B3 partly (delete buttons unnamed: fixed in round 1). Re-review after round 1: both FIX on one shared major (the polite region sits in `#root`, which MUI's modal hides, so messages raised in or while closing a dialog aren't read). Round 2 (last): announce into an unhidden region |
| [1.4](specs/1.4-first-problem.md) | Disabled actions say what is missing | opus | fix-1 | | 1 | Bundle with 1.14 (`feat/ux-rework-p1-first-problem-warning`). Code review opus PASS, UX audit opus PASS (A6, B21, C10, C4 fixed); a minors round (8 cheap items). Also the 1.7 and 1.2 follow-ups (Search deeper's reason, Validate's scroll). 257 tests; capture 901 PASS, 2 FAIL (pre-existing 390 sideways scroll when stale, 2.9) |
| [1.5](specs/1.5-messages-footer.md) | Messages above the footer; quieter Ko-fi | opus | fix-2 | | 2 | Bundle with 1.3 (`feat/ux-rework-p1-messages-undo`). Merged #151 in (import-line conflict only). A14, A29, B30, C6 fixed; C3 partly (one filled button per state is 1.4's). Round 1: the untimed Undo, focus after Undo/Close, one live region with `announce()`, named delete buttons, 9 minors. Re-review after round 1: both FIX on one shared major (the polite region sits in `#root`, which MUI's modal hides, so messages raised in or while closing a dialog aren't read). Round 2 (last): announce into an unhidden region |
| [1.6](specs/1.6-recommended-clock.md) | Make the clock pick explainable | opus | merged | [#151](https://github.com/abucnasty/clock-generator/pull/151) | 1 | Bundle with 1.7. Code review opus PASS; UX audit opus minors only (A9, A11, B12, B14 fixed, C7 partly). Round 1: 13 cheap minors; orchestrator read the diff and shots. Runner re-ran checks after merging 1.9 in (235 tests). CI green |
| [1.7](specs/1.7-search-deeper.md) | "Search deeper" button | opus | merged | [#151](https://github.com/abucnasty/clock-generator/pull/151) | 1 | Bundle with 1.6. A22, B15, C27 fixed |
| [1.8](specs/1.8-expert-bugs.md) | Fix the dangerous expert bugs | opus | merged | [#148](https://github.com/abucnasty/clock-generator/pull/148) | 1 | Round 0: code review Fable PASS, UX audit FIX (prompt contrast). Round 1: both opus PASS. Minors fixed before merge. CI green |
| [1.9](specs/1.9-renumber.md) | One number per entity, everywhere | opus | merged | [#150](https://github.com/abucnasty/clock-generator/pull/150) | 1 | Round 0: code review and UX audit FIX (keyboard on the stale plan; 720 row). Round 1: both PASS. CI green |
| [1.10](specs/1.10-numbers-units.md) | Readable numbers and units | opus | merged | [#146](https://github.com/abucnasty/clock-generator/pull/146) | 1 | Code review Fable PASS, UX audit opus PASS; cheap minors fixed before merge. CI green |
| [1.11](specs/1.11-a11y-basics.md) | Accessibility basics | opus + sonnet | impl | | | Two PRs. PR A (opus, `feat/ux-rework-p1-a11y-basics`) in impl with a capture writer, moved up by coach run 2; announcements go through 1.5's `announce()`. PR B (sonnet) stacks on A |
| [1.12](specs/1.12-glossary-copy.md) | Glossary and copy pass | sonnet | A merged | [#153](https://github.com/abucnasty/clock-generator/pull/153) | 1 | Part A merged: code review opus PASS (re-ran checks in a clean copy), UX audit sonnet PASS (C30 fixed; A25, B32 partly, rest is Part B); one minors round (dialog row wraps at 390). CI green. Part B last in the phase, stacked on 1.11 B |
| [1.13](specs/1.13-enable-chip.md) | Enable mode shown on the row | sonnet | merged | [#145](https://github.com/abucnasty/clock-generator/pull/145) | 1 | Code review opus, UX audit sonnet: FIX, then PASS/PASS. CI green. Forced-ALWAYS wiring moves to 1.9 |
| [1.14](specs/1.14-warning-colour.md) | Warning colour apart from the brand orange | opus | fix-1 | | 1 | Bundle with 1.4. C4 fixed |

## Phase 2: newcomer-first structure

| Item | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| [2.1](specs/2.1-first-visit.md) | First visit and the way in | opus | spec | | | Spec final; counts as two units. After 2.2, 1.5 + 1.3 and 1.4. Uses 2.2's `suggestedTargetOf` |
| [2.2](specs/2.2-sidecar.md) | Sidecar mod changes | opus | merged (p2) | [#154](https://github.com/abucnasty/clock-generator/pull/154) | 0 | Into `feat/ux-rework-p2`. CI green. **In-game check: passed** (owner, 2026-10-14: "looks good"). Code review opus PASS (Lua read line by line; checks re-run); UX audit sonnet FIX on the owner steps only (fixed by the orchestrator). A17, Q3 fixed; A2, A3 partly (site side is 2.1); B19 to 2.1. Started early on `feat/ux-rework-p2-sidecar` (from `feat/ux-rework-p2`, cut from p1 at 9505eca). Checkpoint: owner runs the in-game steps |
| [2.3](specs/2.3-validate-into-generate.md) | Fold Validate into Generate | opus | spec | | | Spec final. After 1.4 + 1.14 and 1.6 + 1.7; before 2.4. Closes the 1.1 "Generate again" and Validate-crash follow-ups |
| [2.4](specs/2.4-belt-question.md) | Ask the belt question | opus | spec | | | Spec final; moved up (13 files). After 2.3 |
| [2.5](specs/2.5-results-answer.md) | Results lead with the answer | opus | spec | | | Spec final; two PRs (A answer + install steps first; B details). After 2.6. Checkpoint: install steps reviewed in game. Subtick book bug refuted |
| [2.6](specs/2.6-wake-windows.md) | Wake windows view | opus | impl | | | Started early on `feat/ux-rework-p2-wake-windows` (opus) with a capture writer. Uses 1.5's `announce()` once p1 is merged into p2 |
| [2.7](specs/2.7-gui-grammar.md) | Factorio GUI grammar pass | opus | spec | | | Spec final; two PRs (A tokens and roles after 2.3 and 2.5 A; B layout after 2.1 and 2.4, before 2.9) |
| [2.8](specs/2.8-item-names.md) | In-game item names | opus + sonnet | spec | | | Spec final; about 42 files, two PRs (2.8a opus: dump, names, pickers; 2.8b sonnet: text sites, late) |
| [2.9](specs/2.9-half-width.md) | Half-width layout | sonnet | spec | | | Spec final. After 2.1-2.7, before 2.10 and 2.11 |
| [2.10](specs/2.10-timelines.md) | Developer timelines: light fixes | sonnet | spec | | | Spec final. After 1.14 |
| [2.11](specs/2.11-diagram.md) | Diagram readability | opus | spec | | | Spec final; moved up (12 files). After 1.9 |

## Phase 3: expert depth

| Item | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| 3.1 | Rule editor upgrades | opus | todo | | | |
| 3.2 | Editing at scale | opus | todo | | | |
| 3.3 | Cancel, and keep the results | opus | todo | | | |
| 3.4 | Build library and share links | opus | todo | | | |

## Decisions log

Owner decisions made after the plan was written, and every change to [PLAN.md](PLAN.md), with the date.

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
- 1.4: after an Import or a fix, coverage problems can name the previous build for one worker round-trip
  (`hooks/useInserterValidation.ts` keeps the old issues), so the bar shows old issues instead of "Checking the build…"
  and a click finds no element. Reset the coverage result to null when the build is replaced.
- 1.4 → 2.8/2.5: "Machine 1 has no inserter bringing in inserter" reads like a typo (item names), and the bar's wording
  differs from the coverage alert's ("missing input inserter for …").
- 1.14: the "Copied. …" message is `warning.dark` #b29d35 (olive), not the spec's #ccb43d; text 6.8:1. Accepted.
- 1.14 → 1.10/2.7: MUI's upper-casing turns "200/s" into "200/S" on the below-target Copy button.
- 1.5 → 2.1: "No items selected for import." and the menu names (Reset Configuration, Import/Export Config) keep
  "configuration"/"config" until 2.1 renames them.

## Retros

One section per phase, written at the phase end.
