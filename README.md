# Clock Generator and Other Scripts


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
hand). A release of the generator does not publish the mod.

The `clock-generator-recorder` mod is a development tool. It keeps its own version by hand and is not published. It
depends on the sidecar and uses its extraction and export, so it needs the sidecar of this repository beside it.

## Clock Generator

**install steps**
1. Install nodejs
2. open a terminal and navigate to `clock-generator`
3. execute `npm install`
4. navigate to `clock-generator-ui`
5. execute `npm install`

**build steps**
1. in `clock-generator` run `npm run build`

**run ui**
1. in `clock-generator-ui` run `npm run dev`