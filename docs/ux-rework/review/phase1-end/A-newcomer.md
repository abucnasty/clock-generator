# UX review: Designer A, newcomer advocate (end of Phase 1, commit 84197ba)

### 1. Gut reaction
I click the Reddit link and still land on a bare form with no sentence saying what the tool does, what I'll get or where to start. The first new thing I notice is a red "2 problems" chip and red text, "Set the recipe in Target Output", before I've touched anything. The site scolds me on arrival. The mod that would make this easy is still unnamed and still hidden in the ⋮ menu. Once I get to Results it is much better than before: a "Recommended" chip, one plain line on why it was picked, a "Search deeper" button, and the site won't quietly hand me an old blueprint any more. But the screen still opens on two tick charts, the blueprint is on the third tab, and the loudest button on Results is Generate, not Copy. A newcomer can now trust the result. They still can't find their way to it.

### 2. Top 5 changes I'd make tomorrow

1. **A first screen that explains the tool and names the mod (planned for 2.1/2.2, still the biggest gap).** The first view (w1440/02, w390/02) is the Target Output form plus a red problem count. Before any form, add:
   - one sentence on what the tool does;
   - three ways in: **Import from Factorio** (link the Clock Generator Sidecar mod and its 3 steps), **Try an example** (the 9 science samples) and **Build by hand**.

   Until then, show the untouched default form as a neutral "Start here: pick the recipe you want to make" instead of a red "2 problems" (`firstProblem.ts:72-103` treats the blank default as two errors). Nobody should be told they've failed before they've started.

2. **Make Copy the filled button on fresh Results, and Generate the quiet one.** On Results with up-to-date clocks (w1440/19, 24, 26) the only filled button is green GENERATE, which re-runs everything. COPY BLUEPRINT, the thing I came for, is an outline beside it (`WorkflowBar.tsx:164-166, 228-233`). The fix: when results are current, make Copy `contained` primary and make Generate `outlined`; when the build has changed, swap them back. Of all the fixes here, this one does the most to get a newcomer to "done". Later, the 2.5 answer card should carry the same Copy button and the install steps.

3. **Stop the next-step text from pointing at disabled buttons.** Three places tell the player to press Generate while Generate is greyed out, because Validate has to come first:
   - the stale banner, "These clocks are for logistic-science-pack at 240/s. Your build has changed since. **Generate again.**" (w1440/28; `resultsStaleness.ts:47`). The bar under it says "Validate again".
   - the empty Results state, "Nothing generated yet. **Press Generate** to create clocks for your build." It shows even while "2 problems" blocks Generate (w1440/32, extra/w390/07; `ResultsWorkspace.tsx:134`).
   - the stale Copy tooltip and dialog, "Generate again to get a clock…" (`resultsStaleness.ts:8,10`; `StaleCopyDialog.tsx:33`).

   Until 2.3 folds Validate into Generate, take these sentences from `blocked.generate`: "Fix the 2 problems on Configure first [Go to first]" or "Validate, then Generate again". It is a small change that removes a dead end.

4. **Move the messages off the content.** The Undo message has no timer by design (`undoSnapshot.ts:7`) and sits top-centre over the page (`Messages.tsx:44, 99`). So "Build imported. UNDO" stays on screen through Validate and Generate:
   - at 1440 it covers the inserter's Destination field (w1440/09);
   - at 390 it covers the Target Output heading and the Results content (w390/04, 06, 07; extra/w390/07).

   Errors also stay until closed and are drawn over dialogs. The bad-paste error covers the title of the "Confirm Import from Factorio" dialog (w1440/07) and the changelog (w1440/08). The fix:
   - Dock the Undo offer into the workflow bar's second row as an inline "Build imported · Undo" that takes no extra space.
   - Close any error when a dialog opens.
   - Anchor the remaining toasts bottom-left on desktop and above the footer on phones.

5. **Let the reason line offer the way out (2.4 belt question).** The line "Recommended: 3 output swings per cycle. Fewest wake-ups among the Stable clocks at 240/s on a moving belt" is good. But two rows down sits a Stable clock with **0** wake-ups against the pick's 177 (w1440/19), and nothing tells me how to get it. The switch is still "Belts do not move" inside Advanced Overrides (`OverridesForm.tsx:107-128`). Add to the reason line: "Belts backed up and standing still? [Make clocks for standing belts]", which turns the switch on and goes to Validate. At 390 the wake-ups, rate and status columns are scrolled off-screen (w390/07 part 1, extra/w390/02 part 2), so the reason refers to numbers the phone user cannot see.

### 3. All findings

