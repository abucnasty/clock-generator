# D9 Independent UX-added UI test audit and actual cleanup
Findings: owner D9 B; hard feature→master requirement · Implementer model: gpt-6.1-sol/high, fast off · Branch: feat/ux-rework-p4-ui-test-cleanup (phase label flexible)

## Change
- Independently attribute/audit only UX-rework-added `clock-generator-ui` test files/cases and implement justified consolidation/removal.
- Preserve meaningful regression behavior while reducing unnecessary additions in final feature diff; deliver actual diff and before/after evidence.
- Reconcile later Phase 4/subsequent UX test additions before final owner master merge. A report or future issue does not satisfy D9.

## Files
- Eligible scope determined by independent attribution inventory: `clock-generator-ui/src/**/*.test.{ts,tsx}` and UI test setup/helpers only as needed to assess eligible added cases. No guessed blanket file-deletion list in advance of independent audit.
- Evidence only: `docs/ux-rework/review/D9/INVENTORY.md` (case/group/source attribution), `DECISIONS.md`, `EVIDENCE.md`; actual cleanup touches only justified eligible UI tests/helpers. Keep report compact and link supporting ledger once.
- Baseline candidate found read-only: UX plan introduced at `f934af689050a97015b92e1cbef596619beb2e82` with parent `cd1666bba8abfd47d534055aa3197624f4113632`. Independent auditor must confirm this is before **all** UX product/test additions using Git/PR history, and separate subsequent upstream integrations. Do not use today's master merge-base as sole attribution: upstream was integrated repeatedly.

## Acceptance criteria
- [ ] Fresh auditor did not author assessed tests. Inventory eligible new files and new case/groups within existing files, source commit/PR and behavior protected; mark preexisting/upstream/unrelated cases excluded even if surrounding file changed. Include Phase 4 and any later UX additions before release.
- [ ] Each coherent eligible group receives keep/consolidate/remove with concrete file/case refs, actual failure/contract protected, overlap and maintenance cost. Counts alone do not justify removal. Past bug-catching cases require specific explanation before removal and named remaining protection where appropriate.
- [ ] Preserve meaningful state/race/cancellation/freshness, data-loss, Undo, persistence/share/cache, exact arithmetic/unit boundaries, accessibility/focus and cross-component contracts. Consolidation retains necessary scenarios/assertions; do not delete preexisting/upstream tests or reduce assertions simply to pass. Exclude engine tests, docs browser captures and unrelated test infrastructure.
- [ ] Implement justified decisions in actual reviewable cleanup diff, not just a report. Show before/after eligible groups/cases, total UI executed tests/files, net UX-added files and lines against attributed pre-rework baseline, and remaining-coverage mapping. Do not chase removal percentage or arbitrary coverage target. If no defensible reduction exists, root escalates specific evidence to owner; cannot mark hard requirement complete or defer past release.
- [ ] Comparable local runtime uses same exact source/dependencies/engine/build environment apart from cleanup, command, runner settings and available cache conditions; preserve actual per-run result/time. Use bounded repeats only if needed to interpret noisy result. Report UI case/file workload change separately from measured runtime. CI durations compare like job/workflow/environment where available; skipped/unavailable data explicit. No promise that fewer tests prove faster CI.
- [ ] No new framework/dependencies, blanket replacement mocks, CI workflow/config change or exclusion tricks. Full existing UI gates remain, root independently repeats test/build, code+UX review, exact-head CI and all three phase-end reviewers retained. Docs-only audit stage is not a gate waiver for cleanup implementation.
- [ ] Cleanup lands in feature before feature→master, independent review PASS; scan every later UX UI test addition against decisions and integrate justified cleanup before final PR. Final PR links actual reduction/remaining coverage. Mark complete only after implemented evidence and final reconciliation, regardless of phase numbering.

## Tests
This is the test cleanup itself. Default is fewer/consolidated eligible tests, not new cases. A replacement case is justified only if it preserves a meaningful uncovered behavior more simply; state what removed cases it supersedes. Do not change preexisting cases as collateral cleanup. Keep all required full checks.

## Screens to capture
No product change expected; root independently checks cleanup diff contains only allowed tests/helpers/evidence. Reuse exact-source product captures where product tree unchanged. If audit exposes product changes needed, route separate scope instead of silently fixing here. Normal phase-end fresh four-width capture/three reviewers still happen; no arbitrary screenshots of unchanged UI to substitute for tests/CI evidence.

## Risks and checkpoints
D9 independence applies to assessed authorship; a worker may need to exclude its own previous tests or use another fresh reviewer for those groups. History attribution is essential; line-count reduction cannot justify deleting upstream coverage. Effective-immediate discipline applies throughout Phase 4, so no knowingly arbitrary tests now with promise of later cleanup. Hard owner release requirement cannot be waived by this spec or phase scheduling.

## Root adoption after first cleanup default-knip probe

Removing test-only consumers exposed exactly two internal exports with no remaining production caller: SURFACE_HOVER in UI theme/tokens.ts and WakeWindowsChartProps in components/WakeWindowsChart.tsx. D9 may make only these declarations module-private by removing export; values, types and runtime output stay identical. This narrow dead-export cleanup is included in CODE/UX review and full gates, with no exclusion or dummy test consumer. No other product change is authorized by this addendum. Production-equivalence evidence must separately account for these visibility-only lines and compare emitted assets.

## Root adoption after integrated theme/cleanup default-knip probe

At integrated before-source 9d88162, the mode-aware chart palette replaces the fixed WAKE_SELECTED_COLOR and SLACK_BACKGROUND constants in components/WakeWindowsChart.tsx; C20 removes their last raw-source-scanner consumer. Root authorizes deleting exactly these two dead declarations and their orphan comments after confirming no remaining repository caller. Retain live bar/track exports, forced-colour constants and all runtime palette values. No dummy consumer, exclusion or further cleanup is allowed. Full functional gates and emitted-asset equivalence must cover this integration-only deletion; the current owner-adopted keyboard/colour profile governs product evidence.
