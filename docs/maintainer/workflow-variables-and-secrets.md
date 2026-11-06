---
$schema: urn:oasis:names:tc:dita:xsd:reference.xsd
id: workflow-variables-and-secrets
---

# Workflow variables and secrets

The variables, secrets and inputs that the workflows in `.github/workflows/` read, and the names of the CI checks.

## Variables, secrets and inputs

| Name | Type | Read by | Values that have an effect | When it is not set |
| --- | --- | --- | --- | --- |
| `RELEASE_HOLD` | Actions variable of the repository | `release.yml`: `release`, `production`. `publish-sidecar.yml`: `publish-sidecar` | `true`: these three jobs do not start, after a push or a start by hand. A different value, for example `yes` or `1`, does not hold releases. The `tests` and `preview` jobs continue. | No hold: the jobs start. |
| `VERCEL_TOKEN` | Secret: a token of the Vercel account | `release.yml`: `production`, `preview` | None | `production` stops with an error. `preview` shows a warning, does not deploy and does not show an error. |
| `VERCEL_ORG_ID` | Secret: from `.vercel/repo.json` or `.vercel/project.json` after `vercel link` | `release.yml`: `production`, `preview` | None | The same as `VERCEL_TOKEN`. |
| `VERCEL_PROJECT_ID` | Secret: from `.vercel/repo.json` or `.vercel/project.json` after `vercel link` | `release.yml`: `production`, `preview` | None | The same as `VERCEL_TOKEN`. |
| `FACTORIO_MOD_API_KEY` | Secret of the `mod-portal` environment | `publish-sidecar.yml`: `publish-sidecar`, step "Upload to the mod portal" | None | The upload step stops with an error. The step starts only when the mod portal does not have the version of the sidecar. |
| `GITHUB_TOKEN` | Secret that GitHub Actions gives to each run | `release.yml`: `release`, as `GH_TOKEN`, with the permission `contents: write` | None | Not possible: GitHub Actions always sets it. |
| `generation` | Input of `test.yml`: `true` or `false` | `test.yml`: `changes` (Changed files), `generation` (Gen summary) | `true`: the generation tests start, also when the changes are only documentation. `release.yml` gives `true`. `publish-sidecar.yml` gives `false`. | A start of `test.yml` by hand: `true`. A start from a different workflow: `false`. A pull request has no input: see the checks. |

## CI checks

The check names are the `name` values of the jobs in `test.yml`.

| Check | Tests | When it starts |
| --- | --- | --- |
| Changed files | Finds if a pull request changes only documentation: Markdown files, `docs/` and `clock-generator/docs/` | Pull requests to `master`, `feature/` or `release/`, and runs with `generation` set to `true` |
| Unit tests | knip, type check, `npm run build`, lint and `npm test` in `clock-generator` | Each run. Not when Changed files finds only documentation. |
| Docs checks | `PORTAL.md` and the configuration file fields topic agree with their sources. The bold labels of the user topics are correct. | Each run |
| Gen 1/2, Gen 2/2 | The generation tests, in two shards | When Changed files finds changes that are not documentation, and the pull request is not a draft |
| Gen summary | The result of the Gen shards | Pull requests to `master`, `feature/` or `release/`, and runs with `generation` set to `true`. Correct when the changes are only documentation. |
| Rec 1/6 to Rec 6/6 | The blast jobs, in six shards | Pull requests only, when Changed files finds changes that are not documentation, and the pull request is not a draft |
| Rec summary | Compares the jobs with the record in `clock-generator/record/` | Pull requests to `master`, `feature/` or `release/` only. Correct when the changes are only documentation. |
| UI build | Lint, icons and the unit tests of the UI | Each run. Not when Changed files finds only documentation. |
| UI samples | The UI tests that make the clock of each sample | Each run. Not when Changed files finds only documentation. |
| UI browser | **Generate** in headless Chromium, on the development server and on the production files | Each run. Not when Changed files finds only documentation. |

### Drafts

A draft pull request does not start the heavy tests: the Gen shards and the Rec shards. On a draft, Gen summary and
Rec summary start and stop with the error "not run on a draft". To start the generation tests on the branch of a
draft, type this command:

```bash
gh workflow run test.yml --ref <branch>
```

That run does not include the Rec shards: they start only on a pull request. When the pull request is not a draft, all
the checks start.

## Related information

- [How the site and the sidecar are published](site-and-sidecar-publishing.md)
- [The CI jobs](../../CONTRIBUTING.md#the-ci-jobs) in CONTRIBUTING.md