| # | What's confusing or odd | Who it hurts | Severity | Proposed change | Effort | Evidence |
|---|---|---|---|---|---|---|
| 1 | The first screen still never says what the tool does or what you get. There is no intro, no "how it works", no example. | Every first-time visitor, in the first 5 s | blocker | A first-run card above Target Output: one sentence, 3 steps, Import from Factorio / Try an example / Build by hand (2.1). | M | w1440/02, w390/02; `App.tsx:504-512` (Target Output is the first content) |
| 2 | The Sidecar mod is still never named or linked. Paste is still in ⋮. Without the mod the error says only "Clipboard does not contain valid JSON. Make sure to copy from the Factorio mod." | Every newcomer without the mod | blocker | Promote "Paste from Factorio" to the app bar. On failure, open a dialog naming "Clock Generator Sidecar" with a mod-portal link and its 3 steps (2.2). | M | w1440/05, 06; `ConfigImportExport.tsx:137, 369-374` |
| 3 | On first visit the site greets you with a red "2 problems" chip and red text before you've done anything. Both "problems" are the blank default form. | Newcomers, at second 1 | major | When the form is the untouched default, show a neutral "Start: pick the recipe you want to make" (not a red count). Turn red once the player has edited something. | S | w1440/02, w390/02; `firstProblem.ts:72-92`; `WorkflowBar.tsx:187-201` |
| 4 | On fresh Results the filled button is GENERATE (re-run); COPY BLUEPRINT is an outline. The visual hierarchy points away from the goal. | Everyone who reaches Results | major | Copy `contained` primary when results are current; Generate `outlined` unless the build changed. | S | w1440/19, 24, 26; `WorkflowBar.tsx:164-166, 228-233` |
| 5 | Next-step copy points at a disabled button: the stale banner says "Generate again" and the empty Results state says "Press Generate", while Generate is disabled until Validate passes or the problems are fixed. | Anyone editing after a run; anyone with a broken build | major | Build these sentences from `blocked.generate` ("Validate, then Generate again"; "Fix the 2 problems on Configure first [Go]"). | S | w1440/28, 32, extra/w390/07; `resultsStaleness.ts:8,10,47`; `ResultsWorkspace.tsx:134`; `StaleCopyDialog.tsx:33` |
| 6 | The Undo message has no timer and floats over content for the rest of the session, through Validate and Generate. At 390 it covers headings and the top of Results. | Phone users; anyone who imports | major | Dock it inline in the workflow bar's second row, or collapse it to a small "Undo" chip after 8 s. | S | w1440/09, w390/04, 06, 07, extra/w390/07; `undoSnapshot.ts:7-9`; `Messages.tsx:44, 99` |
| 7 | Error toasts stay until closed and are drawn over dialogs: the bad-paste error covers the "Confirm Import from Factorio" title and the changelog. | Anyone who retries a paste | major | Dismiss a non-actionable error when a dialog opens or the next action succeeds. | S | w1440/07, 08; `messages.ts` (`error: null`); `Messages.tsx:44` |
| 8 | Results still opens on Timelines, the blueprint is the third tab, and the only install help is "Copy this string and paste it in Factorio (Ctrl+V while in blueprint library)". Nothing about wiring combinators to inserters or Factorio 2.1. | Everyone who reaches "done" | major | The 2.5 answer card: pick, reason, Copy, numbered install steps; tabs below as Details. | M | w1440/19 part 2, 22 part 2; `ResultsWorkspace.tsx:102, 168-172`; `BlueprintOutput.tsx:119-121` |
| 9 | The reason line says "on a moving belt" but gives no route to the 0-wake-up clock for standing belts two rows down. The switch is buried in Advanced Overrides. | Players with backed-up belts (most science builds) | major | Add "[Make clocks for standing belts]" to the reason line; ask the belt question in Belts (2.4). | S | w1440/19, 28; `recommendedClock.ts:53, 154-155`; `OverridesForm.tsx:107-128` |
| 10 | At 390 the clock table shows only Clock and Belt. Wake-ups, Rate and Status are scrolled off with no scroll cue, so "Fewest wake-ups" can't be checked. | Phone visitors | major | Below 600px render clocks as cards (label, wake-ups, rate, status, Recommended), or pin Wake-ups and Status next to Clock. | M | w390/07 part 1, extra/w390/02 part 2; `ClockAlternativesPanel.tsx:252-331` |
| 11 | Validate and Generate are still two required steps; any edit greys out Generate until you validate again. | Everyone iterating | major | Fold Validate into Generate (2.3). | M | w1440/27, 28; `WorkflowBar.tsx:233` |
| 12 | While generating, Results is an empty page holding only "Debug Output". Progress is a thin bar in the header reading "Batched swings / Checking clock-only output, clock start 1/12". | Newcomers on a slow build ("did it hang?") | major | Show a progress card in the Results body ("Making clocks… 1 of 5 done"), in player words, and hide Debug Output. | S | w1440/35; `BlueprintOutput.tsx:127-148`; `ResultsWorkspace.tsx:239-255` |
| 13 | The Paste confirm dialog says "Select which **items** you want to import. Existing items of each selected type will be replaced." In Factorio "items" means iron plates. The old-mod warning still contradicts itself: "Nothing in this import is affected by that. Update the mod to 0.7.0 to import everything automatically." | Mod users on their first paste | minor | "Choose what to bring in. Each kind you tick replaces what you have." Warning: "Exported with an older Sidecar. This import is complete; update to 0.7.0 when convenient." | S | w1440/07; `ConfigImportExport.tsx:415`; `clock-generator/src/config/sidecar-version.ts:94` |
| 14 | Paste never sets Target Output, so even a mod user faces an empty "Recipe *" and a red problem. | Mod users | minor | Prefill target recipe and rate (machine max × copies) in the confirm dialog. | S | w1440/07; `ConfigImportExport.tsx:228-274` |
| 15 | The Validation panel copy is still jargon: "works out the swing plan: how many swings each inserter makes per crafting cycle, and how many cycles the clock needs for them to come out whole. Nothing is recalculated while you edit." | Newcomers reading the only explanation of the step | minor | "Checks your build can be clocked: a target, machines fast enough for it, and an inserter for every ingredient and output." | S | w1440/03 part 2; `ValidationPanel.tsx:53-55` |
| 16 | Stale copy: the Timelines note says "This is the run the Status and **Clock-only output columns** are judged on". That column is now "Output per clock period (1 copy)". | Anyone matching the note to the table | minor | "…the run the Status and Output per clock period columns are judged on." | S | w1440/19 part 2; `ResultsWorkspace.tsx:200-201`; `numberText.ts:80` |
| 17 | Items per Second accepts 240200 (21836/s each against "max 22.97/s") with no warning in the field. | Hand builders who mistype | minor | Under the field, in warning colour: "Machine 1 makes at most 22.97/s; 11 copies make 252.7/s." | S | w1440/27; `TargetOutputForm.tsx:72-83` |
| 18 | The recommended row sits third of five. The eye hunts for the orange chip. | Everyone scanning Results | minor | Sort the recommended row first in the Stable group (keep the selected row's place when the player picks another). | S | w1440/19; `recommendedClock.ts:222-245` |
| 19 | Clock names are still engine internals ("Batched swings, non-moving belt: 4 output swings per cycle"). The bar shows "3 output swings per cycle" with no "Selected:" label. | Everyone | minor | Name clocks by trade-off and prefix the bar text with "Selected:" (2.5 engine text). | M | w1440/19; `WorkflowBar.tsx:157-161` |
| 20 | The crafting-speed help still offers `/c game.print(...)` with no warning that `/c` disables achievements, and no pointer to the mod. | Players without the mod; achievement hunters | minor | Add "Easiest: the Sidecar mod reads this for you [link]" and "A /c command disables achievements on this save." | S | `MachinesForm.tsx:38, 88-100` |
| 21 | The "Search deeper" offer adds a checkbox and a clumsy caption: "With Search deeper, also turns on 'Search for fewer wake-ups' in Advanced Overrides." | Newcomers deciding whether to click | nit | Drop the checkbox; after the run, offer "Always search deeper for this build" as a link. Or caption: "Also turns on 'Search for fewer wake-ups' for later runs." | S | w1440/19 part 1, extra/w390/02 part 2; `DeeperSearchNotice.tsx:90-107` |
| 22 | The Configure order still has Inserters before Belts, and empty Chests and Mining Drills cards at full size ("Mining drills are disabled. Enable them if your setup includes ore mining."). | Hand builders | nit | Order Target → Machines → Belts & chests → Inserters; collapse the empty kinds into one "+ Add chest / drill" row. | M | w1440/03, 10 part 2; `App.tsx:536-610` |
| 23 | Internal ids instead of game names ("logistic-science-pack", "nutrients-from-yumako-mash"). | Everyone | nit | Localized names (2.8). | M | w1440/09, 34 part 2 |
| 24 | Just after copying, the bar shows "✓ COPIED" next to "Changed since validation" for 2 s (w1440/27), which is reassurance at the wrong moment. | Fast editors | nit | Reset `copied` as soon as the build changes. | S | w1440/27; `WorkflowBar.tsx:131, 171` |

### 4. What I'd cut or hide
- **"Debug Output" on the empty Results page and during generation** (w1440/32, 35), and the **Log** tab (w1440/23). Move them behind a "Developer tools" item in ⋮ or behind `?debug`.
- **The "Exported clock / Plan" toggle** on the default Timelines tab. The default view only needs Exported clock.
- **The "Always search deeper for this build" checkbox and its caption** in the offer. One button is enough.
- **Import Config / Export Config as the most prominent app-bar buttons at ≥900px.** Move them into ⋮ as build-file actions, with Paste from Factorio in their place.
- **The "Validate" button as a separate required step** (2.3).
- **Empty Chests and Mining Drills cards.** Replace them with one "+ Add" row.

### 5. What already works
- **The stale-result guard.** Import clears the old clocks and lands on Configure (w1440/32). An edit turns Copy into "COPY OLD CLOCK…" with a banner and a confirm that names what the clock was for. The Blueprint tab hides the string (w1440/28, 29; `BlueprintOutput.tsx:67-90`). A player can no longer paste the wrong clock without being told.
- **Problems that name themselves and take you there.** "2 problems" is clickable, and the reason sits under the buttons: "Machine 1 has no inserter bringing in iron-plate". The tooltip on the disabled Generate says the same (w1440/30, 31; `firstProblem.ts:8-20`).
- **The recommendation.** The "Recommended" chip stays on its row, the reason is one plain line, "Back to recommended" appears when you wander, "How clocks are chosen" is collapsed, and unstable clocks sit under their own divider (w1440/19, 25; `recommendedClock.ts:25-85`).

### 6. Phase 1 findings

| Finding | Item | Status | Evidence | What's left |
|---|---|---|---|---|
| A5 | 1.1 | fixed | w1440/28, 29, 32; `resultsStaleness.ts`; `BlueprintOutput.tsx:67-90`; `App.tsx:386-389` | The banner and dialog say "Generate again" while Generate is disabled until Validate (finding 5). "✓ COPIED" lingers 2 s after an edit (finding 24). |
| B1, C5 | 1.1 | fixed | as above; StaleCopyDialog focuses Cancel (`StaleCopyDialog.tsx:37`) | Same copy issue |
| A7 | 1.2 | fixed | w390/02, 04, 07; w720/06; w960/07; INDEX checks: no sideways scroll at 960/720/390 | Header is fine. Table columns are cut at 390 (finding 10, Phase 3 C14) |
| B25, C1 | 1.2 | fixed | same; `useStickyHeaderHeight`; `ConfigImportExport.tsx:66, 375-390` | — |
| A18 | 1.3 | fixed | w1440/05 (divider, red Reset); w1440/09 "Build imported. UNDO"; `ConfigImportExport.tsx:311-316`; `useUndo.ts` | The Undo message has no timer and covers content, at 390 especially (finding 6). That is a new problem the fix introduced. |
| B2, C15 | 1.3 | fixed | w1440/05; `ConfigImportExport.tsx:391-398` | — |
| B3 | 1.3 | partly fixed | `App.tsx:312-337` | Undo covers deletes, Import, Paste, Reset and drills-off. There is still no general undo of field edits. That is per the item's scope, but B3 asked for more. |
| A6 | 1.4 | partly fixed | w1440/02, 04, 30, 31; extra/w390/06; `firstProblem.ts`; `WorkflowBar.tsx:187-201, 243-277`; `App.tsx:386-389` (import goes to Configure) | Tooltips, the chip and the jump are done. Left: the empty Results text "Press Generate" with problems present (w1440/32); the stale banner's "Generate again" (w1440/28); the red count on the untouched default (finding 3). |
| B21, C10 | 1.4 | fixed (same caveats) | same | Same as A6 |
| A14 | 1.5 | fixed | w1440/06 (the toast shows in full, top-centre, not under the footer); `Messages.tsx` portal | Toasts now cover dialog titles and form fields instead (findings 6, 7) |
| A29 | 1.5 | fixed | w1440/03 part 2, 19 part 3: Ko-fi is an outlined button in a non-sticky footer | — |
| B30, C3 | 1.5 | partly fixed | footer fixed. On Results, Generate is still the one filled button and Copy is outlined (w1440/19) | "One filled next-step button per state" is not met on Results (finding 4) |
| C6 | 1.5 | fixed | `Messages.tsx:94-104` (portal, below the header) | — |
| A9 | 1.6 | fixed (Phase 1 part) | w1440/19, 25, 28; `ClockAlternativesPanel.tsx:145-151, 191-211` | The chip and reason are done, and the chip stays put. The reason names "on a moving belt" but offers no route to the 0-wake-up standing-belt clock (finding 9, 2.4). Recommended row isn't sorted first (finding 18). |
| A11 | 1.6 | fixed | w1440/19: one-line intro, then "How clocks are chosen" collapsed | — |
| B12, B14, C7 | 1.6 | fixed | w1440/25 ("Unstable clocks" divider); `recommendedClock.ts:222-245` | — |
| A22 | 1.7 | fixed | w1440/19 part 1: "We stopped once we found a working clock. A deeper, slower search might find one with fewer wake-ups. [SEARCH DEEPER]" | Checkbox and caption add noise (finding 21) |
| B15, C27 | 1.7 | fixed | same; `App.tsx:410-426` | — |
| B5, B6, B16 | 1.8 | fixed (from code) | `edits.ts:448-499` (only a forced ALWAYS is removed); `ConfigFlowDiagram.tsx:252` `deleteKeyCode={null}`; `DiscardChangesDialog` used in `EnableControlModal.tsx:442` and `EntityEditDialog.tsx` | Not captured on screen |
| B4 | 1.9 | fixed (as far as the shots go) | Row chips read "Inserter 1/2/3" and "Machine 1", the same labels the timelines and Insights use (w1440/10, 19, 21) | Renumber after a delete was not captured |
| A16 | 1.10 | partly fixed | w1440/09, 18: "Total for all 11 copies (21.82/s each)"; the Copies helper; "max 22.97/s" chip | No live check of the target against machine max (240200 passes silently, finding 17). The target recipe is still not prefilled from the machine. |
| A26 | 1.10 | fixed | w1440/18 "68.906"; "max 22.97/s"; w1440/12 "5.2t craft · insertion limit ×15"; `numberText.ts` | — |
| B13, C26 | 1.10 | fixed | w1440/19 headers "Wake-ups/min (1 copy)", "Rate (items/s, all 11 copies)", "Output per clock period (1 copy)" | — |
| B27 | 1.10 | partly fixed | w1440/27 still shows "240200" with no warning | No warning when the rate exceeds what the machines can make |
| C8, C9, C13, C22 | 1.11 | fixed | a11y-names/INDEX.md 482 PASS / 1 FAIL (one h1, no skipped levels, header tooltips are descriptions, Status chips take Tab); `Messages.tsx` `role="status"` region; `InfoPopoverButton` for the (i) | — |
| C10, C25 | 1.11 | partly fixed / can't tell | a11y/INDEX.md: 256 PASS / 10 FAIL | 4 focus stops (the "Stable" Status chips) show no focus ring at every width; one number input fails target-size at 390. I can't map C25 exactly from my own report. |
| A25 | 1.12 | partly fixed | "devided" gone (`OverridesForm.tsx:155`), "Assembling machine" in both views, "Re-run the simulation" gone, "Enable rule" modal with Auto / Always on / Never on… (w1440/11) | Left: "Transfer Activity Timeline" (glossary row 1 retires "transfer"); "Clock-only output columns" points at a renamed column (finding 16); "items" for entities in the Paste dialog (finding 13); Validation panel jargon (finding 15). "Stable/Unstable" and the engine clock names are deferred to 2.5. |
| B32, C30 | 1.12 | partly fixed | same | same |
| A23 | 1.13 | fixed (differently) | w1440/10, 18: an "Enable: Auto" chip on each row instead of a bare gear; the modal says "Auto: The generator decides when it is on (default)" | The chip shows on every row, not only non-Auto ones. That is acceptable now that it says Auto and default. |
| B7, C24 | 1.13 | fixed | same | — |
| C4 | 1.14 | fixed | w1440/27, 28: "Changed since validation" and "COPY OLD CLOCK…" are lemon yellow, distinct from the orange buttons; `App.tsx:75-79` | — |

### 7. Open questions for the author
1. The brief says 0.9.1, but `clock-generator-ui/package.json` and the footer chip say v0.9.0. The in-app changelog ("v0.9.0 current", w1440/08) lists none of Phase 1 (Undo, Recommended, Search deeper, problem chip). Will returning players be told what changed when this ships?
2. Should an untouched default form count as having "problems" at all, or should the red count start only after the player edits or presses something?
3. Is the Undo message's lack of a timer (owner decision, `undoSnapshot.ts:7`) meant to hold on phones too, where it covers content for the rest of the session?
4. On fresh Results, is Generate meant to stay the filled button (for re-runs while tuning), or can Copy take that role?
5. Will 2.4's belt question be asked every time, or remembered per player? It decides whether the reason line needs a "standing belts" link at all.
6. Is a phone-width clock table in scope before Phase 3, given that the recommendation's reason refers to columns a phone can't see?