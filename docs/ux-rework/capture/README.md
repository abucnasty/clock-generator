# Screenshot capture

These scripts produced the screenshots for the UX review of 0.9.0. Re-run them at the end of each phase to give the
fresh review its evidence. They drive the installed Google Chrome with `playwright-core`, which is **not** a dependency
of the repo. Install it somewhere outside the repo.

```bash
# once, outside the repo
mkdir -p /tmp/ux-capture && cd /tmp/ux-capture && npm init -y && npm i playwright-core@1.56.1

# Node ignores NODE_PATH for ES modules, so copy the scripts next to playwright-core and run them from there
cp docs/ux-rework/capture/{lib,capture,capture-extra}.mjs /tmp/ux-capture/

# capture against a production build (see "Shared helpers"): build once, the scripts serve it with `vite preview`
cd clock-generator-ui && npm run build
node /tmp/ux-capture/capture.mjs <out dir>                  # 1440, 960, 720 and 390 at once
node /tmp/ux-capture/capture-extra.mjs <out dir>            # writes into <out dir>/extra
```

`BASE_URL=http://localhost:5204` makes them use a server that is already running instead (a dev server needs
`node scripts/copy-factorio-data.mjs && npm run dev -- --port 5204 --strictPort`; ignore-scripts is on, so the game data is
copied by hand). The dev server runs React StrictMode, which breaks the autofocus of a dialog's field; capture against the
preview unless you are debugging.

- `capture.mjs` runs the four widths of the plan (1440, 960, 720, 390) at once, each in its own browser context, into
  `<out dir>/w<width>/` with a merged `INDEX.md`:
  - **1440** is the full walkthrough: first visit, the ⋮ menu and Paste from Factorio, an imported build in the List and the
    Diagram, with the editors, Check only and Generate, every Results tab, copy, an edit after generating (the stale
    banner and "Copy old clock…"), a broken build, a fuel build, and a run in flight.
  - **960, 720 and 390** take the layout states: first visit, Configure (List), Results and every tab, with a
    no-side-scroll check and whether the Configure and Results tabs can be clicked. `WIDTHS=1440,390` picks other widths.
- `capture-extra.mjs` covers the clock's click/touch help dialog, the narrow window above the fold, a broken build and a fuel build at 1440 and
  390, into `<out dir>/extra/`.
- Both use the sample configs in `clock-generator/resources/config-samples/` (`SAMPLES_DIR` for another checkout), and find
  controls through the shared `ui` map. **Update the selectors and affected consumers as the rework changes the UI.**
  The main walkthrough keeps both build-file rejection in Paste and a valid sidecar-format test input derived from
  the logistic sample; that fixture is not an export captured in game. Dialog screenshots wait for their finite
  entry animations to finish. Waits for button text read `textContent`, not `innerText`: MUI upper-cases labels with CSS.
- `capture-enable-chip.mjs <out dir> <before|after> [port]` checks the enable chip (item 1.13) at 1440px and 720px.
  `before` runs against the gear icon of 0.9.0; `after` runs the whole sequence and writes a pass or fail line per check
  into `INDEX.md`.
- `capture-numbers.mjs <out dir> <start number> [port]` checks readable numbers and units (item 1.10) at 1440px and
  720px: the number fields' short text and full value on focus (and that the stored value does not change), Machine
  Facts, the diagram's machine node and the Potential Clocks headers. It writes a pass or fail line per check into
  `INDEX.md`. Set `SAMPLES_DIR` to read the sample configs from another checkout (a worktree's
  `clock-generator/resources/config-samples`).
- `capture-half-width.mjs <out dir>` (on `lib.mjs`; `BASE_URL`, `WIDTHS` default 960,800,720,390, `STEPS`) checks item 2.9: the header's height and rows (steady through a reason line, a check and Copy), no sideways page scroll, nothing off-screen or clipped, the clock table's decision columns and the scroll boxes (named region, tabindex 0, edge fade), Fuel, Swing Plan and Transfer Plan columns, forms and dialogs (no control under 40px). Any item that adds or rebuilds a view runs it.
- `capture-header.mjs <out dir> [port]` checks the header (item 1.2) at 1440, 960, 720 and 390px: the Configure and Results
  toggles, Generate and Copy are clickable (`elementFromPoint`), nothing in the header overlaps, the content starts below
  the header, the header stays pinned on scroll, the title, the ⋮ menu, Export, Import and Paste from Factorio from the
  menu, Validate scrolling to the Validation panel and the "Copied." warning. It writes a pass or fail line per check
  into `INDEX.md`. Run it before and after a change to the header into two out dirs. Set `SAMPLES_DIR` to read the sample
  configs from another checkout. It finds Copy by `/^Copy/`, since it reads "Copy old clock…" while results are stale.
