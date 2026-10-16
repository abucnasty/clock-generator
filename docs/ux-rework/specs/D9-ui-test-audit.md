# D9 Independent audit of new UI tests — deferred

Owner request and scope correction, 2026-10-16. Audit only tests added by this UX rework inside
`clock-generator-ui`. This is a deferred roadmap item; no test deletion or audit run is scheduled in the current queue.
Current review and verification requirements, including all three phase-end reviewers, remain unchanged.

## Scope

- Include newly added UI test files and new cases added to existing UI test files by this project. Inspect associated
  test setup/helpers only where needed to assess those additions.
- Establish the pre-rework baseline from Git/PR history before auditing. Distinguish our additions from upstream
  tests inherited during integration; a changed file does not make every existing case eligible for removal.
- Exclude engine tests, browser capture scripts under `docs/ux-rework/capture`, pre-existing UI cases and unrelated
  upstream additions. This audit does not propose changes to their requirements or coverage.

## Independent assessment and removal proposal

Use a fresh reviewer who did not author the tests being assessed. Inventory each eligible test or coherent group
by behavior protected, source change, distinct failure caught, overlap and maintenance cost. Assess duplication,
assertions that merely repeat implementation, brittle internal coupling, excessive permutations and tests of
low-impact presentation details. A large count alone is not evidence that a test is unnecessary.

Return concrete **keep / consolidate / remove** recommendations with file/case references, rationale and the
remaining test that protects the same behavior where applicable. Preserve meaningful regression coverage for
state/race handling, data loss, Undo, persistence, arithmetic boundaries, accessibility behavior and cross-component
contracts; a past bug-catching test needs a specific explanation before removal. Prefer fewer well-chosen cases
when they protect the same contract. Do not introduce a replacement test framework, blanket mocks or new dependencies.

The deliverable is a reviewable cleanup proposal with the eligible baseline, candidate diff, remaining behavioral
coverage, test-count change and measured test-runtime change where useful. Any removal/consolidation follows the
later approved scope and normal independent review/checks. Do not chase an arbitrary percentage reduction or weaken
assertions solely to make checks pass. This item adds no release gate to the current roadmap.
