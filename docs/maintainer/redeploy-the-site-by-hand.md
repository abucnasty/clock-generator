---
$schema: urn:oasis:names:tc:dita:xsd:task.xsd
id: redeploy-the-site-by-hand
---

# Redeploy the site by hand

Deploy the version of `master` to production again. For example, do this after a run of `release.yml` that stopped
before its end.

## Before you start

- `RELEASE_HOLD` is not `true`, `True` or `TRUE`. If it is, the `production` job does not start.
- The secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are set.
- The version in `package.json` on `master` is the version to deploy. You cannot deploy a previous version: rollback
  is not available.

## Procedure

NOTE: The workflow publishes only from `master`. A start from a different branch does the tests and does not
release or deploy.

1. Start `release.yml` on `master`.

   ```bash
   gh workflow run release.yml --ref master
   ```

   The workflow does the tests first, with the generation tests. If the version has no GitHub release, the `release`
   job makes it. Then the `production` job deploys the commit of the tag `v<version>`. A start by hand does not make a
   preview deployment.

2. Open the summary of the workflow run.

   The summary shows `Deployed v<version> to production` and the address.

## Result

The site of the users has the version of `master` again.

## Related information

- [How the site and the sidecar are published](site-and-sidecar-publishing.md)
- [Workflow variables and secrets](workflow-variables-and-secrets.md)