- `capture-renumber.mjs <out dir>` (on `lib.mjs`) checks one number per entity (item 1.9) at 1440 and 720px, each in a fresh
  browser context: the label every view gives an entity (row chips, pickers, rule editor, diagram, edit dialog, Transfer Plan)
  before and after a delete, a reorder and a reload, the references in the saved form, an old saved form with `next_ids`, the
  dimmed Transfer Plan from the keyboard, the inserter row's layout and the forced-ALWAYS tooltip of the enable chip (step 13,
  which is step 7 of `capture-enable-chip.mjs`). `RESULTS=1` also generates a sample after a delete (slow).
- `capture-first-problem-warning.mjs <out dir>` (on `lib.mjs`) checks items 1.4 and 1.14 at 1440, 720 and 390px: the problem
  chip and reason in the bar, the jump to the first problem, the disabled buttons' reasons, the warning yellow and the
  below-target Copy. `STEPS` (a regexp: `^P` for 1.4, `^W` for 1.14) runs a part; `UI_DIR` names the checkout it greps.
- `capture-diagram.mjs <out dir>` (on `lib.mjs`) checks the Diagram's readability (item 2.11) at 1440 and 720px: the split
  "(in)"/"(out)" belt and the left-to-right order, arrowheads and their hover colour, 12px text and its contrast, overlaps,
  the node chips against the List's, Enter on a focused node and the focus ring, the fullscreen fit, and the List's
  "Nearest lane of the belt" select. `STEPS` (a regexp on the step numbers) runs a part.
- `capture-timelines.mjs <out dir>` (on `lib.mjs`) checks the developer timelines (item 2.10) at 1440 and 720px: the
  `#1b1b1b` track and legend chips, 3:1 contrast of every colour drawn, the six item colours and the repeat caption, bars
  and Blocked runs at least 3px, the strip legend row, Detailed-mode swatches, canvas and SVG `role="img"` names, the
  fuel chart, fullscreen, and the drill label's orange. `BASE_URL`, `WIDTHS` and `STEPS` as above.
- `capture-gui-grammar.mjs <out dir>` (on `lib.mjs`) checks the GUI grammar's tokens and components (item 2.7 PR A) at
  1440, 720 and 390px: one filled next-step button per state (first visit, ready, fresh on both views, below target,
  stale, in flight), the colour roles of confirm, cancel, danger and selection, square chips, title bars on cards,
  dialogs and accordions, the help controls, focus rings (black in a filled alert), messages and menus on the card
  surface, and that each surface is its token. `BASE_URL`, `UI_DIR`, `WIDTHS` and `STEPS` as above.
- `capture-rule-editor.mjs <out dir>` (on `lib.mjs`) checks the rule editor (item 3.1) at 1440, 720 and 390px: the
  "In words" sentence and "In the blueprint" note per mode, Clocked windows against the period (before a check, after
  Check only, after Generate with the strip), the inline problems and the refused Save in the dialog and the Diagram tab,
  templates that ask and confirm, drills without Conditional, names, focus and contrast. Controls are in `ui` (`rule*`).
- `capture-build-card.mjs <out dir>` (on `lib.mjs`) checks the Configure layout (item 2.7 PR B) at 1440, 720 and 390px:
  Target Output, the Build card (its sections in order, the List/Diagram toggle in its title bar) and Advanced
  (collapsed, and again after Import and Reset), the "Add chest" and "Add mining drill" rows and where the focus goes
  when a row is added or the last one deleted, the inserter row grid, inset filter slots with one "+", grey delete and ×
  until hovered or focused, the help buttons, "Show rates", headings, contrast and the narrow layout. `BASE_URL`,
  `UI_DIR`, `WIDTHS` and `STEPS` as above.
