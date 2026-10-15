# UX review C (end of Phase 1): visual design, information design and accessibility

**What I reviewed:** 0.9.1 plus the Phase 1 rework, at commit 84197ba.

**Where the evidence lives:**
- Screenshot paths are relative to `/tmp/ux-capture/out/phase1-end/`.
- Source paths are relative to `/tmp/ux-review-p1/clock-generator-ui/src/`.
- PASS and FAIL results from `a11y/` and `a11y-names/` are measured, and I treat them as fact.

### 1. Gut reaction

The site now talks back. The stale banner and the yellow ⚠ chip are impossible to miss. The problem chip names what's wrong and takes me to it. With a screen reader, I hear "Your build can be clocked", "Finished generating" and "Blueprint copied".

Visually, though, it is still a row of outlined buttons of equal weight:
- On Results, the loudest control is the Generate I have already pressed. Copy blueprint is an orange outline, the same as Validate.
- Red has become furniture. Every row has a red trash can and every filter a red × badge, so when something really is wrong, red has nothing left to say.
- The clock table is still a spreadsheet to decode. At 720–960px, the widths the owner promised full support for, its Status, Rate and even Wake-ups columns fall off the right edge with no hint that they exist.
- The timelines have not changed.

### 2. Top 5 changes I'd make tomorrow

