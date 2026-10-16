# UX rework: handoff plan

This is the plan for reworking the clock generator site's UX, written for the agent that implements it. It lives on
`feat/ux-rework` with the review it comes from, and **all of `docs/ux-rework/` is deleted in the last commit before
`feat/ux-rework` is merged to `master`**.

## Context

Three designer agents independently reviewed the site (0.9.0) from screenshots and the source. Their findings were
merged, and the owner then decided how to resolve every open question (the table below).

- **Published review** (private, the owner can share it): <https://claude.ai/artifact/BAkTrmCuRWuhSKAG2Nvzma>. It
  has the merged findings, the three full reviews and all 40 captured screenshots.
- **In this folder:** `review/SYNTHESIS.md` (merged findings, ranked), `review/A-newcomer.md`, `review/B-power-user.md`
  and `review/C-visual-a11y.md` (full reviews), `review/BRIEF.md` (the brief the reviewers worked from), and
  `capture/` (the screenshot scripts; see its README).

**How the work is run:** `ORCHESTRATOR.md` sets out the loop (spec, implement, evidence gate, code review, UX audit,
fix cap, merge), which model each role uses, and the checkpoints with the owner. `PROGRESS.md` is the ledger.

Finding references such as **A5**, **B4** and **C8** are finding numbers in those reviews. Read the finding before
changing the code it points at: each one names the screenshot and `file:line` it is about.

The worst problems today:

- **The site can hand out a blueprint for the wrong build.** After an import or an edit it still offers the previous
  build's blueprint.
- **A newcomer is never told what the tool does.**
- **Results read like a manual.**
- **At 390px wide you cannot get back to Configure.**

## Decisions the owner made

| Topic | Decision |
|---|---|
| Audience | Both newcomers and experienced players, **newcomer-first**. The default path is simple and plain; expert detail is one click away under "Details" and "Advanced". |
| Scope | A **phased roadmap**: Phase 1 stops the harm, Phase 2 builds the newcomer-first structure, Phase 3 adds expert depth. |
| Validate | **Fold it into Generate.** Generate checks first and stops on Configure at the first problem. A secondary "Check only" action stays, and the transfer plan and "Exclude from LCM" move to an expert area. |
| First visit | **Push "Paste from Factorio" hardest**, with a link to the Sidecar mod and its steps. "Try an example" and "Build by hand" are secondary. |
| Belt assumption | **Ask it visibly in the Belts section and keep "moving" as the default.** Results says which assumption the pick used and offers to switch. |
| Diagram | **Stays a secondary view.** The List is the main editor; the Diagram opens the same shared editor. Fix its readability and remove the Backspace delete. |
| Widths | **Full support for desktop and half-width (down to 720px).** Below 720px, only guarantee that Configure, Results and the main actions stay reachable. |
| Ko-fi | **Quieter but still visible.** An outlined or text button, in a footer that no longer sticks. |
| Results charts | The current timelines mostly serve the owner. Add a new player-facing **Wake windows** view as the default chart. The timelines, Plan and Detailed mode move behind **Developer tools** and get light fixes only. |
| Entity numbers | **Renumber, but consistently.** Every view shows the same current number (see 1.9). |
| Safety net | **An Undo snackbar** on every destructive action. No full undo/redo history. |
| Install steps | **The agent derives them** from the blueprint code and the in-game harness. The owner reviews them in game before the Phase 2 PR merges into `feat/ux-rework` (the owner, 2026-10-15). |
| Visual direction | **Factorio GUI grammar:** green filled means confirm or commit, orange means selection or accent, title-bar panel headers, inset slots. |
| Accessibility | **Full WCAG 2.2 AA** for player-facing views. The developer timelines get light fixes only. |
| Phase 3 scope | All four: rule editor upgrades, editing at scale, cancel and keep results, build library and share links. |
| Sidecar mod | **In scope:** export a suggested target, point to the site from the copy popup, easier copy, and a mod portal description that names the site. |
| Item names | **In-game names in the UI**, with the internal id on hover and in the JSON views. Search matches both. |
| Verification | Vitest tests for logic, plus **a fresh three-designer UX review at the end of each phase**. |
| Delivery | Branch per phase into a final feature branch (see the ground rules). |

## Ground rules

### Branches and merges

