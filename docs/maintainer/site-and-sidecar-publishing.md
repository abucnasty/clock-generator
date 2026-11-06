---
$schema: urn:oasis:names:tc:dita:xsd:concept.xsd
id: site-and-sidecar-publishing
---

# How the site and the sidecar are published

Two workflows send the clock generator to its users. `release.yml` releases the clock generator and deploys the site
to Vercel. `publish-sidecar.yml` uploads the sidecar to the Factorio mod portal. Each workflow starts the tests of
`test.yml` first. If a test is not correct, the workflow does not release, deploy or upload.

## A push to master

Each push to `master` starts `release.yml`. Its `preview` job deploys `master` as a preview deployment, at a different
address. The summary of the workflow run shows the address. A preview deployment does not change the site of the
users.

## A new version

The clock generator and its UI have one version, in `clock-generator/package.json` and
`clock-generator-ui/package.json`. The two files must show the same version. If they do not, the `release` job stops
with an error.

When a push to `master` has a version that has no GitHub release, `release.yml` does these steps:

1. The `release` job makes the GitHub release `v<version>` and its tag, at the commit of the push. The release notes
   are the section of the version in `CHANGELOG.md`. If that section is not there, the job stops with an error.
2. The `production` job deploys the commit of the tag to production: the site of the users.

A push that does not change the version does not release and does not deploy to production. Thus `master` can have
changes that the site of the users does not have. `release.yml` does one run at a time. Thus two pushes cannot release
or deploy in an incorrect sequence.

## The sidecar

The sidecar has a different version, in `clock-generator-sidecar/info.json`. A push to `master` that changes a file in
`clock-generator-sidecar/` starts `publish-sidecar.yml`. If the mod portal does not have that version, the workflow
makes the zip file of the mod with `clock-generator-sidecar/build.sh`. Then it uploads the zip file. A release of the
clock generator does not upload the sidecar.

The upload contains only the zip file. The long description on the page of the mod is
`clock-generator-sidecar/PORTAL.md`. After a release of the sidecar, paste it into the mod portal by hand.

## Vercel

The git deployments of Vercel are off: `vercel.json` sets `git.deploymentEnabled` to `false`. Thus Vercel does not
deploy `master` or a pull request. Only `release.yml` deploys the site.

## The release hold

When the repository variable `RELEASE_HOLD` is `true` (GitHub ignores the letter case), the workflows do not release,
deploy to production or upload the sidecar. The tests and the preview deployments continue. See [Hold releases](hold-releases.md).

## No rollback

Rollback is not available. A start of `release.yml` by hand deploys the version that `package.json` shows at that
time. The workflow cannot deploy a previous version. Users get a change only in a new version.

## Related information

- [Hold releases](hold-releases.md)
- [Release held work](release-held-work.md)
- [Redeploy the site by hand](redeploy-the-site-by-hand.md)
- [Workflow variables and secrets](workflow-variables-and-secrets.md)
