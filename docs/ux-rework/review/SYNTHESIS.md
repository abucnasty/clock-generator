# Clock Generator UI (0.9.0): UX review synthesis

Three designers reviewed the site independently, from screenshots of the live site (1440px and 390px wide) and from the
source:

- **A, newcomer advocate:** onboarding and information architecture.
- **B, power-user interaction designer:** editing at scale and workflow.
- **C, visual, data-viz and accessibility designer.**

None saw the others' reports. `A5` means finding 5 in `A-newcomer.md`, and likewise for B and C.
"✔ checked" means I confirmed the claim against a screenshot or the code.

## Verdict

The engine is serious, but the UI around it is hard to use. All three designers independently reached the same three
conclusions:

- **The site can hand you the wrong blueprint.** After an import or an edit it still offers the previous build's
  blueprint.
- **A newcomer is never told what the tool does or what to do first.**
- **The results screen reads like a manual.** It doesn't say "here is your clock and why".

On a phone-width window the site is unusable: you can't get back to Configure.

## Consensus: all three flagged it

| # | Problem | Severity | Fix | Refs | |
|---|---|---|---|---|---|
| 1 | **A stale blueprint can be copied.** Importing another build, or editing after Generate, leaves the old clocks, the old transfer plan and a live "Copy blueprint" on screen. The only cue is a small "Changed since validation" chip. | blocker | Store the config hash with each generation. If the config has changed: disable Copy (or make it "Copy old clock…" with a confirm), show a banner across Results, and clear results on Import, Paste and Reset. | A5 B1 C5 | ✔ checked: shots 27, 34; `useSimulationWorker.ts` clears results only in `runSimulation` |
| 2 | **At 390px the app bar wraps to 3 lines and covers the sticky Configure/Results toggle**, so you can't return to Configure. The cause is the hard-coded `top: 56` in `WorkflowBar.tsx:75`. | blocker (narrow) | Below 600px, move Import and Export into ⋮ and shorten the title. Put the workflow bar inside the AppBar (or measure its height) instead of pinning it at a guessed height. | A7 B25 C1 | ✔ checked: shots 30, 39; the capture script could not click it either |
| 3 | **"Reset Configuration" wipes the build and localStorage instantly**, with no confirm and no undo. It sits directly under "Paste from Factorio". | major/blocker | A divider, red text, then a confirm that names what is lost, or an Undo snackbar. | A18 B2 C15 | ✔ checked: `usePersistedConfigForm.ts:197-200` |
| 4 | **Nothing says which clock was recommended or why.** The tool picks a 177-wake-up clock over a Stable 0-wake-up one. The reason (it prefers a moving belt) is buried mid-paragraph in a 110–140-word intro. Showing the unstable clocks puts them in the middle of the table. | major | Add a "Recommended" chip, with its reason, on the auto-pick, and keep it when the user picks another row. Cut the intro to one line plus a "How clocks are chosen" disclosure. Group unstable rows at the bottom. | A9 A11 B12 B14 C7 | ✔ checked: shots 20, 25 |
| 5 | **The disabled buttons point at each other.** The disabled Generate's tooltip says "Validate the configuration first" while Validate is also disabled, with no reason. On a broken build seen from Results, nothing says what's wrong. | blocker/major | The tooltip names the first missing thing ("Machine 1 has no inserter taking X out"), and clicking it jumps there. Add an "N problems" chip in the workflow bar on both views. | A6 B21 C10 | ✔ checked: shots 04, 33 |
| 6 | **Toasts render under the sticky footer.** The bad-paste error and "imported successfully" are cut in half. | major | Render snackbars at the app root, above the footer. Stop the footer sticking. | A14 B30 C6 | ✔ checked: shots 06, 09 |
| 7 | **The "Not searched: Observed windows, Uneven output swings…" notice** reads like a failure, and sends you on a 5-step round trip to a switch in Advanced Overrides. | major | One line plus a **[Search deeper]** button that generates with the flag on. | A22 B15 C27 | ✔ checked: shot 20 |
| 8 | **The sticky Ko-fi button is the loudest control on the page.** It is the only filled, saturated button on first visit; Generate is grey. | major (hierarchy) | Ko-fi becomes a text link in a non-sticky footer. One filled "next step" button per state, and on Results that is Copy blueprint. | A29 B30 C3 | ✔ checked: shot 02 |
| 9 | **Enable-control state is invisible in the List.** Every inserter row has a bare gear; you can't see which rows are CLOCKED, ALWAYS or CONDITIONAL without opening each one. | major/minor | Replace the gear with a chip naming the mode ("Enable: Auto"), and hide it until the mode isn't AUTO. | A23 B7 C24 | ✔ checked: shot 10 |
| 10 | **Numbers are noisy and units are ambiguous.** "68.906247615814"; an unlabeled "22.9687/s" chip; "Items per Second" never says total vs per copy; the table mixes totals and per-copy values. | minor/major | Show 2–3 decimals, with the full value on focus. Label the chip "max 22.97/s". Put units in the headers ("Wake-ups/min (1 copy)", "Rate (all 11 copies)"). | A16 A26 B13 B27 C26 | ✔ checked: shots 10, 20 |
| 11 | **Debug surfaces sit on the main path.** The Log tab, Debug Output and logging switches are peers of the real results. | minor | Move them behind a "Developer tools" item in ⋮ or behind `?debug`. | A §4, B §4, C §4 | |
| 12 | **The words drift.** "Machine" in the List vs "Assembler" in the diagram; hands, swings and transfers for one thing; "devided"; DebugPanel mentions a non-existent "Generate Blueprint" button; "Re-run the simulation" for Validate. | nit | A glossary with one term per idea, plus a copy pass. | A25 B32 C30 | |

