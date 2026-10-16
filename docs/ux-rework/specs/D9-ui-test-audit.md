# D9 Independent audit and cleanup of new UI tests — mandatory before final merge

Owner request and scope correction, 2026-10-16. Audit only tests added by this UX rework inside
`clock-generator-ui`. Owner now approves audit PLUS implemented cleanup (choice B), assigned to Phase 4 with
flexible phase numbering. It must reduce unnecessary test additions in the final feature diff before
`feat/ux-rework` merges to `master`; a proposal alone or a post-release issue does not satisfy the requirement.
Current review and verification requirements, including all three phase-end reviewers, remain unchanged.

## Effective immediately: necessary tests only

- New tests must protect meaningful behavior or a concrete regression. Do not add or commit arbitrary cases,
  implementation-mirroring assertions or permutations to maximize coverage numbers.
- Reuse existing behavioral coverage where sufficient. Code review checks whether each new test/group is needed,
  not merely whether it passes. This does not remove existing required verification or authorize weakening checks.
- Apply this discipline throughout remaining UX work; cleanup is not a reason to knowingly accumulate avoidable tests first.

## Scope

- Include newly added UI test files and new cases added to existing UI test files by this project. Inspect associated
  test setup/helpers only where needed to assess those additions. Include Phase 4 and subsequent UX additions
  before the final feature merge, not only Phases 1–3.
- Establish the pre-rework baseline from Git/PR history before auditing. Distinguish our additions from upstream
  tests inherited during integration; a changed file does not make every existing case eligible for removal.
- Exclude engine tests, browser capture scripts under `docs/ux-rework/capture`, pre-existing UI cases and unrelated
  upstream additions. This audit does not propose changes to their requirements or coverage.

## Independent assessment and implemented cleanup

Use a fresh reviewer who did not author the tests being assessed. Inventory each eligible test or coherent group
by behavior protected, source change, distinct failure caught, overlap and maintenance cost. Assess duplication,
assertions that merely repeat implementation, brittle internal coupling, excessive permutations and tests of
low-impact presentation details. A large count alone is not evidence that a test is unnecessary.

Return concrete **keep / consolidate / remove** recommendations with file/case references, rationale and the
remaining test that protects the same behavior where applicable. Preserve meaningful regression coverage for
state/race handling, data loss, Undo, persistence, arithmetic boundaries, accessibility behavior and cross-component
contracts; a past bug-catching test needs a specific explanation before removal. Prefer fewer well-chosen cases
when they protect the same contract. Do not introduce a replacement test framework, blanket mocks or new dependencies.

The deliverable includes the eligible baseline, concrete keep/consolidate/remove decisions and an implemented,
independently reviewed cleanup diff. Record remaining behavioral coverage, before/after test counts and net added
test files/lines versus the attributed UX baseline; measure comparable test-runtime changes and CI job durations
where available, distinguishing measured results from workload proxies. Do not claim that fewer tests alone prove
faster CI. Do not chase an arbitrary removal percentage or weaken assertions solely to make checks pass.

## Hard delivery requirement

- Plan the broad cleanup after Phase 4 product changes settle and before final reviews where practical, then
  reconcile any subsequent UI test additions. Timing/phase numbering is flexible; a separate cleanup phase is allowed
  if needed, but the cleanup must land in `feat/ux-rework` before its merge to `master`.
- Actual justified removal/consolidation is required, with a concise reviewable diff and measured scope reduction.
  Do not close D9 on an audit report alone or defer it beyond release as an issue. If the reviewer finds no defensible
  reduction, escalate the specific evidence to the owner rather than silently waive the hard requirement.
- Keep the normal independent reviews/checks and all three phase-end reviewers. No replacement test framework,
  new dependencies or CI configuration changes are authorized by this scope.
