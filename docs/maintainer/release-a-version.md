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
   its address. The bar at the top of the page shows `preview <hash>`: check that the hash is the start of the commit
   that you test.

2. Make the branch `release/<slug>` from `master`.

3. Set the next version in `clock-generator/package.json` and `clock-generator-ui/package.json`, and in their
   `package-lock.json` files. The two packages must show the same version.

4. If the sidecar has a new version, set it in `clock-generator-sidecar/info.json`, in the newest entry of
   `clock-generator-sidecar/changelog.txt` and in `LATEST_SIDECAR_VERSION`.

5. In `CHANGELOG.md`, change the section `[Unreleased]` to the new version, with the date. Add an empty section
   `[Unreleased]` above it.

6. Do not make the record again. The record holds no hash of the text of a clock, and the version of the engine is in
   that text only, so the bump moves no file in `clock-generator/record/`. The pull request has no change in that folder.
   If the "Record check" of the pull request shows a difference, stop. Do not merge the pull request.

7. Open a pull request into `master`. Give it the title `release: x.y.z, <summary>` and use the template
   `.github/PULL_REQUEST_TEMPLATE/release.md`.

   ```bash
   gh pr create --base master --head release/<slug> --title "release: x.y.z, <summary>" --body-file <file>
   ```

8. When the required checks are correct, abucnasty merges the pull request.

## Result

The merge starts `release.yml`. After the tests, the gate shows `release`. The `release` job makes the tag
`v<version>` and the GitHub release, and the `production` job deploys the tag to production. If the sidecar version is
new, the `sidecar` job uploads it to the mod portal. If neither version is new, the `release` job stops with an error.
The `production` and `sidecar` jobs start also when the `tests` job did not start because a pull request passed the tests
on the same files. Check that both jobs ran in the run: a skipped job there is a fault.

## Related information

- [Ship a hotfix](ship-a-hotfix.md)
- [How the site and the sidecar are published](site-and-sidecar-publishing.md)
- [Releasing](../../CONTRIBUTING.md#releasing) in CONTRIBUTING.md