1. **Make the clock table work at 720–960px, and make it scannable.**
   - Below about 1100px, show four columns: Clock, Wake-ups/min, Rate and Status. Put the rest behind "Show all columns" (this is 2.5's compact table; pull it forward).
   - Use nowrap cells.
   - Fold the constant columns into one summary line.
   - Add data bars to Wake-ups/min.

   This is the screen where the player decides, and at the docked width they cannot see the column that decides. (Findings 1 and 8.)

2. **One filled button per state, and on Results it is Copy blueprint.** Once a fresh blueprint exists:
   - Copy blueprint becomes contained green (Factorio's "confirm").
   - Generate becomes outlined.
   - Validate drops to a text button.

   It is a 3-line change in `WorkflowBar.tsx`, and it points every player at the thing they came for. (Finding 2.)

3. **Take red off the furniture.**
   - Draw the trash icons and filter × badges in `text.secondary`, red only on hover or focus.
   - Show the × only on hover or focus of a slot, keeping its 24px target and adding Delete on a focused slot.

   Phase 1 made red mean "problem" (the problem chip, the reason link, the coverage alert). That only works if red means nothing else. (Finding 3.)

4. **Close the accessibility gaps Phase 1 left.**
   - Give Chip a focus ring in `a11yTheme.ts`. The Status chips are 4 measured FAILs at every width.
   - Fix the diagram's 8.8px text in `#666` (about 2.7:1).
   - Wrap the lane Stack Size field at 390px (the only axe failure).

   All three are small, and each one fails AA today. (Findings 4, 7 and 19.)

5. **Move the Undo message out of the reading area.** Keep the no-timer rule, but put the message at the bottom left, or dock it as an "Undo import" button in the workflow bar. Today it sits at top centre, where content starts, through Validate, Generate and every view switch. It covers the Clocks heading at 390px and the empty-state sentence on Results. (Finding 5.)

### 3. All findings

| # | What's confusing or odd | Who it hurts | Severity | Proposed change | Effort | Evidence |
|---|---|---|---|---|---|---|
| 1 | The clock table loses its decision columns at the widths the owner made full-support. At 960, Status is clipped to a sliver and the headers wrap to 4 lines ("Output / per / clock / period"). At 720, Rate, Output and Status are off the right edge. At 390 only Clock and Belt show, so Wake-ups/min, the number the pick is made on, is invisible. There is no scroll shadow and no hint that more columns exist. | Players with the site docked beside the game (720–960); phones | major | Below ~1100px: a compact table (Clock · Wake-ups/min · Rate · Status) with "Show all columns" for the rest. Short headers, with units in a caption ("per copy unless marked"). `white-space: nowrap` on cells. An edge shadow on the TableContainer when it overflows. | M | w960/07-logistic-results-timelines-960-part1of3.png, w720/07-…-720-part1of3.png, w390/07-…-390-part1of4.png; `ClockAlternativesPanel.tsx:252-300` |
| 2 | The action hierarchy on Results is still upside down. After generating, Generate (filled green, already done) is the loudest control. Copy blueprint is outlined orange, identical in weight to Validate, and a "Valid" chip sits between them: four peers. | Every player at the moment they came for | major | With a fresh blueprint: Copy blueprint `variant="contained" color="secondary"`, Generate outlined, and Validate a text button (or hidden while Valid, since 2.3 removes it). Before results: Validate, then Generate, filled in turn. | S | w1440/19-…-part1of3.png, w1440/26; `WorkflowBar.tsx:164-170, 215-239` |
| 3 | Red is furniture. Error `#ff5958` paints every row's trash icon, a 24px filled red × on every filled filter slot, the problem chip, the reason link and the coverage alert. A healthy 3-inserter build shows 6 saturated red marks in one card. On a broken build, the red "Missing Inserter Coverage" panel cannot out-shout them. | Everyone; anyone scanning for what's wrong | major | Trash icons and ×: `text.secondary`, red on hover or focus only. Show × on slot hover or focus, keep the 24px target, and add Delete/Backspace on a focused slot. Reserve red for problems. | S | w1440/18, a11y/w1440/04-slots-1440.png, a11y/w1440/22-chest-slots-1440.png, extra/w1440/07; `InsertersForm.tsx:463`; `FilterSlotSelector.tsx:179-183`; `ChestFilterSlotSelector.tsx:193-194` |
| 4 | The Status chips take Tab but draw no focus ring: a measured FAIL at all four widths, 4 stops each. MUI Chip's root `outline: 0` beats the global `:focus-visible` rule. The Transfer Plan's LCM and Included chips use the same pattern (`tabIndex={0}` on a non-clickable Chip) and very likely fail too, though they were not measured. | Keyboard users | major (WCAG 2.4.7) | Add `MuiChip: { styleOverrides: { root: { '&:focus-visible': ring } } }` in `a11yTheme.ts`. Re-run the ring check on Configure after Validate. | S | a11y/INDEX.md:164-165, 258-259, 324-325, 391-392; a11y/w1440/tab-order-results.txt stops 16–22; `ClockAlternativesPanel.tsx:172-179`; `TransferPlanPanel.tsx:67-80`; `a11yTheme.ts:14-26` |
| 5 | The "Build imported. Undo" message has no timer (by design) and sits at top centre, exactly where content starts, through Validate, Generate and view switches. It covers the inserter's Destination and "Filters:" label at 1440, the Clocks heading at 390 and "Nothing generated yet…" on Results. It is still there while generating. At 390, header plus message is about 230 of 844px. | Everyone after an import; narrow screens most | major | Keep the no-timer rule, but anchor the message bottom left, or dock it in the workflow bar as an "Undo import" text button. Dismiss it on Generate. | S | w1440/09, w390/07-…-part1of4.png, extra/w1440/08, a11y-names/w1440/11-generating-1440.png; `Messages.tsx:88-99` |
| 6 | The timelines are unchanged and are still the default tab. The state timeline is an unnamed canvas with no keyboard access. Item colours reuse the state palette (transport-belt is "Waiting" yellow; logistic-science-pack is orange). Disabled `#585858` is about 1.5:1 on the track. Entity labels are coloured green and blue for no stated reason. The grey badges "48" and "17" have no label. The axis is 0/100/200 with no gridlines and no unit. | Everyone checking why; screen-reader and touch users | major | As planned in 2.6/2.10. Until then, at least: `role="img"` plus an aria-label summary per row, an item palette with no yellow, green or grey, and Disabled drawn as a hatch. | L | w1440/19-…-part2of3.png, w1440/20-…-part2of3.png; `colors.ts:8-31`; `StateTransitionTimeline.tsx` (the only aria in the file is the close button at :1031) |
| 7 | The diagram's text fails contrast and is tiny. The machine footnote "5.2t craft · insertion limit ×15" is 0.55rem (~8.8px) `#666` on `#232323`, about 2.7:1. Inserter sublabels are 0.6rem. There are still no arrowheads, and inputs sit right of the machine with edges looping back. The owner set AA for player-facing views. | Low-vision users; anyone checking flow | major (1.4.3) | Text ≥12px; the footnote in `text.secondary`; `markerEnd: ArrowClosed`; sources on the left. | M | w1440/12-…-part1of2.png, w1440/13; `EntityFlowNode.tsx:27-39`; `InserterFlowNode.tsx:38-44` |
| 8 | The clock table still has to be decoded. Constant columns (240.00 ×5, Stable ×5). "4 per 176 ticks" wraps. Long names push the (i) onto a third line, so rows come in three heights. Wake-ups/min has no bars, so 177 next to a Stable 0 still looks like a wrong pick, despite the reason line. | Every player at the moment of choosing | major | Fold the constant columns into one line ("All 5 hold 240/s and recover"). Nowrap the cells. Put the (i) in a fixed slot before the name. Add inline data bars in Wake-ups/min. Put "only if the belt stands still" in the Belt cell of non-moving rows. | M | w1440/19-…-part1of3.png, w1440/26; `ClockAlternativesPanel.tsx:136-180` |
| 9 | The first visit greets the player with error red: a filled red "2 problems" chip and a red sentence on an empty form. The Validation panel shows the same sentence as a blue info alert. One fact in two severities, red before the player has done anything. | Newcomers | minor | On a pristine form, show the next step in `text.secondary` with a neutral outlined chip ("2 steps left"). Turn it red after Validate or a blur. The Validation panel uses the same severity as the bar. | S | w1440/02, w1440/03-…-part2of2.png, extra/w1440/06-…-part2of2.png; `WorkflowBar.tsx:187-200, 243-276`; `ValidationPanel.tsx:58-60` |
| 10 | The sticky header is 141px at 720–1440 (16% of a 900px viewport) and 133px at 390. It jumps ~23px whenever the reason line appears or goes (compare 02 with 17). | Everyone; small laptops | minor | At ≥960, put the reason on the bar row, left of the chips. Otherwise reserve its line height. | S | a11y/INDEX.md:124, 218, 284, 350; w1440/02 vs w1440/17; `WorkflowBar.tsx:243-277` |
| 11 | The disabled Generate's tooltip repeats the visible reason and covers it. | Mouse users | nit | Drop the tooltip while the reason is shown. It is already `aria-describedby`. | S | w1440/04, extra/w1440/07, extra/w390/06; `WorkflowBar.tsx:212-240` |
| 12 | "Recommended" is a filled brand-orange chip, the same orange as the selected-row tint and the radio. When the player selects another row, two rows glow orange, and the chip looks like a button. | Players comparing clocks | minor | Recommended becomes an outlined chip with ★ in `text.primary`. Orange marks selection only. | S | w1440/19-…-part1of3.png; `ClockAlternativesPanel.tsx:145-151` |
| 13 | "How clocks are chosen" reads as plain text. Its chevron is about 630px to the right of the label, because of the 72ch accordion width. | Everyone | minor | Put the chevron right after the label, and style the label as a link. | S | w1440/19-…-part1of3.png; `ClockAlternativesPanel.tsx:223-236` |
| 14 | Help is still tooltip-only for the clock table's headers and for every Advanced Overrides switch: 80–100-word tooltips. Keyboard now works, but touch cannot open them. | Touch and low-vision users | minor | Use the existing `InfoPopoverButton` ("?", click or Enter) on each header and switch, plus a one-line helper under each switch. | S | `ClockAlternativesPanel.tsx:261-296`; `OverridesForm.tsx:62-152` |
| 15 | The clock (i) popover is one 140-word paragraph in 360px. | Anyone asking "how is this made" | minor | One lead sentence and 3 bullets; then the Status line on its own row, verdict first. | S | w1440/24; `ClockAlternativesPanel.tsx:139-144` |
| 16 | Insights cards are three paragraphs at ~200 characters a line, with left-aligned numbers (68.2, 654.5, 36%). The Fuel tab right-aligns its numbers, so the two tabs disagree. | Everyone | minor | `maxWidth: '72ch'` on the prose. Right-align numeric columns with tabular figures. Put Why and Explanation behind "Why?" (2.5). | S | w1440/21-…-part2of3.png, part3; extra/w1440/11-…-part2of2.png; `InsightsPanel.tsx:14-22, 46-52` |
| 17 | While generating, Results shows nothing but "Debug Output". Progress is a 4px bar and a 12px caption in the header. On a broken build, Results says "Press Generate to create clocks" while Generate is disabled. | Everyone during the wait; broken builds | minor | A progress card in Results ("Generating: Batched swings, clock start 4/12") with the pending rows. The empty state names the first problem. Hide Debug Output there. | S | a11y-names/w1440/11-generating-1440.png, extra/w1440/08; `ResultsWorkspace.tsx:126-134` |
| 18 | The stale banner says "Generate again." while Generate is disabled and the bar says "Validate again". | Anyone after an edit | minor | "…Your build has changed since. Validate, then Generate again.", until 2.3 merges the two. | S | w1440/28; `utils/resultsStaleness.ts:46-48` |
| 19 | At 390, the lane Stack Size field collapses to 14px under the trash icon. This is the run's only axe failure, in both runs. | Phone users | minor (below 720 only reachability is promised; still a 2.5.8 failure) | Under 600px, wrap the lane row: Ingredient full width, then Stack Size and delete on the next line. | S | a11y/w390/14-focus-not-obscured-field-390.png; a11y/INDEX.md:364, 375, 411; a11y-names/INDEX.md:503; `BeltsForm.tsx` |
| 20 | In inserter rows, Destination truncates ("Machine 1 - logistic-sc…") while ~200px of the row sits empty. There are four empty "+" slots per row. | Everyone editing inserters | minor | A grid where Source and Destination grow; the filled filters plus one "+". | M | w1440/18; `InsertersForm.tsx:448-466`; `FilterSlotSelector.tsx` |
| 21 | The blue filled (i) on Machines, Belts and Drills is the only blue in the palette, and a different help style from the clock's grey (i). | Everyone | minor | One grey "?" `InfoPopoverButton` everywhere. | S | w1440/02; `MachinesForm.tsx`, `BeltsForm.tsx`, `DrillsForm.tsx` |
| 22 | An out-of-date transfer plan is drawn at opacity 0.45 (captions drop to about 2.7:1). | Low-vision users | minor | Full opacity, an "Out of date" chip, and keep `inert`. | S | `ValidationPanel.tsx:84` |
| 23 | Three duration formats: "264 ticks (4.4 seconds)", "(4.40 seconds)" and "1920 ticks (32.0 seconds)". | Everyone | nit | One helper in `numberText.ts`. | S | w1440/19-part2, w1440/22-part2, extra/w1440/11-part2; `BlueprintOutput.tsx:61`; `StateTransitionTimeline.tsx:1002`; `FuelPanel.tsx:386` |
| 24 | The copy names a column that no longer exists: "the run the Status and Clock-only output columns are judged on". 1.10 renamed that column "Output per clock period (1 copy)". | Everyone | nit | "…the Status and Output per clock period columns…" | S | w1440/19-part2; `ResultsWorkspace.tsx:201` |
| 25 | The blueprint string runs under the copy icon in the Blueprint tab. | Everyone | nit | Pad the text 48px on the right, or put a labelled "Copy blueprint string" button above it. | S | w1440/22-…-part2of2.png; `BlueprintOutput.tsx` |
| 26 | Confirm buttons disagree: "Save" is filled orange in the Enable rule dialog, while "Import Selected" is filled green. | Everyone, subtly | nit | Green filled for every confirm (the owner's Factorio grammar). | S | w1440/11, w1440/07; `EnableControlModal.tsx` |

### 4. What I'd cut or hide

- **"Debug Output" on Results,** including on the empty and generating states. Move it to Developer tools (2.5).
- **The "Valid" chip plus the Validate button on Results** once a blueprint exists. Neither is a next step there.
- **Constant columns in the clock table:** Rate when every row matches, and Status when every shown row is Stable.
- **Tooltips that repeat visible text** (the disabled Generate's reason).
- **Empty filter slots:** keep the filled ones plus one "+".
- **The three-line Validation paragraph:** one line is enough.
- **The Simplified/Detailed, By Type/By Flow, filter and palette controls on the default tab:** behind Developer tools, as 2.5 plans.

### 5. What already works

- **The warning system is now unmistakable.** A filled lemon `#ffe14d` chip with black text and ⚠, a full-width stale banner, and "Copy old clock…" behind a confirm that names the old build (w1440/27–29). Results are cleared on import (extra/w1440/08).
- **The accessibility plumbing is real, and measured.**
  - One polite status region announces Validate, Generate and Copy once each, even with a dialog open.
  - 482 name, description and heading checks pass: every row, handle, delete, select and radio is named, and there is a real h1/h2/h3 outline.
  - A 2px ring at ≥5.12:1 shows on every Configure stop.
  - Nothing is hidden under the sticky header.
- **The first-problem pattern and the units pass are what a data tool should do.**
  - The bar names the first missing thing and jumps to it.
  - Items per Second is labelled "Total for all 11 copies (21.82/s each)", and the machine facts chip reads "max 22.97/s".
  - The headers say "Wake-ups/min (1 copy)" and "Rate (items/s, all 11 copies)".

### 6. Phase 1 findings

Phase 1's own bar is that "the fresh UX review finds none of the Phase 1 findings still present". **It is not met:**
- **C3, C7, C10, C24, C25 and C26 are only partly fixed.**
- **C25 carries measured AA failures:** 4 Status chips with no focus ring at every width, and an axe target-size failure at 390.
- **Everything else in the list is fixed, or fixed for its Phase 1 part.**

| Finding id | Status | Evidence | What's left |
|---|---|---|---|
| **C1** (1.2) | fixed | w390/02, w390/07-part1, w720/02, w960/07-part1 (the toggle, Generate and Copy are visible at every width); a11y/INDEX.md:124, 218, 284, 350 (scroll-padding covers the header; no focus stop hidden) | The header is 133–141px and jumps 23px as the reason line comes and goes (finding 10). |
| **C3** (1.5) | partly fixed | The footer is static (a11y/INDEX.md: "footer position static"); Ko-fi is an outlined button (w1440/03-part2; `App.tsx:740-753`) | The "one filled next-step button per state" half is not done. On Results, Generate is filled green and Copy blueprint is outlined (finding 2). 2.5's card will have a filled Copy, but the bar will still contradict it. |
| **C4** (1.14) | fixed | w1440/27, 28, 29; `App.tsx` (warning `#ffe14d`, black text); `WorkflowBar.tsx:15-19` | The below-target label "Copy blueprint (192/s, below target)" exists in code (`utils/rateWarning.ts:66-76`), but no capture shows it. |
| **C5** (1.1) | fixed | w1440/28 (banner), w1440/29 (confirm dialog), extra/w1440/08 (results cleared on import) | The banner says "Generate again" while Generate is disabled (finding 18). |
| **C6** (1.5) | fixed | w1440/06 (the paste error fully visible below the header); `Messages.tsx:88-99` (Portal) | The "Copied. {rateWarning}" toast: can't tell from evidence (no below-target capture). It uses the same host, so it is probably fine. |
| **C7** (1.6) | partly fixed | The Recommended chip, a one-line reason, the "How clocks are chosen" disclosure (72ch) and the "Unstable clocks" group: w1440/19-part1, w1440/26 | Constant columns, wrapped cells, no data bars and the (i) wrapping onto its own line (finding 8). The orange chip clashes with the selection (finding 12). The decision columns are clipped at 720–960 (finding 1). |
| **C8** (1.11) | fixed | a11y-names/INDEX.md: every focusable control named on Configure (104) and Results (36); rows, handles, deletes, selects and radios named; axe button-name, select-name and label clean | none |
| **C9** (1.11) | fixed | a11y-names: headers are named by their text with the tooltip as a description; the LCM and Included chips are named | none |
| **C10** (1.4/1.11) | partly fixed | The disabled reason is visible text and a link: w1440/02, extra/w1440/07, `utils/firstProblem.ts`. The clock (i) is a button with a popover: a11y-names/w1440/05 and its PASS lines | The table headers and Advanced Overrides switches are still tooltip-only, so touch cannot open them (finding 14). The tooltip duplicates the visible reason (finding 11). |
| **C13** (1.11) | fixed | a11y/INDEX.md: one polite region, empty on load; Validate, Generate and Copy each announced once; the progress bar is named "Generating clocks" | none |
| **C15** (1.3) | fixed | w1440/05 (a divider above a red "Reset Configuration"); w1440/09 ("Build imported. Undo"); the polite text "Build imported. Or press Cmd+Z to undo." | The message that never times out sits over content (finding 5). |
| **C22** (1.11) | fixed | a11y-names: one h1, no h6 left, no skipped levels, sections h2, cards h3, on every view | none |
| **C24** (1.13) | partly fixed | A quiet "Enable: Auto" chip on every row: w1440/18; `utils/enableRuleLabel.ts` | A red trash icon on every row (finding 3); Source and Destination truncate beside empty space; four empty "+" slots (finding 20). I found no plan item that covers these. |
| **C25** (1.11) | partly fixed | The × is now 24px, not nested in the slot and clear of its neighbours; AUTO is 11px with a dashed border (a11y/INDEX.md PASS lines; `FilterSlotSelector.tsx:106-158`) | The Status chips have no focus ring: 4 FAILs at each width (finding 4). The lane Stack Size is 14px at 390, an axe target-size FAIL (finding 19). Both fall under 1.11's "2px ring, 24px targets". |
| **C26** (1.10) | partly fixed | Crafting speed "68.906", "max 22.97/s", units in the headers, helper text under Items per Second and Copies: w1440/18, w1440/19-part1 | Three duration formats (finding 23). Insights numbers are left-aligned (finding 16). |
| **C27** (1.7) | fixed (Phase 1 part) | w1440/19-part1: "We stopped once we found a working clock… [Search deeper]" plus "Always search deeper for this build" | The other prose walls C27 named (Insights, Validation) belong to 2.3 and 2.5. |
| **C30** (1.12) | fixed (Phase 1 part) | "Assembling machine" in the List and the diagram dialog: w1440/13. The old copy ("devided", "Generate Blueprint", "Re-run the simulation", "Assembler") is gone from `src` (grep) | The legend-chip half belongs to 2.10. New drift: "Clock-only output columns" (finding 24). |
| A5, B1 (1.1) | fixed | as C5 | as C5 |
| A7, B25 (1.2) | fixed | as C1 | — |
| A18, B2, B3 (1.3) | fixed | w1440/05, w1440/09 | B3 is met by the owner's decision (Undo snackbar, no history). |
| A6, B21 (1.4) | fixed | extra/w1440/07 (the reason names the missing inserter); extra/w1440/08 (the chip and reason also show on Results) | The empty state on Results still says "Press Generate" while Generate is disabled (finding 17). |
| A14, B30, A29 (1.5) | fixed | w1440/06, w1440/19-part3 (static footer, outlined Ko-fi) | — |
| A9, A11, B12 (1.6) | fixed | w1440/19-part1; extra/w1440/11-part1 (the tie-break reason given); `ClockAlternativesPanel.tsx:145-151, 199-209` (the chip stays, plus "Back to recommended") | — |
| B14 (1.6) | partly fixed | The intro is shorter and the unstable rows are grouped (w1440/26) | The tabs still start below the fold at 1440 (the tab bar is at about y=960 in w1440/19). There is no sorting. |
| A22, B15 (1.7) | fixed | w1440/19-part1 | — |
| B5, B6, B16 (1.8) | fixed (code only, no capture) | `utils/configForm/edits.ts:449-488` (forced ALWAYS flagged, player rules kept); `EnableControlModal.tsx:398-399, 442-444` (no backdrop close; discard confirm); `ConfigFlowDiagram.tsx:252` (`deleteKeyCode={null}`) | — |
| B4 (1.9) | fixed as far as the shots show | "Inserter 1–3" agree in the List chips, diagram, Insights and timelines: w1440/18, 12, 21-part2, 19-part2 | Renumbering after a delete was not captured: can't tell. |
| A16, A26, B13 (1.10) | fixed | w1440/18 (helper text), w1440/12 ("insertion limit ×15"), w1440/19-part1 (units in the headers) | — |
| B27 (1.10) | partly fixed | The decimals are fixed | 240200 items/s ("21836.36/s each", against a machine whose max is 22.97/s) is accepted with no warning: w1440/27. |
| A25, B32 (1.12) | partly fixed | The typos and old names are gone; enable modes in title case (w1440/11) | "Clock-only output" (finding 24). "Stable/Unstable" stays in the Status column and the pick reason, though glossary term 13 says "holds the rate" (`utils/recommendedClock.ts:33-78`). This may be deliberately left for 2.5. Engine text ("hands") was left by the owner's decision. |
| A23, B7 (1.13) | fixed | w1440/18; w1440/11 | — |

### 7. Open questions for the author

- **The version chip says "v0.9.0"** (`package.json` is 0.9.0) while this build is described as 0.9.1 plus Phase 1. Is that expected until the final bump? Players filing bugs from a preview will cite the wrong version.
- **The clock table at 720–960px.** Is Phase 1 allowed to close with the decision columns clipped at the half-width the owner promised, or should 2.5's compact table come first?
- **The Undo message that never times out.** Was dismissing it on Generate or on a view switch considered? WCAG 2.2.1 only rules out a timer.
- **"Stable" vs "holds the rate".** Is "Stable" kept on purpose until 2.5 renames the Status column?
- **Does the owner's "full AA for player-facing views" include the Diagram (beta)?** If so, its 8.8px `#666` text and missing arrowheads are Phase 2 work, not "light fixes".
- **Red delete icons.** Is the red on every trash icon and × a deliberate Factorio reference? The game's GUI uses red only for the hovered delete button.
