# Phase 1 end: UX review synthesis

Three designers reviewed `feat/ux-rework-p1` at 84197ba, independently, from the phase-end capture
(`/tmp/ux-capture/out/phase1-end/`, 1440/960/720/390) and the source:

- **A, newcomer advocate:** `review/phase1-end/A-newcomer.md`
- **B, power-user interaction designer:** `review/phase1-end/B-power-user.md`
- **C, visual, data-viz and accessibility designer:** `review/phase1-end/C-visual-a11y.md`

`A#6` means finding 6 in the phase-end A review. Plain ids (`A5`, `C25`) are the original review's findings, as in
`PLAN.md`. "p2" is `origin/feat/ux-rework-p2` at ac3441b; "2.5 A branch" is `origin/feat/ux-rework-p2-results-answer`
at 24f45a7. Every "fixed on p2" below was checked in p2 source, with the `file:line` given. All three reviewers saw
v0.9.0: master's 0.9.1 went into `feat/ux-rework`, not p1. That is expected and is not a finding.

**Measured:** `a11y/INDEX.md` has 256 PASS and 10 FAIL; `a11y-names/INDEX.md` has 482 PASS and 1 FAIL. The 11 FAILs come
from two defects:

- **The 4 "Stable" Status chips on Results show no focus ring.** That fails 2 checks at each of the 4 widths: 8 FAILs.
- **A belt lane's Stack Size field is squeezed to 14px at 390.** axe target-size fails on Configure (`#_r_3b_`, in both
  runs) and in the chest-filter state (`#_r_kd_`). The second is very likely the same lane field, since that sample has
  a two-lane belt, but the capture does not name it.

## 1. Verdict

1. **The bar is not met as written.** The bar is "none of the Phase 1 findings still present". Of the 47 Phase 1
   finding ids, 34 are fixed by consensus and 13 are only partly fixed: A6, A16, A25, B14, B27, B32, C3, C7, C10, C24,
   C25, C26 and C30.
2. **Two of those leftovers are Phase 1's own debts, and Phase 2 won't fix them.**
   - C25: all 11 measured AA failures.
   - The A25/B32/C30 copy drift: "Clock-only output columns".

   Three S-sized fixes on p1 close both (section 4).
3. **The other 11 carry over.**
   - Most are the second halves that PLAN already gives to 2.1, 2.5 B, 2.7 A/B and 2.9.
   - Part of A6 and C10 is already fixed on p2 by 2.3 and 2.4.
   - A16/B27's target range check was never scheduled anywhere and needs the owner's call (Q4).
4. **Phase 1 introduced new problems, but none of them is a Phase 1 finding:**
   - the Undo message that never times out sits over the page, and Ctrl+Z can still undo a whole import long after;
   - messages draw over dialogs;
   - drag reorder renumbers rows silently.

   The first two go to the in-flight 1.5 F and Q1; the last goes to Q2.
5. **Recommendation:**
   - land the 3 p1 fixes;
   - re-run the `a11y` and `a11y-names` captures, expecting 0 FAIL;
   - write the 12 carried findings and their owners into PROGRESS;
   - ask the owner to accept closing Phase 1 with them carried (Q5). PLAN "Verification" 2 allows this: "Fix what's
     still open, or list it as carried into the next phase."

## 2. Phase 1 findings status

Fixed = fixed, fixed within Phase 1's scope, or fixed per an owner decision. B's 1.11 row grades C8, C9, C10, C13, C22
and C25 together as "partly". Its leftovers are C25's (the chip ring and the target size), so B is shown as "fixed¹" on
the others.