## Two of three flagged it

- **Fold Validate into Generate** (A12, B10). Generate validates first and stops on Configure with the error. Keep
  "Check only" as a secondary action. Today any edit, even toggling a generation-only switch, disables Generate. C keeps
  Validate as a step but wants one filled button per state; see Disagreements.
- **Hover-only help is unreachable by keyboard or touch** (A20, C9, C10). The (i) next to each clock is a bare SVG ✔
  (`ClockAlternativesPanel.tsx:164-169`). Make it a focusable button that opens a popover on click.
- **The "Belts do not move" switch decides the pick but is hidden in Advanced Overrides** (A10; B open question 1). Ask
  it as a visible question in Belts ("Your input belts are: moving / backed up").
- **Empty Chests and Mining Drills cards take full-size slots** (A28, C23). Collapse each to a one-line "+ Add" row.
- **The diagram reads backwards and differs from the List** (B16, B17, C20). There are no arrowheads, and inputs are laid
  out to the right of the machine. Belt lane (`near_lane`) can only be set in the diagram. Stack-size fallbacks differ
  (16 vs 1).

## Serious findings from one reviewer (checked)

- **B4: row "#2" is not "Inserter 2".** The row chip shows the position (`displayId={index + 1}`), but Insights, the
  timelines, the diagram and Fuel use the stored id. Ids are retired on delete, so after one delete they diverge.
  Dragging renumbers every id (`reorderWithIdReassignment`), so last run's "Inserter 5" becomes another inserter. ✔
  checked. B rates it a blocker for debugging any build of 10 or more inserters.
- **B5: "Exclude from LCM" overwrites a hand-built rule.** Excluding an ingredient forces the inserter to ALWAYS over any
  CONDITIONAL or CLOCKED rule; re-including deletes the override, even an ALWAYS set on purpose. ✔ checked
  (`edits.ts:449-488`).
- **B16: in the diagram, Backspace on a selected edge deletes the whole inserter.** React Flow's default delete key isn't
  overridden, and `handleEdgesDelete` removes the inserter. ✔ checked.
- **B6: the enable-control modal drops all rule edits on Esc or a backdrop click.** ✔ checked: Dialog `onClose`.
- **B3: no undo anywhere.** Import replaces everything without asking.
- **B18: generation can't be cancelled.** Copy blueprint appears before the searches finish.
- **A2: the Sidecar mod is never named or linked in the UI.** Paste from Factorio is buried in ⋮. Without the mod the
  error says only "Make sure to copy from the Factorio mod."
- **A4: the repo ships sample configs for 9 science packs, and the site exposes none of them.** A "Try an example" would
  turn a cold start into a demo.
- **A8: nothing explains how to install the result.** The blueprint is combinators that must be wired to the inserters
  named in their descriptions, and it needs Factorio 2.1. The only instruction is "(Ctrl+V while in blueprint library)".
- **C4: MUI's default warning orange `#ffa726` is nearly the brand orange `#fca300`.** So "Changed since validation" and
  Copy blueprint's below-target state look like normal controls.
- **C2, C11, C12: the charts are mouse-only and their colors collide.** The state timeline is an unlabeled `<canvas>`.
  Item colors reuse the state palette (transport-belt gets "Waiting" yellow). Disabled is about 1.5:1 on its track.
  Blocked spans are 1–3px wide.
- **C8, C22: about 20 controls have no accessible name, and there is no h1.** The controls include the delete buttons,
  drag handles, type selects and the clock radios; every section title is an h6.

## Where the designers disagree

