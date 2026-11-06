---
$schema: urn:oasis:names:tc:dita:xsd:task.xsd
id: hold-releases
---

# Hold releases

Merge work into `master` without a release. The workflows do not release the clock generator, do not deploy the site
to production and do not upload the sidecar. The tests and the preview deployments of `master` continue.

> Agents: do not clear the hold or start a workflow to go around it.

## Before you start

- The work to hold is not on `master`.
- You can change the Actions variables of the repository.

## Procedure

1. Set the repository Actions variable `RELEASE_HOLD` to `true`. Only the value `true` holds releases.

   ```bash
   gh variable set RELEASE_HOLD --body true
   ```

   The `release`, `production` and `publish-sidecar` jobs do not start. This applies to pushes and to starts by hand.

2. Use the next version of the clock generator only for the held work. Keep the versions of `clock-generator` and
   `clock-generator-ui` the same, in their `package.json` and `package-lock.json` files.

3. Use the next version of the sidecar only for the held work. Keep these at that version: `info.json`, the newest
   entry of `changelog.txt`, `LATEST_SIDECAR_VERSION`, the feature version checks and the documentation.

4. Merge the held work. Put each changelog entry in the section of the held version, without a date. Do not add a
   version for each change.

   In the **Version** part of each pull request, write `bundled: #<pull request>`: the pull request that has the
   version change.

## Result

The held work is on `master` and in the preview deployments. Users do not get it before the release. The released
versions and their GitHub release notes do not change.

The hold is not a rollback. When `RELEASE_HOLD` is not `true`, the next run of a workflow can release the versions on
`master`.

## Related information

- [Release held work](release-held-work.md)
- [Release hold for unreleased merges](../../CONTRIBUTING.md#release-hold-for-unreleased-merges) in CONTRIBUTING.md
- [Workflow variables and secrets](workflow-variables-and-secrets.md)
