---
$schema: urn:oasis:names:tc:dita:xsd:concept.xsd
id: site-and-sidecar-publishing
---

# How the site and the sidecar are published

Two workflows send the clock generator to its users. `release.yml` releases the clock generator and deploys the site
to Cloudflare, at <https://clock.abucnasty.dev>. It also calls `publish-sidecar.yml`, which uploads the sidecar to the Factorio mod portal. `release.yml`
starts the tests of `test.yml` first, unless a pull request already passed them on the same files (see
[Tests that a pull request already passed](#tests-that-a-pull-request-already-passed)). If a test is not correct, the
workflow does not release, deploy or upload.

## A push to master

Each push to `master` starts `release.yml`. Its `preview` job uploads `master` as a version of the Worker that is not
deployed, with `wrangler versions upload --preview-alias master`. Its address is
`master-clock-generator.<account subdomain>.workers.dev`, and the summary of the workflow run shows it. A preview does
not change the site of the users. The UAT of a release uses this address.

## Tests that a pull request already passed

The `tests` job of `release.yml` takes about 6.5 minutes, and the `test.yml` run of the pull request usually tested the
same files. To save the time, each run of `test.yml` on a pull request uploads a small artifact. Its name is
`tested-tree-<tree>`, where `<tree>` is the Git tree of the merge commit that the run tested. The artifact stays for 14
days. The `lookup` job of `release.yml` starts first. It runs `.github/scripts/tested-tree.sh`, which gets the tree of the
pushed commit and looks for an artifact with that name. The script accepts the artifact only if all these are true:

- The artifact has not expired.
- Its workflow run is `.github/workflows/test.yml`, on the event `pull_request`, and it ended with success.
- The head repository of the run is this repository. A pull request from a fork can change the workflow and upload a
  false artifact, so the script does not trust it.

A run that skipped the generation or record tests because the pull request changed documentation only is accepted. The
pull request passed under that rule. The script shows `tested` or `not tested` with the reason in the summary of the
`lookup` job.

If the tree is tested, the `tests` job does not start. The `release` and `preview` jobs start when the tests passed, or
when they did not start because the tree is tested. They do not start when the tests failed or were cancelled. If the
script finds no artifact, or cannot read GitHub, the tests run as before.

The tree of a squash merge is the same as the tree of the merge commit of the pull request only when `master` did not
change after that run. If `master` changed, bring the branch up to date, wait for the new run of `test.yml`, and then
merge. A start of `release.yml` by hand does no lookup, and its tests always run.

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

## Cloudflare

The site is the Cloudflare Worker `clock-generator`. It has no code: it serves the files of `npm run build` in
`clock-generator-ui/dist` as static assets. Its configuration is `clock-generator-ui/wrangler.jsonc`. The custom domain
`clock.abucnasty.dev` is on the zone `abucnasty.dev` of the same Cloudflare account. The Worker has no `workers.dev`
address. Only `release.yml` deploys the site: Cloudflare does not deploy from git.

The site has one page, `/`. A shared build is in the hash of the address, thus an unknown path gets the status 404.
`clock-generator-ui/public/_headers` gives the files in `/assets/` a cache time of one year, because Vite puts a hash of
the content in their names. All other files, `index.html` too, keep the default of Cloudflare: the browser asks for
each change.

## The old address

Up to 0.28.1, the site was on Vercel, at `https://clock-generator-self.vercel.app`. Blueprints from those versions and
the sidecar 0.15.1 and older show that address. The workflows do not deploy to Vercel. `vercel.json` has only a redirect
of each path at the old address to the same path at the new address, and a manual deployment puts it on Vercel (see
[Move the site to Cloudflare](move-the-site-to-cloudflare.md)). A browser keeps the hash of the address through a
redirect, thus an old shared link opens its build at the new address.

The browser keeps **Your builds** and the settings for each address. The builds that a user saved at the old address do
not move to the new address.

## No rollback

Rollback is not available. A start of `release.yml` by hand deploys the latest released tag again. It cannot deploy a
previous version. Users get a change only in a new version.

## Related information

- [Release a version](release-a-version.md)
- [Ship a hotfix](ship-a-hotfix.md)
- [Redeploy the site by hand](redeploy-the-site-by-hand.md)
- [Move the site to Cloudflare](move-the-site-to-cloudflare.md)
- [Workflow variables and secrets](workflow-variables-and-secrets.md)
