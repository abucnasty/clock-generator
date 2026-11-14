---
$schema: urn:oasis:names:tc:dita:xsd:task.xsd
id: ship-a-hotfix
---

# Ship a hotfix

Release one fix on the commit that was last deployed (the latest tag), without the changes that `master` has since
then.

## Before you start

- The latest tag exists, and it was made by a release after the pull request that added this route. A push runs the
  workflow file of the pushed commit. A tag that is older does not have the gate.
- The `release.yml` of the latest tag has the `if` lines of the `production` and `sidecar` jobs with `!cancelled()`. A tag
  that is older skips both jobs when the `tests` job did not start because a pull request passed the tests. If the tag
  is older, copy the two `if` lines from `master` into the fix (step 3). Then the merge runs the new lines.
- You can make a branch and a pull request. abucnasty merges both pull requests.

## Procedure

1. Make the branch `hotfix/<version>` from the latest tag. The version is the next patch version. For example, the
   latest tag is `v0.28.1`:

   ```bash
   git push origin v0.28.1:refs/heads/hotfix/0.28.2
   ```

   The push starts `release.yml`. The gate shows `no release`, because the pull request of the commit of the tag is not
   into this branch.

2. Make the branch `fix/<slug>` from `hotfix/<version>`.

3. Make the fix. Set the patch version in `clock-generator/package.json`, `clock-generator-ui/package.json` and their
   `package-lock.json` files. Add the section of the version, with the date, to `CHANGELOG.md`. The entry is under
   Fixed.

4. Do not make the record again, as in step 6 of [Release a version](release-a-version.md). The patch bump moves no
   file in `clock-generator/record/`.

5. Open a pull request into `hotfix/<version>`. Give it the title `hotfix: <version>, <summary>` and use the template
   `.github/PULL_REQUEST_TEMPLATE/change.md`. The Version part has the patch version.

   ```bash
   gh pr create --base hotfix/<version> --head fix/<slug> --title "hotfix: <version>, <summary>" --body-file <file>
   ```

6. When the required checks are correct, abucnasty merges the pull request. The merge releases the commit of the merge.

7. Open a second pull request, from `hotfix/<version>` into `master`, with the title `chore: bring <version> into master`. Resolve the conflicts in this pull request.
   Then abucnasty merges it with a merge commit. This merge releases nothing.

## Result

The merge in step 6 starts `release.yml` on `hotfix/<version>`. After the tests, the gate shows `hotfix`. The `release` job
makes the tag and the GitHub release, and the `production` job deploys the tag to production. If the sidecar version is
new, the `sidecar` job uploads it. These jobs start also when the `tests` job did not start because a pull request passed
the tests on the same files. `master` has the fix and the version after step 7.

## Related information

- [Release a version](release-a-version.md)
- [How the site and the sidecar are published](site-and-sidecar-publishing.md)
- [Releasing](../../CONTRIBUTING.md#releasing) in CONTRIBUTING.md
