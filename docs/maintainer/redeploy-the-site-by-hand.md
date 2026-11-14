---
$schema: urn:oasis:names:tc:dita:xsd:task.xsd
id: redeploy-the-site-by-hand
---

# Redeploy the site by hand

Deploy the latest released version to production again. For example, do this after a run of `release.yml` that stopped
before its end.

## Before you start

- The secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set.
- The version to deploy has a GitHub release, and it is the latest GitHub release. You cannot deploy a previous
  version: rollback is not available.
- The latest GitHub release has `clock-generator-ui/wrangler.jsonc`. A version from before the move to Cloudflare
  does not have it, and the `production` job stops with an error.

## Procedure

NOTE: The `production` job runs from `master` only. A start from a different branch does the tests and does not
deploy.

1. Start `release.yml` on `master`.

   ```bash
   gh workflow run release.yml --ref master
   ```

   The workflow does the tests first, with the generation tests. A start by hand never makes a tag or a GitHub release,
   and it does not make a preview deployment. The `production` job deploys the commit of the tag of the latest GitHub
   release.

2. Open the summary of the workflow run.

   The summary shows `Deployed v<version> to production` and the address, `https://clock.abucnasty.dev`.

## Result

The site of the users has the latest released version again.

If a merge of a release stopped before it made the tag, a start by hand does not release it. Start the failed run again
in GitHub (**Re-run failed jobs**).

## Related information

- [How the site and the sidecar are published](site-and-sidecar-publishing.md)
- [Workflow variables and secrets](workflow-variables-and-secrets.md)
- [Move the site to Cloudflare](move-the-site-to-cloudflare.md)
