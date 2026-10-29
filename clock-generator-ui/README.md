# Clock Generator UI

The web front end of the Factorio clock generator: a React and Vite app for building a config, validating it and
generating clocks as blueprints.

It depends on the engine in `../clock-generator` through a `file:` dependency and imports it as
`clock-generator/browser`. Generation runs in a pool of web workers, so the page stays responsive while clocks are
simulated.

## Commands

Install with `npm install`. The dev server needs the engine built first (`npm run build` in `../clock-generator`).

- `npm run dev` starts the Vite dev server.
- `npm run build` runs `build:deps`, which installs and builds the engine, then type checks and builds the site into
  `dist/`.
- `npm run lint` runs ESLint; `npm run lint:fix` fixes what it can.
- `npm test` runs the UI unit and render tests. `npm run knip` checks unused code and dependencies, and
  `npm run check:icons` checks the icon assets. Run Knip after building the engine.
- `npm run preview` serves the built `dist/`.
- `npm run test:browser` generates a clock for the logistic science example in headless Chromium, on the dev server
  and on the built `dist/`, and fails on any error the page or a worker reports. It needs `npm run build` first and,
  once, `npx playwright install --only-shell chromium`.
- Vite copies the game data and the example builds ("Try an example") from `../clock-generator/resources` into
  `public/` whenever it starts, for `dev` and `build` alike (`scripts/game-data-plugin.ts`), and the dev server copies
  them again and reloads the page when they change.

## Words in the UI

One word per idea in every string a player reads. The terms, what they mean and the words they replace are in
`src/utils/glossary.ts`, which also feeds the Terms popover (⋮ > Terms); new copy uses them.

## Maintaining the UI

The simulation worker owns engine runtime imports. Other UI modules use engine types from `clock-generator/browser`,
small runtime values from `clock-generator/light`, or requests to the worker. ESLint enforces this boundary; Node tests
can import the engine directly.

Keep build data separate from presentation state. Named builds and saved results are managed by the build-library and
results-cache utilities. Working views belong to `useBuildViewContext`; theme preferences are browser-wide and managed
by `useDisplayPreferences`. A new generation selects its new recommended clock.

Replay uses the configuration saved with the generated results. Node values describe one modeled copy, and transfer
quantities belong to their recorded tick. The diagram is schematic: it does not simulate physical belt positions or
inserter-arm motion. Preserve these distinctions when changing labels or animation.

### Keyboard and colour checks

Check affected workflows with the keyboard: logical Tab order, visible focus, normal menu/dialog/tab behavior, and
focus return when a control or dialog closes. Check that sticky headers and toolbars do not hide the focused control.
Use ordinary browser checks at desktop and narrow widths alongside the functional tests.

Status, selection, errors, and chart series need text, icons, shapes, or patterns in addition to colour. Check text and
meaningful graphics against the actual composited background in both themes, including hover, selected, and focus
states. The existing acceptance targets are 4.5:1 for normal text, 3:1 for large text, and 3:1 for meaningful controls
and graphics. Shared theme tokens and chart palettes have regression tests; keep those checks with palette changes.
These focused checks do not establish full WCAG conformance.
