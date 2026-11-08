---
$schema: urn:oasis:names:tc:dita:xsd:task.xsd
id: release-a-version
---

# Release a version

Release the work on `master`: the clock generator, the site and, if its version is new, the sidecar.

## Before you start

- The work to release is on `master`. Each pull request merged to `master` is complete. `master` must be ready to ship.
- The changelog lines of the work are in the section `[Unreleased]` of `CHANGELOG.md`. The sidecar lines, if there are
  any, are in the newest section of `clock-generator-sidecar/changelog.txt`.
- You can make a branch and a pull request. abucnasty merges the release pull request.

## Procedure

1. Do the UAT on the preview deployment of `master`. The summary of the last run of `release.yml` on `master` shows
   its address.

2. Make the branch `release/<slug>` from `master`.

3. Set the next version in `clock-generator/package.json` and `clock-generator-ui/package.json`, and in their
   `package-lock.json` files. The two packages must show the same version.

4. If the sidecar has a new version, set it in `clock-generator-sidecar/info.json`, in the newest entry of
   `clock-generator-sidecar/changelog.txt` and in `LATEST_SIDECAR_VERSION`.

5. In `CHANGELOG.md`, change the section `[Unreleased]` to the new version, with the date. Add an empty section
   `[Unreleased]` above it.

6. Make the record again.

   ```bash
   cd clock-generator
   BLAST_GROUPS=config,pickup,overhood,front,blocked,containers,variants bash scripts/blast/blast.sh run .. <out>
   bash scripts/blast/blast.sh record write <out>
   bash scripts/blast/blast.sh record check <out>
   ```

   Only the `text_sha256` field of the jobs can change, because the blueprint has the version of the engine. If a
   different field changes, stop. Do not open the pull request.

7. Add the entry `Release x.y.z` to `clock-generator/record/MOVES.md`.

8. Open a pull request into `master`. Give it the title `release: x.y.z, <summary>` and use the template
   `.github/PULL_REQUEST_TEMPLATE/release.md`.

   ```bash
   gh pr create --base master --head release/<slug> --title "release: x.y.z, <summary>" --body-file <file>
   ```

9. When the required checks are correct, abucnasty merges the pull request.

## Result

The merge starts `release.yml`. After the tests, the gate shows `release`. The `release` job makes the tag
`v<version>` and the GitHub release, and the `production` job deploys the tag to production. If the sidecar version is
new, the `sidecar` job uploads it to the mod portal. If neither version is new, the `release` job stops with an error.

## Related information

- [Ship a hotfix](ship-a-hotfix.md)
- [How the site and the sidecar are published](site-and-sidecar-publishing.md)
- [Releasing](../../CONTRIBUTING.md#releasing) in CONTRIBUTING.md