| Id | Item | A | B | C | Consensus | Leftover | Owner |
|---|---|---|---|---|---|---|---|
| A5 | 1.1 | fixed | fixed | fixed | fixed | "Generate again" while Generate is disabled | (a) fixed on p2 by 2.3: Generate is off only while busy (`WorkflowBar.tsx:268`), and with a problem it goes to the problem (`checkThenGenerate.ts:79-81`) |
| B1 | 1.1 | fixed | fixed | fixed | fixed | as A5; the banner names only the recipe and rate (B#3) | as A5; banner detail → new N12 |
| C5 | 1.1 | fixed | fixed | fixed | fixed | as A5 | as A5 |
| A7 | 1.2 | fixed | fixed | fixed | fixed | clock table columns cut at 390 | out of scope below 720 (PLAN "Out of scope") |
| B25 | 1.2 | fixed | fixed | fixed | fixed | — | — |
| C1 | 1.2 | fixed | fixed | fixed | fixed | header 133–141px, jumps 23px (C#10) | (b) 2.9 (header height criterion, `specs/2.9-half-width.md:183-186`) |
| A18 | 1.3 | fixed | fixed | fixed | fixed | Undo message covers content (new) | (b) 1.5 F, in flight; Q1 |
| B2 | 1.3 | fixed | fixed | fixed | fixed | — | — |
| B3 | 1.3 | partly | fixed | fixed | fixed (owner scope: Undo messages, no history) | reorder has no Undo (B#4); Undo doesn't bring the clocks back (B#12) | Q2; (d) new N44 |
| C15 | 1.3 | fixed | fixed | fixed | fixed | Undo message placement | (b) 1.5 F |
| **A6** | 1.4 | partly | fixed | fixed | **partly** | (1) "Press Generate" and "Generate again" while disabled; (2) a red "2 problems" on the untouched default form | (1) (a) fixed on p2 by 2.3, as A5; (2) (b) 2.1, which already has `isBlankBuild` (spec 2.1 :121, :168); needs a line added to the spec |
| B21 | 1.4 | fixed | fixed | fixed | fixed | the tooltip covers the reason it repeats | (a) fixed on p2 by 2.3: tooltips `placement="top"` (`WorkflowBar.tsx:240-242, 261`) |
| **C10** | 1.4/1.11 | fixed / can't tell | fixed / fixed¹ | partly | **partly** | the clock table headers and the Advanced switches are still tooltip-only (still so on p2: `OverridesForm.tsx:64-131`, `ClockAlternativesPanel.tsx:270-305`) | (b) 2.7 A (one grey "?" help control, C16 in `specs/2.7-gui-grammar.md:41`); 2.5 B (Terms (i) by the compare table's headers) |
| A14 | 1.5 | fixed | fixed | fixed | fixed | messages now cover fields and dialog titles | (b) 1.5 F |
| A29 | 1.5 | fixed | fixed | fixed | fixed | — | — |
| B30 | 1.5 | partly | fixed | fixed | fixed | (A's leftover is C3's half) | — |
| **C3** | 1.5 | partly | fixed | partly | **partly** | one filled next-step button per state: on fresh Results, Generate is filled and Copy outlined. Still the same on p2 and on the 2.5 A branch (`WorkflowBar.tsx:255` there) | (b) 2.7 A (`nextStepOf`, `specs/2.7-gui-grammar.md:65, 121-128`); ledger lines 205, 350 |
| C6 | 1.5 | fixed | fixed | fixed | fixed | "Copied. {rateWarning}" not captured | can't tell; add a below-target state to a capture |
| A9 | 1.6 | fixed | fixed | fixed | fixed | no route to the standing-belt clock | (a) fixed on p2 by 2.4 (`beltQuestion.ts:27-33`, `BeltAssumptionLine.tsx:28-42`) |
| A11 | 1.6 | fixed | fixed | fixed | fixed | — | — |
| B12 | 1.6 | fixed | fixed | fixed | fixed | no per-row "why not" | (b) 2.5 B compact table; ledger line 200 |
| **B14** | 1.6 | fixed | fixed (P1 part) | partly | **partly** | the table still fills the first screen; no sorting, no collapse, no sticky tabs | (b) 2.5 B (compact table, "Show all columns"); sorting and sticky tabs: ledger line 200, no owner yet |
| **C7** | 1.6 | fixed | fixed | partly | **partly** | constant columns, wrapping cells, (i) wraps, no data bars; orange chip clashes with selection; "Only if the belt stands still" | 2.5 B (compact table); 2.9 (nowrap, min widths); 2.7 A (chip colour); the belt half is (a) fixed on p2 by 2.4 (`beltQuestion.ts:33`) |
| A22 | 1.7 | fixed | fixed | fixed | fixed | checkbox and caption noise (A#21) | (d) new N38 |
| B15 | 1.7 | fixed | fixed | fixed | fixed | Search deeper off after any edit | (a) fixed on p2 by 2.3 (`App.tsx:706` `canSearchDeeper={!busy}`) |
| C27 | 1.7 | fixed | fixed | fixed (P1 part) | fixed | the Insights prose walls | (b) 2.5 B |
| B5 | 1.8 | fixed (code) | fixed | fixed (code) | fixed | the forced flag is lost on Export (B#16) | (d) new N47 |
| B6 | 1.8 | fixed (code) | fixed | fixed (code) | fixed | diagram dialogs: two commit models (B#5) | Q3; ledger line 244 (→ 3.2) |
| B16 | 1.8 | fixed (code) | fixed | fixed (code) | fixed | — | — |
| B4 | 1.9 | fixed (shots) | fixed | fixed (shots) | fixed | renumber after a delete not captured; reorder renumbers silently (B#4) | Q2 |
| **A16** | 1.10 | partly | fixed | fixed | **partly** | no live "per copy · machine max" line; target recipe not prefilled | Q4 (ledger lines 206-208); prefill from a paste is (b) 2.1 |
| A26 | 1.10 | fixed | fixed | fixed | fixed | — | — |
| B13 | 1.10 | fixed | fixed | fixed | fixed | — | — |
| **B27** | 1.10 | partly | partly | partly | **partly** | no range check (240200 accepted); a mouse click doesn't select; stack size silently falls back to 16 | Q4; ledger lines 206-207 |
| **C26** | 1.10 | fixed | fixed | partly | **partly** | three duration formats; Insights numbers left-aligned | (b) 2.5 B (Details tabs, Insights); ledger line 206 |
| C8 | 1.11 | fixed | fixed¹ | fixed | fixed | — | — |
| C9 | 1.11 | fixed | fixed¹ | fixed | fixed | — | — |
| C13 | 1.11 | fixed | fixed¹ | fixed | fixed | — | — |
| C22 | 1.11 | fixed | fixed¹ | fixed | fixed | — | — |
| **C25** | 1.11 | partly / can't tell | partly | partly | **partly** | the Status chips have no focus ring (8 measured FAILs); the lane Stack Size is 14px at 390 (3 axe FAILs) | (c) phase-end fixes 1 and 2 on p1 |
| **A25** | 1.12 | partly | fixed | partly | **partly** | "Clock-only output columns"; Stable/Unstable; "items" in the Paste dialog; "Transfer Activity Timeline" | "Clock-only": (c) phase-end fix 3; Stable: (b) 2.5 B (ledger lines 349-350); "items": (b) 2.1 (ledger lines 359-360); "Transfer": (d) N52 |
| **B32** | 1.12 | partly | fixed | partly | **partly** | as A25; Fuel "Enabled every" (B#23) | as A25; Fuel: (b) 2.5 B |
| **C30** | 1.12 | partly | fixed | fixed (P1 part) | **partly** | "Clock-only output"; legend chips that look like toggles (not in 2.10's scope; the Palette filter is still at `StateTransitionTimeline.tsx:833` on p2) | (c) fix 3; legend: (d) N52 (developer view, light fixes only) |
| A23 | 1.13 | fixed | fixed | fixed | fixed | — | — |
| B7 | 1.13 | fixed | fixed | fixed | fixed | "Show only overridden" filter not built | ledger lines 198-199 |
| **C24** | 1.13 | fixed | fixed | partly | **partly** | red trash icon on every row; Source and Destination truncate; four empty "+" slots | (b) 2.7 A (idle delete grey, `specs/2.7-gui-grammar.md:106`); 2.7 B (inserter row grid, filter-slot cleanup, spec :16, :74) |
| C4 | 1.14 | fixed | fixed | fixed | fixed | the below-target label is in the code but not captured | can't tell; same capture as C6 |

**Totals:** 34 fixed and 13 partly fixed. After the p1 fixes, C25 closes. A25, B32 and C30 lose the leftover Phase 1
caused, but each keeps a leftover owned by 2.5 B, 2.1 or a follow-up. That leaves **35 fixed and 12 carried**, each with
an owner. A16 and B27 wait on Q4.

## 3. New findings (deduplicated)

Severity is the highest any reviewer gave. "Ledger" cites the line number in `PROGRESS.md` (p1 head 7295839) when the
problem is already recorded there.

| # | Finding | Raised by | Severity | Owner | Ledger |
|---|---|---|---|---|---|
| N1 | The Undo message never times out and stays top-centre over content through Validate, Generate and view switches: the Destination field at 1440, headings and Results at 390, the fullscreen diagram | A#6, B#1, C#5 | major | (b) 1.5 F (in flight; `Messages.tsx` and `useUndo.ts` are the same on p1 and p2); when the offer ends: Q1 | 290-292, 316-317, 320-321, 339-342 |
| N2 | While the Undo is offered, Ctrl+Z on any control outside a text field reverts a whole import, long after it happened (`useUndo.ts:170-177`) | B#1 | major | Q1, then 1.5 F | no (287-289 is the browser's own field undo, a different bug) |
| N3 | Errors stay until closed and draw over dialogs: a failed paste covers the "Confirm Import" title and the changelog | A#7, B#11 | major | (b) 1.5 F (errors over dialogs) | 320-321 (Undo over a dialog only) |
| N4 | Drag reorder renumbers every entity of that kind, with no message and no Undo, unlike delete (`edits.ts:519-543`; `App.tsx:542-608`) | B#4 | major | Q2 | 212 is related (single-pointer alternative, 3.2) |
| N5 | The diagram's inserter dialog is a draft with Save; its machine, belt, chest and drill dialogs apply live | B#5 | major | Q3 | 244 (1.8 → 3.2) |
| N6 | No check of the target against what the machines can make: 240200 items/s (21836/s each, max 22.97/s) is accepted without a word | A#17, B#7 | major | Q4 | 206-208 |
| N7 | On fresh Results, Generate is the filled button and Copy blueprint is outlined | A#4, C#2 | major | (b) 2.7 A (`nextStepOf`). The 2.5 A spec (:59) planned an outlined Generate, but the 2.5 A branch hasn't done it and the ledger hands it to 2.7 | 205, 350 |
| N8 | Red is furniture: a red trash icon on every row and a red × on every filled slot, so a real problem can't out-shout them | C#3 | major | (b) 2.7 A (idle delete grey, red on hover or focus) | no (covered by the 2.7 spec) |
| N9 | At 720–960 the clock table loses Status, Rate and Wake-ups/min off the right edge with no cue; at 390 only Clock and Belt show | A#10, C#1 | major | (b) 2.9 (scroll inside, Status reachable at 720, `specs/2.9-half-width.md:35, 101, 170`); 2.5 B compact table; 390 is out of scope | 250 |
| N10 | The clock table is still decoded, not scanned: constant columns, wrapping cells, the (i) on its own line, no data bars, no sorting, the "How clocks are chosen" chevron 630px from its label, the recommended row third of five | A#18, B#6, B#22, C#8, C#13 | major | (b) 2.5 B | 200 |
| N11 | The untouched default form greets a newcomer with a red "2 problems" and red text | A#3, C#9 | major | (b) 2.1 (show it neutral while `isBlankBuild`); needs a spec line | no |
| N12 | The stale banner names only the recipe and rate, which match after any other edit, and it has no button. Its "Generate again" is valid on p2 | A#5, B#3, C#18 | major | "Generate again": (a) fixed on p2 by 2.3. Diff and button: (d) new follow-up; candidate 3.3 (results kept per config key) | 232-233 (wording only) |
| N13 | While generating, Results is empty except for "Debug Output", and progress shows only in the header | A#12, C#17 | major | (b) 2.5 B (Developer tools hides Debug Output) and 3.3 (progress with Cancel) | no |
| N14 | Results opens on the timelines, the blueprint is the third tab, and there are no install steps | A#8 | major | (a) the default tab is Wake windows on p2 (`ResultsWorkspace.tsx:106`); the answer card and steps are 2.5 A (in flight) | — |
| N15 | Validate is a separate step, it jumps to Configure, and any edit disables Generate | A#11, B#2 | major | (a) fixed on p2 by 2.3 (`WorkflowBar.tsx:253, 268`) | — |
| N16 | The timelines are unchanged: an unnamed canvas, the item palette collides with the state colours, Disabled is 1.5:1 | C#6 | major | (a) fixed on p2 by 2.10 (`colors.ts:29, 35`; `StateTransitionTimeline.tsx:208-209, 294-295`); keyboard access is out of scope (light fixes) | — |
| N17 | Diagram text is 8.8px `#666` (2.7:1), and the edges have no arrowheads | C#7 | major | (a) fixed on p2 by 2.11 (`flowNodeStyle.ts:2` at 12px; `EntityFlowNode.tsx:35, 42` `text.secondary`; `ConfigFlowDiagram.tsx:215-222` markers) | 228-229 |
| N18 | The Status chips take Tab but draw no ring. **Measured, 8 FAILs.** MUI Chip's root sets `outline: 0`, and a chip that isn't clickable is a div, so neither the ButtonBase rule nor the baseline `:focus-visible` rule reaches it. The Transfer Plan chips (`TransferPlanPanel.tsx:68, 79`) use the same pattern. 1.11 B (#162) added the `tabIndex` | B#19, C#4 | major (2.4.7) | (c) phase-end fix 1 | no |
| N19 | At 390 a lane's Stack Size is 14px wide. **Measured, axe target-size.** The ledger gives it to 2.9, but 2.9's spec requires nothing below 720 (:195) | C#19 | minor (2.5.8) | (c) phase-end fix 2 | 318-319 |
| N20 | The header is 133–141px and jumps 23px as the reason line comes and goes; still so on p2 (`WorkflowBar.tsx:278`) | C#10 | minor | (b) 2.9 (header height criterion); reserve the line or put it on the bar row at ≥960 | no |
| N21 | The disabled Generate's tooltip covers the reason it repeats | B#21, C#11 | nit | (a) fixed on p2 by 2.3 (`WorkflowBar.tsx:240-242, 261`) | — |
| N22 | The "Recommended" chip is the same orange as the selected row, so two rows glow once you pick another | C#12 | minor | (b) 2.7 A. Note that 2.7's role table keeps Recommended orange (spec :104), so 2.7 must settle it | no |
| N23 | Help is hover-only on the table headers and the Advanced switches | C#14 | minor | (b) 2.7 A, 2.5 B | 214 |
| N24 | The clock (i) popover is one 140-word paragraph | C#15 | minor | (b) 2.5 B | no |
| N25 | Insights prose runs ~200 characters a line with left-aligned numbers; Insights says "177.3 times a minute" while the table says 177 (engine prose, `insights.ts:288`) | B#18, C#16 | minor | (b) 2.5 B (Why?, alignment); the rounding: (d) follow-up (engine text, owner kept it) | 206 |
| N26 | Three duration formats | C#23 | nit | (b) 2.5 B | 206 |
| N27 | "…the Status and Clock-only output columns…": 1.10 (#146) renamed that column, and 1.12 B edited the next line and missed it | A#16, C#24 | minor | (c) phase-end fix 3 | no |
| N28 | The blueprint string runs under its copy icon. Still absolute on the 2.5 A branch (`BlueprintOutput.tsx:79-91`) | C#25 | nit | (b) 2.5 B | no |
| N29 | Confirm buttons disagree: Save is orange, Import Selected is green | C#26 | nit | (b) 2.7 A | 243 |
| N30 | Inserter rows: Destination truncates beside empty space; four empty "+" slots | C#20 | minor | (b) 2.7 B | 285 |
| N31 | A blue filled (i) on Machines, Belts and Drills | C#21 | minor | (b) 2.7 A (C16) | no |
| N32 | The out-of-date swing plan is drawn at opacity 0.45. Still on p2, now in Advanced (`CheckPlanSection.tsx:96`) | C#22 | minor | (b) 2.7 A contrast pass | 214 |
| N33 | The Paste dialog says "items" for entity kinds; the old-mod warning contradicts itself (still on p2: `sidecar-version.ts:94`) | A#13 | minor | (b) 2.1 (spec covers A17's warning); **ledger fix:** the 2.2 row says "A17 fixed", but only the target export landed | 359-360 |
| N34 | Paste never sets Target Output | A#14 | minor | (b) 2.1 (Target row in the confirm dialog) | — |
| N35 | The Paste confirm gives no counts of what it replaces and has no Append | B#8 | major | (b) 2.1 (B19, carried by 2.2) | row 2.2 |
| N36 | Clock names are engine internals; the bar's label has no "Selected:" | A#19 | minor | (b) 2.5 A (plain names) | — |
| N37 | The crafting-speed help offers a `/c` command with no warning that it disables achievements, and no pointer to the mod | A#20 | minor | (d) new follow-up; candidate 2.1 (Sidecar pointer) | no |
| N38 | Search deeper's "always" checkbox and its caption add noise | A#21, B §4 | nit | (d) new follow-up (2.5 B if it touches `DeeperSearchNotice`) | no |
| N39 | Configure order (Inserters before Belts); empty Chests and Drills cards at full size | A#22 | nit | (b) 2.7 B | — |
| N40 | Internal ids instead of game names | A#23 | nit | (b) 2.8 a/b | 254 |
| N41 | "✓ Copied" stays 2s after an edit. Still so on p2 (`WorkflowBar.tsx:158`). The 2.5 A hook compares blueprint strings, and a stale string doesn't change (`useCopyBlueprint.ts:73`) | A#24 | nit | (d) new follow-up → 2.5 B | no |
| N42 | Generation can't be cancelled, regenerating drops the pick, and nothing survives a reload | B#9 | major | (b) 3.3 | 286 |
| N43 | No duplicate, multi-select or bulk edit; 64 Tab stops on a small build | B#10 | major | (b) 3.2 | — |
| N44 | Undoing an import, paste or reset brings the build back but not its clocks | B#12 | minor | (d) new follow-up; candidate 3.3 | no |
| N45 | The same problem shows red at the top of Configure and as blue info in the Validation panel | B#14, C#9 | minor | (a) fixed on p2 by 2.3 (ValidationPanel deleted; `CheckErrorAlert.tsx:20` uses error) | — |
| N46 | A failed check's reason disappears on the first keystroke of the fix | B#15 | minor | (d) existing follow-up, no owner | 325-326 |
| N47 | Exclude from LCM's forced flag is stripped on Export (`configMapping.ts:124-129`), so after a round trip a forced Always on looks like the player's | B#16 | minor | (d) new follow-up | no |
| N48 | Recipe fields are `freeSolo`, so a typo is taken as a recipe (`MachinesForm.tsx:217`, `TargetOutputForm.tsx:69`); stack size silently falls back to 16 | B#17 | minor | `freeSolo`: (b) 2.8 a (it reworks the pickers); fallback: Q4's home | 207 |
| N49 | Debug Output and the Log tab sit on the main path | A §4, B#20, C §4 | minor | (b) 2.5 B (Developer tools) | — |
| N50 | Fuel table copy: "Enabled every", "Enables that swing" (`FuelPanel.tsx:138, 143` on p2) | B#23 | nit | (b) 2.5 B copy | no |
| N51 | Version chip v0.9.0; the in-app changelog lists none of Phase 1 | A Q1, B Q3, C Q | — | not a finding (expected); the final PR's changelog | — |
| N52 | "Transfer Activity Timeline" (the glossary retires "transfer"); timeline legend chips look like toggles | A (A25 row), C (C30 row) | nit | (d) follow-up; developer view, light fixes only | no |
| N53 | The Validation panel's copy is jargon | A#15 | minor | (a) fixed on p2 by 2.3 (ValidationPanel deleted; the plan is in Advanced, `CheckPlanSection.tsx`) | — |

**Counts:** 53 rows, one of which (N51) is not a finding.

- **8 are already fixed on p2, fully or in part:** N12's wording, N14's default tab, N15, N16, N17, N21, N45 and N53.
- **3 are phase-end p1 fixes:** N18, N19 and N27.
- **4 go to the owner:** N2, N4, N5 and N6, through Q1 to Q4.
- **The rest have a Phase 2 or 3 owner, or become follow-ups.**

16 rows are not in the ledger yet, leaving out the two p1 fixes: N2, N4, N8, N11, N12 (the diff and button), N13, N20,
N22, N24, N28, N31, N37, N38, N41, N44, N47, N50 and N52. The orchestrator should add them to Follow-ups, naming each
one's owner.

## 4. Proposed phase-end fixes on p1

All three are S-sized, touch 3 files and need no new tests beyond the capture. Run them as one child PR,
`feat/ux-rework-p1-phase-end`, with one sonnet implementer.

1. **A focus ring on focusable chips (N18, C25; 8 measured FAILs).** Size S.
   - **Where:** `clock-generator-ui/src/utils/a11yTheme.ts`, after the `MuiButtonBase` entry (:20-26). Add:

     ```ts
     // a Chip that is not clickable is a div, and MUI sets `outline: 0` on its root, which beats the baseline rule
     // above: one made focusable for its tooltip (the clock table's Status, the swing plan's chips) needs the ring too
     MuiChip: { styleOverrides: { root: { '&:focus-visible': ring } } },
     ```
   - **Why it works:** MUI `Chip.js:104` sets `outline: 0`, and at `:418` a chip that isn't clickable renders as a
     `div`, so `.Mui-focusVisible` never applies to it.
   - **What it covers:** `ClockAlternativesPanel.tsx:172-179` and `TransferPlanPanel.tsx:67-80`. Clickable chips already
     get the same ring through ButtonBase, so nothing is drawn twice.
   - **Verify:** the `a11y` capture's Results ring checks at all 4 widths, plus a ring check on the swing plan's chips
     after a check.
   - **On p2:** the file is identical (`git diff p1 p2 -- a11yTheme.ts` is empty), so it merges cleanly.
   - **Note for the 2.7 A spec:** 2.7 A adds its own `MuiChip` override (square chips, `specs/2.7-gui-grammar.md:89`).
     It must keep this rule in the same entry.
2. **The lane row wraps at 390 (N19, C25; 3 axe target-size FAILs).** Size S.
   - **Where:** `clock-generator-ui/src/components/BeltsForm.tsx`.
   - **Changes:**
     - The lane row `Box` (:191-194) becomes `sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}`.
     - The lane `ItemSelector` (:206) becomes `sx={{ flex: '1 1 180px', minWidth: 0 }}`.
     - The Stack Size `NumberField` (:221) becomes `sx={{ width: 100, flexShrink: 0 }}`.
     - The "Consumed /s" wrapper `Box` (:226) gets `sx={{ flexShrink: 0 }}`.
   - **Effect:** at ≥720 nothing wraps (the row needs about 560px). At 390, Stack Size and the delete button move to a
     second line at full width.
   - **Verify:** axe target-size is clean on Configure and in the chest-filter state at 390; Stack Size is at least 24px
     wide; the 1440, 960 and 720 shots are unchanged.
   - **On p2:** the lane row is unchanged; p2's only `BeltsForm` change is the belt question above the list (+13 lines).
     So it merges cleanly.
   - **Conflict risk:** 2.8 a may touch the same `ItemSelector` line (a `kind` prop), which would be a one-line conflict.
     2.7 B later rebuilds the rows.
   - **Ledger:** close line 318.
3. **The stale column name (N27; A25, B32, C30).** Size S.
   - **Where:** `clock-generator-ui/src/components/ResultsWorkspace.tsx:201`.
   - **Change:** `'This is the run the Status and Clock-only output columns are judged on.'` becomes
     `'This is the run the Status and Output per clock period columns are judged on.'`, matching
     `OUTPUT_PER_PERIOD_HEADER`, `numberText.ts:80`.
   - **On p2:** the same line is at `ResultsWorkspace.tsx:213`, and at `:236` on the 2.5 A branch, with the same
     context, so it merges cleanly.
   - **Check:** grep `src` for any other copy that names an old column ("Clock-only", "Potential Clocks").

**Considered and not proposed for p1:**

- **1.5 F (the message placement).** It would qualify: it's a Phase 1 regression, and `Messages.tsx`, `useUndo.ts` and
  `undoSnapshot.ts` (except one string) are the same on p1 and p2. But it waits on Q1, and its spec is being written
  against p2. Keep it on p2 so p1 isn't held.
- **The red count on a blank form (N11).** 2.1 rebuilds the first visit around `isBlankBuild`, so it belongs there.

## 5. Questions for the owner

1. **Should the Undo offer end when a check or generation starts?** (N1, N2; B's open question 1; A's open question 3.)
   Today it ends on an edit, Close, Esc or an editing dialog, so after an import it can last the whole session, and
   Ctrl+Z reverts the import long after.
   - (a) Keep it as it is, and only move the message (1.5 F).
   - (b) End the offer when Check only or Generate starts. Running the build accepts it. This adds no timer, so the
     2.2.1 decision stands.
   - (c) Keep the offer, but dock it as an "Undo import" button in the workflow bar.

   **Recommendation: (b), with 1.5 F's placement.** It removes the stray Ctrl+Z risk at its root, and it is a one-line
   addition to the hook's end conditions.
2. **What should drag reorder do now that it renumbers?** (N4)
   - (a) Keep drag, and treat a reorder like a delete: a message such as "Moved Inserter 5 to 2. Inserters 2–4 are now
     3–5." with Undo.
   - (b) Drop drag reorder, if row order means nothing to the engine (unverified; it would need checking).
   - (c) Keep drag without renumbering. This contradicts the owner's renumber decision.

   **Recommendation: (a).** It is small: wrap `reorder*` in `offerUndo`, as removes already are. Put it in 3.2 with the
   Move up/down alternative that 2.5.7 needs (ledger line 212), or in a small Phase 2 item.
3. **Diagram dialogs: drafts with Save, or live edits?** (N5, B's open question 5)
   - (a) Every diagram dialog is a draft with Save and Cancel, like the inserter dialog and the rule modal since 1.8.
   - (b) Every one applies live and offers Undo.

   **Recommendation: (a), in 3.2's shared editor.** It is the model 1.8 chose, and it needs no new Undo surface.
4. **Should a target above what the machines can make block or warn?** (N6, A16, B27; B's open question 4)
   - (a) Block: a first problem, "Target 21836/s per copy is above Machine 1's max 22.97/s".
   - (b) Warn: a yellow line under Items per Second and a ⚠ in the bar. Generate still runs, and the clocks show as
     below target.
   - (c) Leave it to the engine's result.

   **Recommendation: (b).** A block fights a player in mid-edit, and the engine already reports below-target clocks. Give
   it one home, a small Phase 2 item or 2.7 B (which relays out Configure), together with B27's leftovers: select-all on
   mouse focus, and an error instead of the silent stack-size 16.
5. **Will you accept closing Phase 1 with 12 findings carried?** The bar says "none still present", and that holds only
   after the 3 p1 fixes. Then every leftover is either already fixed on p2 or owned by a named Phase 2 or 3 item, except
   A16 and B27 (Q4).
   - (a) Accept, and merge p1 once the fixes are green.
   - (b) Also require the 720–960 clock table (N9) before closing, which pulls 2.5 B and 2.9 forward.

   **Recommendation: (a).** PLAN's Verification step allows carrying. 2.9 and 2.5 B already own the table.

## 6. Retro draft (for `PROGRESS.md` "Retros")

```markdown
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

**PLAN.md changes:** 1.3 (if Q1 = b: the offer ends when a check or generation starts); 2.1 (a blank build shows its
next step neutrally, not as red problems); 2.5 B (gains: the clock (i) popover, the blueprint string's padding, the
recommended row first, "Copied" reset on a change, Debug Output while generating); 2.9 (header height and the reason
line); 3.2 (reorder message and Undo per Q2, diagram dialogs per Q3); 3.3 (Undo of an import restores the clocks; the
stale banner lists what changed). Ledger corrections: 2.2's "A17 fixed" → only the export part (2.1 owns the warning);
close line 318 (lane field, fixed on p1).
```

## Caveats on the evidence

- **Not captured:**
  - a below-target clock, so "Copied. {rateWarning}" and "Copy blueprint (192/s, below target)" (C4, C6) were never seen
    on screen;
  - renumbering after a delete (B4);
  - B5, B6 and B16 are graded from code only.
- **The 240200 in shot 27** comes from the capture script typing into the field, as in the original review. That nothing
  warns at that value still stands.
- **The second axe target-size node** (`#_r_kd_`, chest-filter state, 390) is assumed to be the same lane Stack Size
  field. Fix 2's verification confirms it.
- **The reviewers saw p1 only.** About a dozen of their leftovers are already gone on p2 (section 3, owner (a)). The
  phase PR's summary should say so, so the carried list isn't over-read.
