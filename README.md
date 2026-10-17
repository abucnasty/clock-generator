# Factorio Clock Generator

A clock generator for Factorio builds. Describe a build (its machines, inserters, belts, chests and drills, and the
rate it should make) and the generator simulates it tick by tick, works out when each inserter has to be enabled, and
gives you a blueprint of decider combinators that clock the inserters, so the build makes exactly its target rate with
as few inserter wake-ups as it can. It lists the clocks it could make, says which hold the rate and recover from a
backpressure loss, and selects one.

Use it on the site: <https://clock-generator-self.vercel.app>. The source is at
<https://github.com/abucnasty/clock-generator>.

## Repository

- `clock-generator/`: the engine, a TypeScript library that validates a config, simulates the build and generates the
  clocks as blueprints; also the `record` and `verify` commands that compare a build in the game with the simulator.
  See its [README](clock-generator/README.md).
- `clock-generator-ui/`: the site, a React and Vite app that builds a config, runs the engine in web workers and shows
  the clocks. See its [README](clock-generator-ui/README.md).
- `clock-generator-sidecar/`: a Factorio mod that reads machines, inserters and belts from the game and exports them
  for the generator.
- `clock-generator-recorder/`: a Factorio mod for development that records every tick of a running build, for
  comparing the game with the simulator. It is not published.

## Running it locally

With Node.js installed:

```bash
cd clock-generator-ui
npm install
npm run build:deps   # installs and builds the engine in ../clock-generator
npm run dev          # the site at the address Vite prints
```

`npm run build` in `clock-generator-ui` builds the engine and the site into `clock-generator-ui/dist`, and
`npm run lint` lints the UI.

## Tests

In `clock-generator` (after `npm install`):

```bash
npm test                 # the unit tests
npm run test:generation  # the generation tests: the clocks of whole samples, a few minutes
npm run test:all         # both
npm run test:game        # records the sample builds in Factorio; needs a Factorio install (see the engine README)
```

In `clock-generator-ui`, `npm test` runs the UI's tests.

## Versioning

There are two versions.

The clock generator and its UI (`clock-generator`, `clock-generator-ui`) share one. Bump the two together, with a
section for the new version in `CHANGELOG.md`. Merging a new version to `master` creates the GitHub release
(`.github/workflows/release.yml`); a merge that does not change the version releases nothing.

The same workflow deploys the site. Vercel deploys nothing by itself, not `master` and not a pull request:
`vercel.json` switches that off. The site players use is deployed when a version is released, from
the commit of its tag and after its GitHub release exists, so `master` can run ahead of what players have. A fix
reaches them with a version bump: a patch version and its changelog section in the same pull request as the fix.
Every merge to `master` is also deployed as a preview, with its address in the summary of the workflow run. The
deployments need the secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`; the two ids are in
`.vercel/repo.json` (or `.vercel/project.json`) after `vercel link`. Starting the workflow by hand deploys the current version again.

The `clock-generator-sidecar` mod has a version of its own and is only released when the mod changes. Bump its
`info.json`, add the version to its `changelog.txt`, and set `LATEST_SIDECAR_VERSION` in
`clock-generator/src/config/sidecar-version.ts` to match; a test fails if those three drift apart. Merging a change
to the mod's folder to `master` publishes a version the Factorio mod portal does not have yet
(`.github/workflows/publish-sidecar.yml`, which needs the `FACTORIO_MOD_API_KEY` secret and can also be started by
hand). A release of the generator does not publish the mod. The upload sends only the zip: the long description on
the mod's portal page is `clock-generator-sidecar/PORTAL.md`, pasted there by hand (Edit) after a release.

The `clock-generator-recorder` mod is a development tool. It keeps its own version by hand and is not published. It
depends on the sidecar and uses its extraction and export, so it needs the sidecar of this repository beside it.
