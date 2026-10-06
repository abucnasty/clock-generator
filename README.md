# Clock Generator and Other Scripts


## Versioning

The clock generator (`clock-generator`, `clock-generator-ui`) and the `clock-generator-sidecar` mod always share one
version. Bump them together in every release, and set `LATEST_SIDECAR_VERSION` in
`clock-generator/src/config/sidecar-version.ts` to match. A test fails if they drift apart.

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