- `capture-messages-clear.mjs <out dir>` (on `lib.mjs`) checks messages that don't cover the page (item 1.5 F) at 1440,
  720 and 390px: the message in the header's flow and in the fullscreen diagram's title bar, never over a focused
  control or a dialog, errors closing when a dialog opens or the action starts again, keyboard reach of Undo, the Undo
  offer ending when a check or generation starts, and the announcements. `BASE_URL`, `WIDTHS` and `STEPS` as above.

## Shared helpers

New item scripts use `lib.mjs` (the helpers below) and start from `example-item.mjs`, so a script is only its steps and
checks. `lib.mjs` needs `playwright-core`, and Node ignores `NODE_PATH` for ES modules, so copy the item script and
`lib.mjs` into `/tmp/ux-capture/` and run them from there:

```bash
cp docs/ux-rework/capture/{lib,my-item}.mjs /tmp/ux-capture/
node /tmp/ux-capture/my-item.mjs /tmp/ux-capture/out/my-item    # BASE_URL, SAMPLES_DIR, UI_DIR, PREVIEW_PORT are read from the environment
```

**The fast pattern** (the evidence gate asks for it; `example-item.mjs` is the template):

1. **Production build.** `previewServer({ port })` serves `clock-generator-ui/dist` with
   `npx vite preview --port <port> --strictPort` and returns a stop function (`stop.url` is the address; `{ build: true }`
   runs `npm run build` first, `UI_DIR` points at a worktree). Captures run against the preview by default (the scripts start
   one unless `BASE_URL` is set). The dev server runs React StrictMode, which double-mounts components and so breaks the
   autofocus of a dialog's field; that happens only in dev.
2. **Widths at once.** `forWidths(widths, async ({ page, rec, width }) => ..., { out, base })` opens one browser context per
   width and runs the steps for every width at the same time. Each width has its own recorder and writes into
   `<out>/w<width>/` (files named `NN-<name>-<width>.png`); `run.finish({ title })` writes each width's `INDEX.md` and the
   merged `<out>/INDEX.md`, and returns the exit code. (`eachWidth` still runs the widths one after the other on one page.)
3. **One generation per width.** Import, Validate and Generate once, then take every Results state (each tab, each toggle)
   from that run. Do not generate again to reach another state.
4. **The small sample.** `SMALL_SAMPLE` is the build whose generation finishes fastest (`logistic-science-sample.json`; the
   timings are in a comment in `lib.mjs`). Use it where the build's size does not matter. `LOGISTIC` (the default build)
   is for states whose layout depends on the size: a long table, a tall diagram, the narrow window.
5. **In flight.** `captureInFlight(page, rec, name)` clicks Generate, waits for the progress bar, shoots, then reloads the
   page instead of waiting for the run to end. Runs of the small samples last 0.25 s, too short for a shot: use
   `SLOW_SAMPLE` (2.6 s) for this state, and put it last, since the page reloads.

Measured on 2026-10-14 (same shot list, logistic science, 1440 and 720, against a `vite preview`): 13.5 s one width after
the other with the old waits, 4.6 s with `forWidths` and the event-based waits (preview start included).

The helpers:

- `openSession`, `createRecorder` (`shot`, `step`, `check`, `info`, `finish`), `eachWidth` and `forWidths` run the browser,
  number the shots and write `INDEX.md` with a PASS or FAIL line per check. `finish()` returns a non-zero exit code if a
  check or a step failed.
- `importFile`, `goConfigure`, `goResults`, `validate`, `generate` and `openMenu` are the app actions. `importFile` waits
  until Check only is usable, `validate` (it clicks "Check only", which replaced Validate in 2.3) until the check's chip
  changes, `generate` until neither busy label ("Checking...", "Generating...") shows (both read the buttons'
  `textContent`). Generate alone is enough to get clocks: it checks first.
- Scripts written before 2.3 (`capture-header.mjs`, `capture-first-problem-warning.mjs`, `capture-messages-undo.mjs`,
  `capture-copy.mjs`) target the Validate button and the Validation card, which 2.3 removed; for the current UI use
  `capture.mjs` and `capture-generate-checks.mjs`. `goConfigure` and `goResults` force the click, with a note, when another element covers the
  tab (the header at 390 before item 1.2).
- `contrast(page, locator, { sample })` is the text colour against the colour painted behind it: it blends the ancestors'
  background colours **and** MUI's dark Paper elevation overlay (the `background-image` gradient). `sample: true` also
  shoots the element with its text hidden and reads the pixels, to confirm a surprising number (`analyticRatio` keeps the
  computed one). It returns `{ ratio, required, pass, color, background, fontSize, fontWeight, overlay }`.
