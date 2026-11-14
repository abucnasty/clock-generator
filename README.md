# Factorio Clock Generator

A clock generator for Factorio builds. Describe a build (its machines, inserters, belts, chests and drills, and the
rate it should make) and the generator simulates it tick by tick, works out when each inserter has to be enabled, and
gives you a blueprint of decider combinators that clock the inserters, so the build holds exactly its setpoint with
as few inserter wakeups as it can. It lists the clocks it could make, says which hold the rate and go back to it by themselves after a
supply stop or an output blockage, and selects one.

Use it on the site: <https://clock.abucnasty.dev>. The source is at
<https://github.com/abucnasty/clock-generator>.

## Repository

- `clock-generator/`: the engine, a TypeScript library that checks a configuration, simulates the build and generates the
  clocks as blueprints; also the `record` and `verify` commands that compare a build in the game with the simulator.
  See its [README](clock-generator/README.md).
- `clock-generator-ui/`: the site, a React and Vite app that builds a configuration, runs the engine in web workers and shows
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

See [Contributing](CONTRIBUTING.md) for resource organization and choosing checks appropriate to a change.

In `clock-generator` (after `npm install`):

```bash
npm test                 # the unit tests
npm run test:generation  # the generation tests: the clocks of whole samples, a few minutes
npm run test:all         # both
npm run test:game -- <file> # selected game checks; requires Factorio (see the game verification guide)
```

In `clock-generator-ui`, `npm test` runs the UI's tests, and `npm run test:browser` generates a clock in a real browser.

The [game verification guide](clock-generator/tests/game/README.md) covers installation, mechanic fixtures, clock-build
checks and retained probe captures.

## Versioning

There are two versions.

The clock generator and its UI (`clock-generator`, `clock-generator-ui`) share one. Bump the two together, with a
section for the new version in `CHANGELOG.md`. Only two merges release a version (`.github/workflows/release.yml`):

- a **release pull request**: into `master`, from a branch `release/<slug>`, titled `release: ...`;
- a **hotfix pull request**: into a branch `hotfix/<version>` that was made from the latest tag, titled `hotfix: ...`. It
  ships one fix on the last deployed commit, without the unreleased work on `master`.

Every other merge releases nothing: its changelog line waits under `[Unreleased]` for the next release pull request. The
workflow looks up the pull request behind the pushed commit, so opening a pull request, naming a branch or editing a title
releases nothing; only a merge does. On a release or hotfix merge, a version with no tag gets a tag and a GitHub release.
A merge where neither the generator nor the sidecar has a new version fails. The steps are in
[Releasing](CONTRIBUTING.md#releasing).

The same workflow deploys the site, a Cloudflare Worker with static assets (`clock-generator-ui/wrangler.jsonc`);
Cloudflare deploys nothing by itself. The site users use is deployed when a version is released, from
the commit of its tag and after its GitHub release exists, so `master` can run ahead of what users have. A fix
reaches them with a release or a hotfix: a version bump and its changelog section.
Every merge to `master` is also uploaded as a preview, with its address in the summary of the workflow run; the
UAT of a release runs there. The deployments need the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
([Workflow variables and secrets](docs/maintainer/workflow-variables-and-secrets.md)). Starting the workflow by hand
(a recovery) deploys the latest released tag again; it never makes a release. The old address on Vercel only redirects
to the new one (`vercel.json`, deployed by hand: [Move the site to Cloudflare](docs/maintainer/move-the-site-to-cloudflare.md)).

The `clock-generator-sidecar` mod has a version of its own. Bump its `info.json`, add the version to its
`changelog.txt`, and set `LATEST_SIDECAR_VERSION` in `clock-generator/src/config/sidecar-version.ts` to match; a test
fails if those three drift apart. A release or hotfix merge publishes a version the Factorio mod portal does not have yet
(`.github/workflows/publish-sidecar.yml`, which release.yml calls and which needs the `FACTORIO_MOD_API_KEY` secret). A
merge to the mod's folder that is not a release or a hotfix publishes nothing. A failed upload can be tried again with
"Run workflow" on the branch of the merge. The upload sends only the zip: the long description on
the mod's portal page is `clock-generator-sidecar/PORTAL.md`, pasted there by hand (Edit) after a release. PORTAL.md is
generated from the user topics `docs/user/export-a-build.md` and `docs/user/sidecar-export-contents.md`: edit those, then
run `npm run docs:portal` in `clock-generator/` (CI fails when PORTAL.md is not current).

The `clock-generator-recorder` mod is a development tool. It keeps its own version by hand and is not published. It
depends on the sidecar and uses its extraction and export, so it needs the sidecar of this repository beside it.