| Topic | View 1 | View 2 | Suggested resolution |
|---|---|---|---|
| **Validate as a step** | A, B: fold it into Generate; it is friction with no payoff for the user. | C: keep the stages, but make only the next step's button loud. | Fold it in. Keep "Check only" and the transfer-plan tools in an expert area. Both concerns are met. |
| **Clock table: simpler or richer?** | A: hide Clock period, Inserter windows and Clock-only output behind "Show details". | B: richer, with sortable columns, a "Not picked because" column and units per header. C: fold constant columns, add data bars. | A summary card of the pick on top, then a compact table, then an expandable full table. Experts lose nothing. |
| **What Results opens on** | A: the Blueprint tab, with install steps. | C: a summary card plus Copy. B: keep the timelines handy for debugging. | A summary card (pick, reason, Copy, install steps), with the tabs below as "Details". |
| **The "Exported clock / Plan" toggle** | B: the best debugging primitive on the site (§5). | A, C: remove it from the default view and move it into Insights or a checkbox. | Keep it, but default to Exported clock and render the toggle as secondary. It matters to B's persona, not A's. |
| **The Diagram** | B: demote it to a read-mostly map until it matches the List. | C: fix it (arrows, left-to-right layout, ≥12px text). | Decide whether the diagram is meant to replace the List (B's open question 8) before investing in either. |

## Ranked change list

### Quick wins (small effort, large payoff), in this order

1. **Stale results guard** (#1): hash check, disable/confirm Copy, a banner, clear on import/reset.
2. **Narrow header fix** (#2).
3. **Reset confirm or Undo** (#3), plus a divider and red text.
4. **"Recommended" chip and its reason; intro cut to one line; unstable rows grouped** (#4).
5. **Disabled buttons that name the problem; "N problems" chip** (#5).
6. **Snackbars above the footer; non-sticky footer; Ko-fi demoted; one filled next-step button** (#6, #8).
7. **"Search deeper" button in the Not-searched notice** (#7).
8. **Warning palette separate from brand orange** (C4).
9. **Stop "Exclude from LCM" overwriting non-AUTO rules** (B5); **`deleteKeyCode={null}` on the diagram** (B16);
   **confirm before discarding modal edits** (B6).
10. **Accessibility basics:** name the ~20 unlabeled controls, `describeChild` on the tooltips, a focusable (i), a
    heading outline, one `role="status"` live region (C8, C9, C13, C22).
11. **Number formatting and units in headers; a mode chip instead of the gear; a copy and glossary pass** (#9, #10, #12).

### Structural changes (medium or large effort)

1. **A first-run experience** (A1, A2, A4). It needs:
   - an intro line
   - "Paste from Factorio" promoted, with a link to the Sidecar mod and its 3 steps
   - "Try an example" from the shipped samples
   - a paste textarea as a fallback.
2. **Results restructure** (A8, A19, C §2.3). Lead with the selected clock, why it was picked, Copy, and numbered
   install and wiring steps. Put the table, timelines, Insights and the rest under "Details".
3. **Fold Validate into Generate** (A12, B10).
4. **Stable entity identity** (B4): show the stored id, stop renumbering on drag, optional names, one label format.
5. **Undo/redo and snapshots** (B3). Also keep the last results and the chosen clock per config hash, so a reload
   doesn't force Validate → Generate again (B11).
6. **Timeline overhaul** (B24, C2, C11, C12, C17). Merge the state and transfer rows, give items their own palette, add a
   legend, fix contrast, add gridlines and a tick axis, zoom, a table view and keyboard stepping.
7. **Narrow layout beyond the header** (C14): clocks as cards; a narrower timeline label column.
8. **Editing at scale** (B9, B17, B22): one inserter editor shared by the List and the Diagram, duplicate and bulk edit,
   and a readable preview and inline validation in the rule editor.
9. **A build library and share links** (B20). There is one localStorage slot today, and two tabs overwrite each other.

## Caveats on the evidence

- The progress state while generating was never captured, because the sample builds generate in under 2.5s. Its
  findings (B18, C13) come from the code only.
- The "240200" in shot 27 came from the capture script typing into the field. It may be an artifact of the script rather
  than what a player sees, so B27's "no select-on-focus" point is unconfirmed. That no warning appeared at 240200
  items/s still stands.
- C6 and A14 suspect, from the code, that the "Copied. {rateWarning}" snackbar lands under the app bar. That is
  unverified.
- No shots were taken at 720–960px, the likely width of a browser docked beside the game. That is worth checking next
  (C, open questions).

## Open questions for the author (merged)

1. **Audience.** Is the site for players who already wire their own clocks, or for anyone who wants a blueprint for
   their build? A's whole review assumes the latter.
2. **Should the default pick prefer moving-belt clocks?** The samples README says a moving-belt clock "has never been
   recorded" in game, yet the tool prefers one over a 0-wake-up non-moving clock. Should this be a question asked every
   time, or a per-user default?
3. **Is the Sidecar mod the intended way in?** If so, it should be a primary button with a mod-portal link. Could the
   mod's export include the target output?
4. **Does id or row order mean anything to the engine or the sidecar?** If not, ids can become permanent and drag
   reorder can go.
5. **Should the Diagram reach parity with the List and replace it, or stay a viewer?**
6. **Do CONDITIONAL and CLOCKED rules reach the blueprint, or only shape the planning simulation?** The modal should say
   which.
7. **Is "Items per Second" the total over all copies?** Does "Copies" change the blueprint?
8. **Are narrow widths (phones, a half-width window beside the game) in scope?**
9. **Who are the timelines for: players, or you checking the simulator?** If for you, the Detailed mode, Plan, the
   Factorio strip and Log belong behind a developer toggle.
