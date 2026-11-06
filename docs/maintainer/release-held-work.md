---
$schema: urn:oasis:names:tc:dita:xsd:task.xsd
id: release-held-work
---

# Release held work

Release the work that you merged while `RELEASE_HOLD` was `true`: the clock generator, the site and the sidecar.

> Agents: do not clear the hold or start a workflow to go around it.

## Before you start

- `RELEASE_HOLD` is `true`, and the held work is on `master`.
- The release is approved. While the hold is on, the release waits for this approval.

## Procedure

1. Complete the changelogs. In `CHANGELOG.md` and in `clock-generator-sidecar/changelog.txt`, write the date and the
   summary of the held version.

2. Do the release checks.

3. Set the repository Actions variable `RELEASE_HOLD` to `false`.

   ```bash
   gh variable set RELEASE_HOLD --body false
   ```

   No workflow starts. A change of the variable does not start a workflow.

CAUTION: Start the workflow only from the `master` branch. A start from a different branch can release and deploy that
branch. Issue [#657](https://github.com/abucnasty/clock-generator/issues/657) records this problem.

4. Start `release.yml` on `master`.

   ```bash
   gh workflow run release.yml --ref master
   ```

   The workflow does the tests first. Then the `release` job makes the GitHub release of the held version and its tag.
   The `production` job deploys the tag to production.

CAUTION: Start the workflow only from the `master` branch. A start from a different branch can upload the sidecar of
that branch. Issue [#657](https://github.com/abucnasty/clock-generator/issues/657) records this problem.

5. Start `publish-sidecar.yml` on `master`. A push starts it only when the push changes `clock-generator-sidecar/`.

   ```bash
   gh workflow run publish-sidecar.yml --ref master
   ```

   The workflow does the tests first. Then, if the mod portal does not have the held version of the sidecar, it uploads
   it. The `mod-portal` environment can stop the upload until it gets an approval.

6. Paste the text of `clock-generator-sidecar/PORTAL.md` into the long description of the mod on the mod portal.

## Result

The held versions are released. The GitHub release is there, the site of the users has the new version, and the mod
portal has the new sidecar. The summary of each workflow run shows the release, the deployment or the upload.

## Related information

- [Hold releases](hold-releases.md)
- [Release hold for unreleased merges](../../CONTRIBUTING.md#release-hold-for-unreleased-merges) in CONTRIBUTING.md
- [How the site and the sidecar are published](site-and-sidecar-publishing.md)