```
master
 └─ feat/ux-rework                   final feature branch (this plan lives here)
     ├─ feat/ux-rework-p1            phase branch, from feat/ux-rework
     │   ├─ feat/ux-rework-p1-<topic>  one child branch and PR per item below
     │   └─ ...
     ├─ feat/ux-rework-p2
     └─ feat/ux-rework-p3
```

- **Child PRs:** small, one item per PR where practical (items that share files may be bundled; see
  `ORCHESTRATOR.md`), targeting the phase branch. **The agent may merge a child PR**
  once CI passes.
- **Phase branches:** start each one from `feat/ux-rework` after the previous phase has merged. Exception (the owner,
  2026-10-14): while the previous phase's tail leaves slots idle, the next phase's branch may be cut from the previous
  phase branch's head and its unblocked items run in those slots (the four-unit cap counts both phases). It merges the
  previous phase branch in after each of its merges, then `feat/ux-rework` once that phase lands. When the phase is done,
  its UX review has run (see Verification) and CI passes, **the agent may merge the phase PR into `feat/ux-rework`**.
- **The final PR**, `feat/ux-rework` → `master`, is opened by the agent and **merged only by the owner**.
- CI (`.github/workflows/test.yml`) runs on every pull request: the unit tests, knip, lint, `check:icons` and the build.
  The generation tests run only on PRs to `master`. Run them on a branch with
  `gh workflow run test.yml --ref <branch>`.

### Releases (only in the final PR)

- Bump `clock-generator` and `clock-generator-ui` together from the then-current master version (currently **0.15.2**)
  to the next release, with a `CHANGELOG.md` section listing the changes players will notice. Choose the final number
  in the final PR; taking upstream version changes during integration is not a new phase release.
- Bump `clock-generator-sidecar` from 0.7.1 to **0.8.0**: `info.json`, `changelog.txt`, and `LATEST_SIDECAR_VERSION` in
  `clock-generator/src/config/sidecar-version.ts`. A test fails if those three drift apart.
- Merging to `master` releases the site, and publishes the mod because its folder changed (see the root `README.md`).
- **Do not bump any version in a phase.**

### Practicalities

- **On the owner's machine `npm config get ignore-scripts` is `true`**, so `predev` does not run. Run
  `node scripts/copy-factorio-data.mjs` in `clock-generator-ui` before `npm run dev`. Any new copy step (for example the
  example configs in 2.1) needs the same manual step documented.
- **If you add or change dependencies, regenerate the lockfiles with npm 11.19.0**, the version CI uses. Lockfiles
  written by npm 11.6.2 fail `npm ci` in CI.
- **Match the repo's style.** Commit subjects are plain sentences that say what changes for the player (for example
  "Stop the sidecar crashing on an assembler without a recipe or a lab"). Code reads like the surrounding code.
- **Write copy in plain words** from the player's side, using the glossary terms (1.12) once the owner has approved
  them.

## Upstream compatibility (owner decisions, 2026-10-16)