- `contrastPairs(page, [{ name, locator, required? }], rec)` records one check per pair against WCAG AA: 4.5:1 for text,
  3:1 for text of at least 24 px (or 18.66 px and bold); `required: 3` for a non-text colour.
- `accessibleName(page, locator)` is the name Chrome computes for the accessibility tree.
  `checkLabelInName(rec, page, locator, label?)` records a check that it contains the visible text (case and spacing are
  ignored; an icon-only control passes with a note).
- `noSideScroll` and `isClickable` are the other page measurements.
- `checkAnnounced(rec, page, text, label?)` records a check that `text` (a string or RegExp) is announced: it must be in the accessibility
  tree (`page.locator('body').ariaSnapshot()`, which leaves out `aria-hidden` subtrees) inside an element with role status, log or
  alert, or `aria-live` polite or assertive, and that element must have no `aria-hidden="true"` ancestor in the DOM. It polls for about
  1.5 s and returns whether it passed; the detail names the live regions it found, or says the text sits only under `aria-hidden`.
- **Keyboard and focus** (audits kept finding what the scripts never checked: focus hidden under the sticky header, controls
  that stay operable from the keyboard while they look disabled or out of date, controls Tab never reaches). Each helper has a
  `rec.check` wrapper that follows `checkLabelInName(rec, page, locator, label)`:
  - `tabTo(page, locator, { max = 200, shift = false })` presses Tab (Shift+Tab) from where focus is until the locator's
    element or a descendant has focus (any match counts) and returns `{ reached, presses }`; `presses: 0` means it already had
    focus. It stops at the first full circle and never throws on "not reached". Wrapper: `checkTabTo(rec, page, locator, label,
    { max, shift, expect = true })` (`expect: false` asserts Tab does not reach it).
  - `focusNotObscured(page)` takes `document.activeElement` and hit-tests a 5x5 grid across its visible rect: a point is covered
    when what is on top lies in a `position: fixed|sticky` element (the app header, a Snackbar, a fixed footer) that does not
    contain the focused element and paints something (an empty transparent wrapper does not count). Returns `{ ok, covered:
    'none'|'partly'|'fully', by, fraction, inViewport, element, headerHeight }`; `ok` is false only when `fully` (WCAG 2.4.11), but
    `partly` is reported too (`checkFocusNotObscured(rec, page, label, { strict })` passes it with a note, or fails it with
    `strict: true`). An overlay with `pointer-events: none` is invisible to `elementFromPoint` and not seen. Call it right after the
    Tab press (use Tab, not `.focus()`, so the browser's own scroll-into-view runs).
  - `inertFromKeyboard(page, locator)` is true when no focusable descendant can be reached by Tab and Enter or Space on them does
    nothing detectable. It probes every focusable-looking descendant with `focus()` (`inert`, `disabled`, `tabindex=-1`,
    `aria-disabled`, hidden are listed as reasons), presses Tab from a probe placed right before the element and Shift+Tab from one
    right after it, then focuses each focusable descendant and presses Enter and Space, watching for a `click`, `input`, `change` or
    `submit` event inside it or a DOM change other than `class`/`style`. **It presses Enter on live controls**, so a wrongly operable
    Generate does generate: that is the finding. A locator that matches nothing is `inert: false` (a lost target must not pass).
    `inertFromKeyboardReport` returns the detail (`reason`, `candidates`, `tabbable`, `tabLanded`, `reacted`); wrapper:
    `checkInertFromKeyboard(rec, page, locator, label)`. A disabled button is inert; a block that only looks disabled (`opacity`
    plus `pointer-events: none`) with live buttons in it fails.
  - `checkAxe(rec, page, view, { rules, exclude })` runs axe-core in the page (found beside the script or in `/tmp/ux-capture/node_modules`, never
    in the repo; an INFO line and a skip when missing) and records one PASS/FAIL per rule per view, with the failing nodes' selectors and
    summaries in the detail. Default `rules` is `AXE_RULES` (nested-interactive, duplicate-id-aria, button-name, select-name, label, aria-input-field-name,
    aria-toggle-field-name, aria-valid-attr-value, aria-allowed-role, target-size, landmark-one-main, region, empty-table-header, heading-order); default `exclude` is `canvas` and `.react-flow`.
  - `checkFocusNotObscuredAtHeight(rec, page, { height, width, walk, max })` resizes the viewport (use 640 at 1440 wide, 560 at 720), Tabs through
    `walk` (a list of locators, one container locator such as the open dialog, or nothing for the whole page) running `focusNotObscured` on every stop,
    records ONE rolled-up check (fails on any fully covered stop; partly covered stops are listed) and restores the viewport.
  - `checkMouseActivationVisible(rec, page, locator, label)` clicks the element with the real mouse and passes only if the viewport visibly
    changed within ~400 ms: scrolled 4 px or more, different visible text, a dialog/menu/popover/snackbar opened or closed, or focus moved to an
    element with a visible ring. The detail says what changed. It catches controls whose click lands off screen or does nothing.
- "Before" shots are only for states the original review has no shot of; the review's shots already show 0.9.0.
- The default widths are 1440 and 720. Add 390 (at 844 high) when the item affects reachability, and 960 at phase end.

- Never commit the screenshots. Attach a summary of the review to the phase PR instead.

## The `ui` map, `itemLabel`, `openTooltip` and the menu helpers

Capture scripts kept breaking when an item renamed a control or when a tooltip or menu opened slowly. The shared helpers in `lib.mjs`
now own those two things. **Scripts find controls only through `ui` and `itemLabel`, and open tooltips and menus only with
`openTooltip`/`openMenu`; an item that renames a control updates `ui` in the same commit.** (`openMenu` below means `openMoreMenu` and
`chooseMenuItem`; the older `openMenu(page)` still exists, clicks "More options" and waits a fixed 300 ms, and stays for the scripts that use it.)

- `ui.<name>(page, ...args)` returns a Playwright `Locator` (never awaited, so `.click()`, `.count()` and `.first()` chain on it). Each
  entry is role plus accessible name, with a comment naming the item that owns the control. Entries: `generate`, `checkOnly` (the workflow
  bar's, the first of two), `copyBlueprint` (header, Results only), `viewToggle(page, 'Configure'|'Results')`, `resultsTab(page, name)`,
  `menuButton`, `menu`, `menuItem(page, name)`, `pasteFromFactorio`, `reset`, `importConfig`, `exportConfig`, `advancedOverrides`,
  `card(page, key)` and `add(page, key)` (keys `target`, `machines`, `inserters`, `belts`, `chests`, `drills`; Target Output has no Add),
  `addChest(page, 'buffer'|'infinity')`, `clockTable`, `clockRows(page, index?)`, `resultsCard`, `message`, `messageUndo`, `messageClose`,
  `listView`, `diagramView`, `diagram`, `diagramFullscreen`, `diagramDialog`, `diagramClose`.
- A name that varies is handled inside the entry: `importConfig` and `exportConfig` are header buttons at 900 px and up and ⋮ menu items below
  it (there they resolve only while the menu is open, so click them with `chooseMenuItem`). An entry for a control that is absent in a state
  resolves to 0 (`copyBlueprint` before a generation, `diagram` in List view, `message` when none shows, `resultsCard` before 2.6).
- `itemLabel(id)` is what the UI shows for a game id. Today that is the id; once `clock-generator/resources/data-filtered.json` has a `names` key
  (branch `feat/ux-rework-p2-item-names`, items 2.8 a/b) it returns the in-game name, so scripts do not change. It reads the file beside `UI_DIR`.
- `openTooltip(page, locator, { timeout = 5000 })` hovers and focuses the locator, waits for a visible `[role=tooltip]` and returns it, or throws
  an error naming the control and the tooltips found. It leaves the mouse there; `page.mouse.move(0, 0)` before a shot.
- `openMoreMenu(page)` opens ⋮ (unless it is open), waits for the menu and returns it. `chooseMenuItem(page, name)` picks an item at any width:
  Import Config and Export Config are clicked in the header at 900 px and up, everything else goes through the menu; it waits for the menu to close.
- `selftest.mjs` resolves every `ui` entry at 1440, 720 and 390 against a running build and exercises the tooltip and menu helpers
  (`BASE_URL=http://localhost:5239 UI_DIR=<checkout>/clock-generator-ui node selftest.mjs`). Run it after editing `ui`; it expects the
  documented 0 counts, so update its expectations in the same commit when an item adds a control (for example `resultsCard` after 2.6).
