---
$schema: urn:oasis:names:tc:dita:xsd:task.xsd
id: move-the-site-to-cloudflare
---

# Move the site to Cloudflare

Do this one time: give the workflows access to Cloudflare, deploy the Worker the first time, and send the old address
on Vercel to `https://clock.abucnasty.dev`.

## Before you start

- The pull request that moved the site to Cloudflare is merged into `master`.
- You can create API tokens in the Cloudflare account that has the zone `abucnasty.dev`.
- You can set the secrets of the repository with `gh`, and you have access to the Vercel project of the old address.
- Node.js is installed.

## Procedure

1. In the Cloudflare dashboard, create an API token from the template **Edit Cloudflare Workers**. Give it access to the
   account and to the zone `abucnasty.dev` only.

2. Set the token and the account ID as secrets of the repository.

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

   Each command asks for the value. The account ID is on the overview page of the Cloudflare dashboard.

3. Deploy `master` to the Worker the first time, from a clone of the repository.

   ```bash
   git switch master && git pull
   cd clock-generator-ui
   npm ci
   npm run build
   npx wrangler@4.161.0 login
   npx wrangler@4.161.0 deploy
   ```

   The command makes the Worker `clock-generator`, its DNS record and its certificate on `clock.abucnasty.dev`. Until
   the next release, the new address has `master`. No user goes there yet. From now on, each push to `master` has a
   preview, and `release.yml` can deploy production.

4. Make sure that the site opens.

   ```bash
   curl -sI https://clock.abucnasty.dev/ | head -n 1
   ```

   The first line is `HTTP/2 200`. The certificate can need some minutes.

5. Release a version, as in [Release a version](release-a-version.md). The `production` job deploys it to
   `https://clock.abucnasty.dev`.

6. Tell the users that the site moved. The browser keeps **Your builds** for each address: before step 7, a user can
   open each build at the old address and save it to a file.

7. Deploy the redirect of the old address to Vercel, from a folder that has only `vercel.json`.

   ```bash
   mkdir /tmp/old-address
   cp vercel.json /tmp/old-address/
   cd /tmp/old-address
   touch index.html
   npx vercel@61.1.0 link
   npx vercel@61.1.0 deploy --prod
   ```

   At `vercel link`, select the existing project of `clock-generator-self.vercel.app`. The redirect is temporary (307),
   thus a browser does not keep it: a different deployment can replace it.

8. Make sure that the old address sends the browser to the new address.

   ```bash
   curl -sI https://clock-generator-self.vercel.app/ | grep -i -e '^HTTP' -e '^location'
   ```

   The status is `307` and the location is `https://clock.abucnasty.dev/`.

9. Remove the secrets of Vercel from the repository. The workflows do not use them.

   ```bash
   gh secret delete VERCEL_TOKEN
   gh secret delete VERCEL_ORG_ID
   gh secret delete VERCEL_PROJECT_ID
   ```

## Result

The workflows deploy the site to Cloudflare only. The old address sends each path to the same path at
`https://clock.abucnasty.dev`, and an old shared link opens its build there. Keep the Vercel project: if you delete it,
the old address stops.

The sidecar shows the new address from its next version on. Release it with a new version, then paste
`clock-generator-sidecar/PORTAL.md` into the page of the mod on the mod portal.

## Related information

- [How the site and the sidecar are published](site-and-sidecar-publishing.md)
- [Redeploy the site by hand](redeploy-the-site-by-hand.md)
- [Workflow variables and secrets](workflow-variables-and-secrets.md)
