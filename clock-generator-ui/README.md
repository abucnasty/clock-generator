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
