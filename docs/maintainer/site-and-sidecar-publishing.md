---
$schema: urn:oasis:names:tc:dita:xsd:concept.xsd
id: site-and-sidecar-publishing
---

# How the site and the sidecar are published

Two workflows send the clock generator to its users. `release.yml` releases the clock generator and deploys the site
to Vercel. It also calls `publish-sidecar.yml`, which uploads the sidecar to the Factorio mod portal. `release.yml`
starts the tests of `test.yml` first. If a test is not correct, the workflow does not release, deploy or upload.

## A push to master

Each push to `master` starts `release.yml`. Its `preview` job deploys `master` as a preview deployment, at a different
address. The summary of the workflow run shows the address. A preview deployment does not change the site of the
users. The UAT of a release uses this address.

## Which merges release

Only two merges release the clock generator, deploy the site to production and upload the sidecar:

- A **release pull request**: into `master`, from a branch `release/<slug>`, with the title type `release:`.
- A **hotfix pull request**: into a branch `hotfix/<version>`, from a branch of the repository, with the title type
  `hotfix:`. A hotfix ships one fix on the commit that was last deployed, without the changes that `master` has since
  then.

`release.yml` also runs for each push to a branch `hotfix/<version>`. After the tests, the `release` job starts the gate
`.github/scripts/release-gate.sh`. The gate finds the pull request behind the pushed commit. It must be merged, and its
merge commit must be the pushed commit. Its branch must be in the repository, and its base must be the pushed branch. If
the pull request is not a release or hotfix pull request, the gate shows `no release` and the workflow ends with success.
Thus a plain merge to `master` has a preview deployment and no release. A pull request that is open, a name of a branch
and a title that someone edits do not release. Only a merge releases.

The base of the pull request must be the pushed branch. When you make the branch `hotfix/<version>` from a tag, GitHub
pushes the commit of the tag. The pull request of that commit is the release pull request into `master`. The gate
does not use it.

## A new version

The clock generator and its UI have one version, in `clock-generator/package.json` and
`clock-generator-ui/package.json`. The two files must show the same version. If they do not, the `release` job stops
with an error.

When the gate shows a release or a hotfix, and the version has no GitHub release, `release.yml` does these steps:

1. The `release` job makes the GitHub release `v<version>` and its tag, at the commit of the push. The release notes
   are the section of the version in `CHANGELOG.md`. If that section is not there, the `release` job stops with an error.
2. The `production` job deploys the commit of the tag to production: the site of the users.

If neither the version of the clock generator nor the version of the sidecar is new, the `release` job stops with an
error that gives the two versions. Such a merge releases nothing.

`release.yml` does one run at a time. Thus two pushes cannot release or deploy in an incorrect sequence.

## The sidecar

The sidecar has a different version, in `clock-generator-sidecar/info.json`. When the gate shows a release or a hotfix,
and the mod portal does not have that version, the `sidecar` job of `release.yml` starts `publish-sidecar.yml`. The
workflow makes the zip file of the mod with `clock-generator-sidecar/build.sh`. Then it uploads the zip file. A release
can have a new version of the clock generator, a new version of the sidecar, or both. A merge to the folder of the sidecar
that is not a release or a hotfix does not upload it. The tests of the release also cover the sidecar.

The upload contains only the zip file. The long description on the page of the mod is
`clock-generator-sidecar/PORTAL.md`. After a release of the sidecar, paste it into the mod portal by hand.

## Vercel

The git deployments of Vercel are off: `vercel.json` sets `git.deploymentEnabled` to `false`. Thus Vercel does not
deploy `master` or a pull request. Only `release.yml` deploys the site.

## No rollback

Rollback is not available. A start of `release.yml` by hand deploys the latest released tag again. It cannot deploy a
previous version. Users get a change only in a new version.

## Related information

- [Release a version](release-a-version.md)
- [Ship a hotfix](ship-a-hotfix.md)
- [Redeploy the site by hand](redeploy-the-site-by-hand.md)
- [Workflow variables and secrets](workflow-variables-and-secrets.md)
