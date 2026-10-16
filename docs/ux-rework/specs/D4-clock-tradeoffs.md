# D4 Clock recommendations and tradeoffs — approved Phase 4 scope

Owner approval, 2026-10-16: A / A / A. Phase 4 targets `feat/ux-rework`. This is approved presentation scope; final item spec and normal evidence/reviews precede implementation.

## Approved behavior

- Group comparison by “Matches your belt setting” and “Requires a different belt setting,” based on the actual build/result assumptions. Keep alternative clocks inspectable and selectable under existing rules; show their conditions visibly.
- Place one concise recommendation reason or selected-clock tradeoff beside the selected clock. Deeper ranking explanations and metric breakdowns remain available on demand, coordinated with D1's contextual area.
- Apply the same semantic improvements in both explanatory and Compact views, adapted to the layout.
- Reuse current recommendation/ranking logic and existing selected-clock explanations. No ranking, engine arithmetic, optimization-objective or selection-rule change is implied.

## Interpretation and evidence

- Derive deltas and reasons from the actual result and existing authoritative metrics. Keep wake-ups distinct from wake windows, achieved from requested rate, and one-copy from all-Copies values. Do not claim measured net UPS savings from wake-up differences.
- Keep rate, recovery and belt warnings visible where needed. A matching-belt group must not imply that separate target/recovery checks passed. Preserve fallback and below-target behavior.
- Preserve the recommendation marker, current selection, Generate/Cancel/Copy and conditional alternatives. Finalize group labels and edge cases against the finished Phase 3 implementation.
- Verify representative compatible/conditional choices, selected-alternative explanations and preserved ranking in both density modes and responsive layouts. Use normal checks and independent code/UX review; retain all three phase-end reviewers.


## Finalized initial implementation slice

# D4 Belt groups and actual clock tradeoffs — refreshed draft

Approved A/A/A plus owner-approved 0.16 factual refinements. This bundle compacts and organizes accepted compatibility behavior; it does not postpone semantic fixes from compatibility acceptance. Keep D4's own ledger/evidence.

## Sources and boundary

UI `utils/recommendedClock.ts` owns `recommendedIndexOf`, `recommendationReason`, `partitionClockRows`, pick-rule text; `utils/clockSummary.ts` owns names, comparison status, selected differences and units; `utils/rateWarning.ts` owns warnings/Copy status. Consumers are ClockAlternativesPanel, ResultSummaryCard, ResultsWorkspace, WorkflowBar and glossary/Terms. Recheck their accepted compatibility versions, not the old verdict shortcuts in Phase3.

Frozen upstream `clock-generator/src/crafting/trial.ts` defines ClockAssessment/clockVerdictOf; `start-dependence.ts` defines actual StartOutcome[]; `alternatives.ts` creates dynamic lean tasks and candidate-local assessment, period/windows, description/insights. These are evidence/providers, not authorized engine edit targets. Use accepted worker views; no second ranking/facts/simulation provider.

## Acceptance

- [ ] Visible primary groups are exactly “Matches your belt setting” and “Requires a different belt setting”, based on saved candidate `ranking.matches_belt_choice`, never live edited form. Omit empty headings; a sole group still names compatibility. No-belt semantics retain existing pick-rule meaning.
- [ ] Preserve existing global partition eligibility, selected/recommended exceptions, pinned IDs, unstable disclosure and original indexes before grouping visible rows by belt. Within each belt group keep existing stable/other order and settled recommendation precedence. While running, rows do not jump as recommendation changes. Pending tasks remain unclassified until actual ranking arrives. Grouping must not accidentally reveal/hide rows by recomputing `anyStable` independently per belt group.
- [ ] Every onSelect index remains the original alternatives-array index; underlying array, recommendedIndexOf/ranking, selection/manual choice and restored selection rules are unchanged. Conditional or unstable selected/recommended rows remain reachable/visible. Table rowgroup headings and native radio selection preserve reading/keyboard order.
- [ ] One concise reason/tradeoff uses accepted recommendationReason/differenceFromRecommended facts, with deeper metrics in Why. A belt match is independent of rate, hold, loss recovery and sampled start status. Selected card/table/Copy/glossary remain consistent; no compatibility warning becomes accessible only in a closed panel.
- [ ] Start-dependent means “Depends on how it is started”; actual `assessment.items_per_second`, rate delta, `holds`, `backpressure_loss` and `start_dependence.starts` remain distinct. Equal 480/s requested/achieved never becomes a “480 of 480” shortfall solely from top-level unstable or meets_target_rate=false. Actual recovery is Yes/No from the loss verdict or unavailable/not tested when null, not inferred from top-level unstable. Do not prescribe a universal reset/install procedure or add consent.
- [ ] Extended-start details enumerate actual labels/outcomes/counts, including unavailable values; no hard-coded sample count. These are empty-start phase/order trials, not filled/free-running starts. Existing clock-phase checks remain distinct. Partial generation cannot imply every candidate/check finished.
- [ ] Lean/shorter-period choices retain dynamic IDs/tasks and long labels. Show actual selected period, existing achieved rate/recovery/wake-ups and relevant candidate description: the ingredient omitted from period calculation still has clocked inserters. Never reuse manual Exclude-from-LCM→Always wording or change form exclusions/enable rules upon selection. Candidate facts come from that candidate, not the primary plan or global overrides guessed to describe its effective lean plan.
- [ ] Output is /s across actual Copies; wake-ups/minute describes one modeled unit. Wake windows differ from wake-ups; unknown metrics stay unknown. No claim of measured UPS savings or changed optimization objective. Preserve no-compatible/no-stable/nearest-target/no-recovery/deadlock/provisional/stopped and all-columns paths in both densities.

Exact proposed indexed grouping export is in `API-DEPENDENCY-NOTE.md`. Extend existing recommendedClock tests only if original-index/group preservation lacks protection; reuse compatibility's meaningful equal-rate/start-dependent/recovery case and existing recommendation/units tests. Common native evidence covers mixed groups, conditional selection, below-target matching clock, unstable disclosure, pending→settled, lean labels and stale original belt facts in both densities. Do not duplicate engine lean/start mechanics in UI tests.

### Observed D3 baseline refinements within approved factual scope
Baseline B selected216.061381/s for216 requested has assessment.holds=true yet warning says “does not hold the target rate”; separate numerical mismatch from actual holds in player-facing warnings. Say the output rate differs when that is the actual fact; do not infer holdsfalse or modify engine tolerances/rank. Both selected baseline clocks carry ranking.matches_belt_choice=true and beltLabelnon-moving while saved run settingMoving; preserve authoritative raw fields and make their distinct meaning understandable, without inferring a new mechanical compatibility rule. Current baseline evidence retains these exactlabels.