Master advanced from 0.11.0 to 0.15.1, then 0.15.2 during integration (#193, the near-lane bugfix).
Integrate it into `feat/ux-rework`, then p2, then p3, preserving the UX work.
The integration acceptance criteria are in [specs/upstream-0.15-compatibility.md](specs/upstream-0.15-compatibility.md).

- **Keep this a UX rework.** Preserve imported inserter type and quality and show them read-only; no selectors.
- **Clearing Stack size restores Automatic**, using that type’s fully researched capacity (4, 12 or 16). Preserve
  omitted values and existing explicit overrides; show the effective value and the full-research assumption.
- **Do not extend the sidecar to export type/quality in this rework.** Its existing 2.2 scope and 0.8.0 release plan
  stand. Explain the default timing assumption where the UX needs it; no new sidecar in-game checkpoint for metadata.
- **Repeated identical units:** explain the engine refusal and guide the player to select one unit and set Copies.
  No conversion, automatic reduction, validation bypass or new engine behavior.
- **Fractional Copies:** follow the engine’s positive short-decimal rule throughout fields, target limits, examples,
  saved builds and share links. Values below one are supported. Editable invalid drafts remain recoverable.
- Preserve locale-derived game names when merging the new data pipeline; repair removed example/capture paths,
  refresh results-sensitive evidence, and keep all existing gates and owner phase/install checkpoints.

The compatibility pass precedes final evidence/review for 2.7 B and 3.3. The shared editor in 3.2 A reuses the agreed
metadata and Automatic behavior; 3.2 B preserves both on duplicate/bulk operations. No broader engine or mod work.

## Phase 1: stop the harm, quick wins

Each item is one child PR unless noted. The order matters: 1.1 to 1.3 first.

**1.1 Never offer a stale blueprint** (A5, B1, C5)
- **What:**
  - Record the config key that produced each generation. `App.tsx` already computes
    `configKey = JSON.stringify(exportConfig())`, and `useSimulationWorker.ts` (`runSimulation`) is where it would be
    stored.
  - When the current key differs from the generated one:
    - put a banner across Results: "These clocks are for {recipe} at {rate}/s. Your build has changed since. Generate
      again."
    - change Copy blueprint to "Copy old clock…", which asks for confirmation in an MUI dialog.
  - Import, Paste from Factorio and Reset clear the results and the validation.
- **Done when:** in shots 27, 32, 34 and 35 the old blueprint can no longer be copied without a confirmation. There is
  a vitest test for the staleness check.

**1.2 Keep the header usable at every width** (A7, B25, C1)
- **What:**
  - Below about 900px, move Import and Export into the ⋮ menu and shorten the title so the app bar stays on one line.
  - Stop pinning `WorkflowBar` at `top: 56/64` (`WorkflowBar.tsx:75`). Render it inside the AppBar as a second dense
    Toolbar, or measure the app bar's height.
- **Done when:** at 1440, 960, 720 and 390px the Configure/Results toggle, Generate and Copy are visible and clickable,
  and nothing overlaps.

**1.3 An Undo snackbar for destructive actions** (A18, B2, B3, C15)
- **What:**
  - Snapshot the `ConfigFormData` before each of these actions:
    - Reset
    - Import Config
    - the Paste from Factorio import
    - deleting any row (machine, inserter, belt, chest, drill)
    - deleting from the diagram
  - Then show "{What happened}. Undo" until the next edit to the build, the next undoable action, Close or Escape (no
    timer: the owner, 2026-10-14, for WCAG 2.2.1; this replaces "for 10 seconds"). Ctrl/Cmd+Z undoes while it is offered.
    The offer also ends when a check or a generation starts: running the build accepts it (the owner, 2026-10-14,
    after the Phase 1 end review; built in 1.5 F).
    Undo restores the snapshot, and the existing persistence saves it.
  - In the ⋮ menu, put Reset below a divider, in the error colour.
- **Done when:** there are vitest tests for snapshot and restore.

**1.4 Disabled actions say what is missing** (A6, B21, C10)
- **What:**
  - Compute the first blocking problem from the conditions in `canGenerate` (`App.tsx`) and the coverage issues
    (`useInserterValidation`). Examples: "Set the recipe in Target Output", "Machine 1 has no inserter taking
    logistic-science-pack out".
  - Show it as the disabled button's tooltip and as visible text. Clicking it switches to Configure and focuses that
    field or row.
  - Add an "N problems" chip to the workflow bar on both views.
  - After an import, switch to Configure.

**1.5 Messages above the footer; a quieter Ko-fi** (A14, A29, B30, C3, C6)
- **What:**
  - Render the snackbars at the app root, through a portal, anchored below the workflow bar. Today they sit inside the
    fixed AppBar's stacking context (`ConfigImportExport.tsx`).
  - Check that the "Copied. {rateWarning}" snackbar in `WorkflowBar.tsx` is visible.
  - Make the footer non-sticky, and Ko-fi an outlined or text button.

**1.6 Make the clock pick explainable** (A9, A11, B12, B14, C7)
- **What:**
  - In `useSimulationWorker`, track the auto-picked index separately from the selected one.
  - Give the auto pick a "Recommended" chip with a one-line reason built from the selection rule, for example "Fewest
    wake-ups among the clocks that hold the rate on a moving belt". The chip stays when the player selects another row,
    and a "Back to recommended" link appears.
  - Cut the Potential Clocks intro (`ClockAlternativesPanel.tsx:84-92`) to one line plus a "How clocks are chosen"
    disclosure.
  - Group the unstable rows at the bottom under a divider.

**1.7 "Search deeper" button** (A22, B15, C27)
- **What:** Replace the "Not searched: …" list with one line: "We stopped once we found a working clock. A deeper,
  slower search might find one with fewer wake-ups." Add a **Search deeper** button that generates with
  `search_for_fewer_wake_ups` for this run, and an option to keep it on.

**1.8 Fix the dangerous expert bugs** (B5, B6, B16)
- `utils/configForm/edits.ts` `updateIgnoredIngredients`: never overwrite an `enable_control` that isn't AUTO. Record
  that the ALWAYS was forced, so that including the ingredient again removes only a forced ALWAYS. Add a test in
  `edits.test.ts`.
- `ConfigFlowDiagram.tsx`: set `deleteKeyCode={null}`, so Backspace on an edge no longer deletes the inserter.
- `EnableControlModal.tsx`: no close on a backdrop click. On Esc with unsaved changes, ask "Discard changes to
  {Inserter N}'s rule?". In `InserterConfigPanel.tsx`, use one commit model for the Overrides and Config tabs.

**1.9 One number per entity, everywhere** (B4; the owner chose consistent renumbering)
- **Today:**
  - The row chips and the enable-control modal title use the row position (`displayId={index + 1}`).
  - The pickers, diagram, Insights, Fuel and timelines use the stored id.
  - Reorder reassigns the ids and remaps references (`reorderWithIdReassignment`), but delete retires the id
    (`retireId`), so the two diverge.
- **What:**
  - Make delete renumber the remaining ids of that kind sequentially and remap every reference, the way reorder does,
    so the position always equals the id.
  - The chips show the id, and every view uses the same label format ("Inserter 3").
  - Results generated before a renumber are already covered by 1.1.
- **First:** run `git log -S retireId` to find why ids were retired. If something (the sidecar, a saved config, the
  recorder) relies on retired ids, stop and ask the owner before changing it.
- **Done when:** there are tests for delete and renumber with reference remapping in `edits.test.ts`.

**1.10 Readable numbers and units** (A16, A26, B13, B27, C26)
- **What:**
  - Show 2 or 3 decimals, with the full value on focus (`NumberField` `format`; crafting speed; machine facts).
  - Label the facts chip "max 22.97/s".
  - Put units in the clock table headers: "Wake-ups/min (1 copy)", "Rate (all {n} copies)", "Output per period
    (1 copy)".
  - Add helper text under Items per Second and Copies.
- **Check first:** whether items per second is the total over all copies. See `clock-generator/src/config/schema.ts`
  and A16.

**1.11 Accessibility basics** (C8, C9, C10, C13, C22, C25)
- **What:**
  - Name every unlabelled control listed in C8.
  - Set `describeChild` on the tooltips that replace accessible names (C9).
  - Make the (i) next to a clock a focusable IconButton that opens a popover on click or Enter.
  - Add a heading outline: the title as h1, sections as h2, cards as h3.
  - Add one `role="status"` live region in the workflow bar for check, generate and copy.
  - A visible 2px focus ring, and targets of at least 24px.
- **Done when:** the target is WCAG 2.2 AA for everything this touches.

**1.12 Glossary and copy pass** (A25, B32, C30)
- **Glossary:** propose it in the PR description for the owner to approve. Suggested starting point:
  - **swing:** one inserter movement; replaces hand and transfer.
  - **crafting cycle**
  - **clock period:** how long until the clock repeats; LCM stays in the expert area only.
  - **wake window:** a stretch of ticks during which the clock switches an inserter on.
  - **wake-up:** use the engine’s count, distinct from a wake-window start. Inputs waiting on a machine wake on
    true craft starts; outputs wake on finished crafts and productivity payouts. This corrects stale wording only;
    the owner’s pending strict definition remains separate.
  - **copies**
- **Fixes:**
  - "devided" (`OverridesForm.tsx:151`)
  - "Generate Blueprint" (`DebugPanel.tsx:108`)
  - "Machine" vs "Assembler" (`EntityEditDialog.tsx:154`)
  - "Re-run the simulation" (`TransferPlanPanel.tsx:186`)

**1.13 Show the enable mode on the row** (A23, B7, C24)
- **What:** Replace the bare gear in the inserter and drill rows with a chip naming the mode ("Enable: Auto", "Clocked
  0–7"). It stays quiet while the mode is AUTO and opens the editor when clicked.

**1.14 A warning colour that isn't the brand orange** (C4)
- **What:** Set `palette.warning` well apart from `#fca300`, for example `#ffe14d`, filled, with black text and a ⚠
  icon. Make the "Changed since validation" chip filled. Label a below-target Copy "Copy blueprint (192/s, below
  target)".

**Phase 1 done when:**
- the items above are merged
- the tests pass
- the fresh UX review (see Verification) finds none of the Phase 1 findings still present.

## Phase 2: the newcomer-first structure

**Order:** 2.2 (sidecar) and 2.5 (install steps) go first, so the owner's in-game checks overlap the other items
(orchestrator, 2026-10-14).

**2.1 First visit and the way in** (A1, A2, A4, A15, A17)
- **What:**
  - An intro card above Target Output, dismissible and remembered. It gives one sentence on what the tool does, then
    three steps: get your build in, Generate, copy and wire the blueprint.
  - **Paste from Factorio** is the primary button in the intro card and in the app bar.
  - The card links the Sidecar mod (<https://mods.factorio.com/mod/clock-generator-sidecar>; check the link) and its
    steps: Alt+E, drag over the build, Copy JSON, Ctrl+C, then Paste here.
  - When the clipboard can't be read, or holds no export, open a dialog with those steps and a paste box. Not a toast.
  - Secondary entries:
    - **Try an example.** Load the configs in `clock-generator/resources/config-samples/science/`, copied into
      `public/` by a script like `copy-factorio-data.mjs`, or imported statically.
    - **Build by hand.**
  - Rename Import and Export to "Open build file…" and "Save build file", and move them into ⋮.
  - The confirm dialog for a paste pre-fills Target Output from the export (2.2). Older exports infer it from the
    machines.
  - Reword the old-mod warning (A17).
  - An untouched build shows its next step neutrally, not a red problem count. When the target rate is more than the
    machines can make, a line under the field says so and it is a blocking problem, since the engine refuses such a
    target (the owner, 2026-10-14, after the Phase 1 end review; built as 2.1 W).

**2.2 Sidecar mod changes** (`clock-generator-sidecar/`, version 0.8.0 in the final PR)
- **Export a suggested target.** Add the final product to the export in `scripts/export.lua`: the recipe whose output
  leaves the selection, its max rate, and copies = 1.
  - Teach the engine's sidecar import to accept the optional field (search `clock-generator/src/config/` for the
    sidecar export parsing).
  - Older exports without it must still import.
- **Point to the site.** In the copy popup's locale text (`locale/en/locale.cfg`, `copy-instructions`), name the site
  (clock-generator-self.vercel.app) and say "then click Paste from Factorio there".
- **Easier copy.** When the JSON box opens (`scripts/gui.lua`, the `text-box`), select its text and focus it, so the
  player only presses Ctrl+C. Check whether the Factorio 2.1 mod API can write the clipboard; if it can, add a
  one-click copy.
- **Mod portal description.** In `info.json` and the portal description, name the site and say what the mod is for.
- **Done when:** the owner loads the mod in Factorio 2.1, and the agent lists the steps for them to try in the
  phase PR.

**2.3 Fold Validate into Generate** (A12, B10)
- **What:**
  - Generate runs the check first. If the check fails, it switches to Configure and focuses the first problem. If it
    passes, it generates.
  - Keep **Check only** as a secondary action. It does not switch views or scroll.
  - Edits no longer disable Generate.
  - Move the Transfer Plan and "Exclude from LCM" into the Advanced area, beside the LCM override.

**2.4 Ask the belt question** (A10)
- **What:**
  - In the Belts section, whenever a belt feeds an inserter, ask "Your input belts are: ( ) moving (•) backed up and
    standing still". Default to moving. It maps to `overrides.non_moving_belts`.
  - Remove the switch from Advanced Overrides.
  - The Results summary states the assumption, with a "My belts stand still. Generate again" action.

**2.5 Results lead with the answer** (A8, A19, A20, A21, C §2.3)
- **Top of Results:** a summary card for the recommended clock (or the selected one, if the player picked another)
  with:
  - a plain name by trade-off, with the technical name as a secondary line
  - why it was picked
  - "Makes X/s"
  - wake-ups per minute
  - whether it recovers from a jam
  - **Copy blueprint** as the one filled green button
  - numbered install and wiring steps.
- **Install steps:** derive them from:
  - `clock-generator/src/crafting/blueprint.ts` (each decider names the inserters to wire in its description, and has
    an item-signal output)
  - `blueprint-export.ts` (the book with the "modulo clock" and "full-window" variants)
  - the Lock constant combinator
  - the in-game harness that wires real builds (`clock-generator/src/harness/`, `record-in-factorio.ts`).

  Cover the enable condition the player must set on each inserter, and that Factorio 2.1 is required. **Flag the steps
  for the owner's review in the phase PR.**
- **Below the card, in order:**
  - the Wake windows view (2.6)
  - **Compare other clocks:** a compact table (Clock, Makes, Wake-ups/min, Works?) with "Show all columns" for the
    current full table
  - **Details** tabs: Insights (prose collapsed behind "Why?"), Fuel, and the blueprint string.
- **Terms popover** (added 2026-10-14, the owner's glossary decision): a "Terms" item in ⋮ and an (i) by the Results
  table headers open a popover listing the approved glossary (1.12), fed by a `glossary.ts`.
- **Developer tools** (an item in ⋮, also turned on by `?debug`): the current Timelines, the Plan toggle, Detailed
  mode, and the Log tab with the debug switches.

**2.6 The Wake windows view** (the owner's idea; C2 for accessibility)
- **What:**
  - One row per inserter (and drill), across one clock period, with an axis in ticks and seconds.
  - A bar for each wake window from the selected clock's `clockWindows` (`SerializableClockWindows`, already returned
    by `useSimulationWorker`).
  - Per row: each window's start–end ticks and length, and the wake-ups per minute.
  - A short "what to watch for" note. For example: a window that spans the whole period means the inserter could just
    be always on; "+N ticks" is belt pickup slack; very short windows are sensitive to timing.
  - Engine changes are allowed if the window data is missing anything.
- **Accessibility (full WCAG 2.2 AA):**
  - every row has a text summary
  - rows are focusable, and ←/→ step through the windows
  - a "Show as table" toggle
  - tap shows the details
  - graphics contrast of at least 3:1
  - no meaning carried by colour alone.

**2.7 The Factorio GUI grammar pass** (C3, C16, C23, C24, C28)
- **Colour roles:** green filled = confirm or commit (Generate, Copy blueprint, Import, Save). Orange = selection and
  accent. Grey text = cancel.
- **Shapes:**
  - title-bar style panel headers
  - inset slots for items and filters
  - square chips
  - one help control (a grey "?" that opens a popover on click)
  - one filled next-step button per state.
- **Configure layout:**
  - Target, then one Build card holding Machines, Belts & chests, Inserters and Drills, with the List/Diagram toggle in
    its header.
  - Empty chests and drills collapse to "+ Add" rows.
  - Advanced is collapsed.
- **Contrast:** check every token pair for AA.

**2.8 In-game item names** (A27)
- **What:** The UI shows in-game English names, with the id in a tooltip and in the JSON views. Search matches both.
- **Where names come from:** `data-filtered.json` has no English names, so either:
  - derive them from the id by rule (sentence case, dashes to spaces) plus a map of exceptions, or
  - extract the English locale during the data dump (`clock-generator/resources/filter-raw.js`).

  Pick one and say why in the PR.

**2.9 Half-width layout** (C14)
- **Done when:**
  - every view works at 960, 800 and 720px
  - forms reflow
  - the clock table and charts scroll inside their own containers
  - the page never scrolls sideways
  - below 720px, only the 1.2 guarantee holds.

**2.10 Light fixes to the developer timelines** (C11, C12)
- **What:**
  - Give items a palette separate from the state colours.
  - Add a legend for the Factorio-state strip.
  - Bring Disabled and Blocked to at least 3:1, and make every transition at least 3px wide.
- **Leave alone:** zoom, the merged rows and keyboard stepping.

**2.11 Diagram readability** (B16, B17, C20)
- **What:**
  - Arrowheads on the edges.
  - Lay out left to right: sources, then the machine, then the outputs.
  - Text of at least 12px, and the footnote in the secondary text colour.
  - Fullscreen fits the view; Enter opens a focused node.
  - Make the belt lane (`near_lane`) settable in the List too.

**2.F Phase-end factual copy and fractional scope** (fresh Phase2 A-P2-01/03, B1/11, C2E-6/9)
- Reuse the current provisional wake-up definition in Wake windows and expanded comparison help.
- Show Makes total scope for every Copies value other than1, including partial units.
- Remove the introduction's unconditional net UPS-saving claim. No engine or design change.
- Full item gates, independent code/UX and affected rechecks by all three phase personas remain.

**Phase 2 done when:**
- the items above are merged
- the owner has reviewed the install steps
- the sidecar has been checked in game
- the fresh UX review finds none of the Phase 2 findings still present.

## Phase 3: expert depth

**3.1 Rule editor upgrades** (B8, B9)
- **What:**
  - A live one-line preview of the rule.
  - CLOCKED ranges shown against the clock period, defaulting to the planned window.
  - Inline checks that block Save: the end must not precede the start, and the range must fit in the period.
  - Templates ask for the item and confirm before replacing the current rule; the hard-coded 32 goes.
  - The editor says whether rules reach the blueprint or only shape the planning simulation. Find out which from the
    engine.
  - The "Latched Output Drain" template releases on the source's level, as the owner's sample does (the owner,
    2026-10-14). A Clocked range's end may equal its start (the engine's ranges include both ends).

**3.2 Editing at scale** (B17, B22, B26)
- **What:**
  - One inserter editor component, shared by the List rows and the Diagram dialog, with the same fields, labels and
    fallbacks. Show imported inserter type/quality read-only; clearing Stack size restores Automatic (owner,
    2026-10-16; see Upstream compatibility).
  - Duplicate a row.
  - Multi-select with a bulk-edit bar for stack size, filters and enable mode.
  - New rows scroll into view and get focus.
  - Fewer tab stops per row.
  - The filter picker lists the source's items first.
  - Drag reorder stays, with a message and Undo like a delete, and Move up / Move down for keyboard and single-pointer
    users. Every Diagram dialog is a draft with Save and Cancel (the owner, 2026-10-14, after the Phase 1 end review).

**3.3 Cancel, and keep the results** (B11, B18)
- **What:**
  - A Cancel button beside the progress.
  - Copy is held back until generation ends, or labelled "Copy current best" while it runs.
  - Keep the last generation and the chosen clock per config key in IndexedDB, and restore them on reload.
  - Keep the player's pick across a regeneration when that clock still exists.
  - Undo of an Import, Paste or Reset brings the clocks back; the stale banner lists what changed and when the clocks
    were made (Phase 1 end review). Native IndexedDB, up to 10 builds and about 64 MB, no new dependency (the owner,
    2026-10-14).

**3.4 Build library and share links** (B20)
- **What:**
  - Named builds with a switcher. Migrate the single `clock-generator-config` slot into it.
  - Warn when another tab edits the same build (the `storage` event).
  - "Copy share link" carries the compressed config in the URL hash. Opening a link imports it with a confirm and Undo.
  - The glossary gains "Your builds" and "share link". No new dependency: links need a 2023-or-later browser (the
    owner, 2026-10-14).

**3.F Phase-end safety and accessibility carries** (fresh Phase2 review, explicit carry owners)
- Give failed clipboard copying visible/spoken feedback and a usable manual-copy route.
- Give player-facing Fuel event intervals/quantities and trace information keyboard/touch/text equivalents.
- Preview current→incoming Paste counts and warn/confirm cross-category references. Append stays deferred.
- Correct aggregate output-swing wording, use deliberate click/tap Advanced help, and keep stale-plan values readable
  while their actions remain correctly inert.
- Gather actual320px reflow evidence, distinguish applicable two-dimensional exceptions, and fix ordinary UI gaps
  within the existing accessibility goal. Any remaining policy decision must use concrete evidence; no AA waiver or
  broad phone-layout promise is inferred from the owner's ≥720 full-support decision.
- Finalize a bounded spec against current P3 before implementation. No engine arithmetic, dependencies or deferred
  D1–D8 features. Existing full gates, independent reviews and phase-end requirements apply.

**Phase 3 done when:**
- the items above are merged
- the tests pass
- the fresh UX review is attached to the phase PR.

## Phase 4: owner proposal decisions in progress

Owner direction, 2026-10-16: discuss D1–D9 and the independent proposal's first-visit refinement individually. Explicitly approved scope becomes Phase 4 against `feat/ux-rework`; rejected or unapproved scope stays outside implementation. Track exact approvals and pending decisions in [Phase 4 decisions](specs/phase4-decisions.md). Phase 3 closeout, current verification and the three phase-end reviewers remain required.

### Approved Phase 4 scope: Compact view (D1)

Owner approval, 2026-10-16, B / A / A: include Results/header first, then compact Configure machine/belt/inserter rows using the shared editor. New users retain the explanatory default; Compact is opt-in and remembered locally. Keep comparison visible while Why, Wake and Install share one contextual area, with routine helpers collapsed and help available on demand. Use one slim header with version visible and responsive side-by-side/reflow layouts. Preserve essential units, assumptions, warnings, errors, actions and accessibility. See [D1 scope](specs/D1-compact-view.md).

This approval moves D1 from the deferred backlog into Phase 4. Detailed specs, independent reviews and normal evidence gates precede implementation/merge; Phase 3 completion criteria are unchanged. The proposals below remain deferred unless separately approved.

### Approved Phase 4 scope: Light/dark mode (D2)

Owner approval, 2026-10-16, A / A / B: include D2 after the density work; offer locally remembered System / Light / Dark independently of Compact, with System as the default for new installations. Cover the complete interface including charts/diagrams, preserving the Factorio styling and current contrast/accessibility requirements. Keep preferences outside build exports/share links. See [D2 scope](specs/D2-theme-modes.md) and the [decision register](specs/phase4-decisions.md). Detailed specs/reviews/gates remain required.

### Further deferred design proposals (D3–D8)

Owner requested drafts for later discussion: a task-based audit on real builds; clearer recommendation rationale/tradeoffs; emphasis on exceptions; one display-preferences entry; and preserving working context beyond the existing3.3 scope. See [draft discussion backlog](specs/deferred-design-discussion.md). D8 additionally scopes per-machine target production rate alongside maximum capacity, likely spanning engine planning/worker serialization and UI; target/max/achieved values and per-copy/total units must stay distinct. These proposals remain unapproved for implementation unless separately promoted into Phase 4.

### Independent audit of new UI tests (D9)

Owner requested a deferred independent audit limited to tests added by this UX rework inside `clock-generator-ui`, including new cases in existing files. Identify redundant, brittle or low-value additions and propose specific removals/consolidations with evidence of remaining behavioral coverage. Exclude engine tests, capture scripts, pre-existing UI tests and unrelated upstream additions. See [D9 audit scope](specs/D9-ui-test-audit.md). No current test deletion or change to verification/review requirements is authorized by this planning item.

## Verification (every phase)

1. **Tests.** Vitest tests for every piece of logic touched:
   - the staleness check
   - undo snapshots
   - renumbering and remapping
   - the LCM exclusion
   - the first-problem text
   - the belt question mapping
   - the wake-window derivation
   - share-link round trips.

   Run `npm test`, `npm run lint`, `npm run knip`, `npm run check:icons` and `npm run build` in `clock-generator-ui`.
   When the engine changes, run its tests and lint too.
2. **Fresh UX review at the end of each phase.**
   - Capture the screenshots with `capture/` (see its README) at 1440, 960, 720 and 390px. Update the selectors for the
     new UI.
   - Run three reviewer agents in parallel, each on `review/BRIEF.md` with its persona from `review/SYNTHESIS.md`. Add
     to the brief: "Check whether the findings in docs/ux-rework/review/SYNTHESIS.md for this phase are fixed, and
     report any that are not."
   - Put a short summary in the phase PR: what's fixed, what's still open, and anything new.
   - Fix what's still open, or list it as carried into the next phase.
3. **In game.** The owner checks the install steps (2.5) and the sidecar (2.2) in Factorio 2.1.

## The final PR (`feat/ux-rework` → `master`)

0. **File the issues found (owner, 2026-10-14).** Every finding that was not fixed in the rework (the ledger's
   Follow-ups, the known issues, and anything left open by the last UX review) becomes a GitHub issue, in one pass:
   - the orchestrator drafts them in `docs/ux-rework/ISSUES.md`: one entry per issue with a title, a body (what's wrong,
     where, how to reproduce, the finding it came from) and labels; duplicates merged; items fixed since dropped;
   - **the owner reviews the draft** and edits, drops or approves entries;
   - the orchestrator creates the approved ones with `gh issue create` and adds their links to the final PR.
   This happens before `docs/ux-rework/` is deleted.
1. Delete `docs/ux-rework/` in its own last commit.
2. Bump the versions and changelogs (see Releases above).
3. Run the full test workflow on the branch, including the generation tests.
4. Open the PR with a summary of the three phases and the last UX review. **The owner merges it.**

## Out of scope (decided)

- Layouts tuned for phones below 720px. Only reachability is guaranteed.
- A full undo/redo history. Undo snackbars only.
- Stable, never-reused ids. The owner chose consistent renumbering.
- Bringing the Diagram to parity, or making it replace the List.
- A full overhaul of the developer timelines (zoom, merged rows, keyboard stepping).
