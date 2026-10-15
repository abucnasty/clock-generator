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
- `npm run preview` serves the built `dist/`.
- `node scripts/copy-factorio-data.mjs` copies the game data and the example builds ("Try an example") from
  `../clock-generator/resources` into `public/`. It runs before `dev` and `build`; run it by hand when npm's
  `ignore-scripts` is on.

## Words in the UI

One word per idea in every string a player reads. The terms, what they mean and the words they replace are in
`src/utils/glossary.ts`, which also feeds the Terms popover (⋮ > Terms); new copy uses them.
