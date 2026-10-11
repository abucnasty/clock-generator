# Clock Generator and Other Scripts


## Versioning

There are two versions.

The clock generator and its UI (`clock-generator`, `clock-generator-ui`) share one. Bump the two together, with a
section for the new version in `CHANGELOG.md`. Merging a new version to `master` creates the GitHub release
(`.github/workflows/release.yml`); a merge that does not change the version releases nothing.

The `clock-generator-sidecar` mod has a version of its own and is only released when the mod changes. Bump its
`info.json`, add the version to its `changelog.txt`, and set `LATEST_SIDECAR_VERSION` in
`clock-generator/src/config/sidecar-version.ts` to match; a test fails if those three drift apart. Merging a change
to the mod's folder to `master` publishes a version the Factorio mod portal does not have yet
(`.github/workflows/publish-sidecar.yml`, which needs the `FACTORIO_MOD_API_KEY` secret and can also be started by
hand). A release of the generator does not publish the mod.

The `clock-generator-recorder` mod is a development tool. It keeps its own version by hand and is not published.

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