# D1 Compact view — deferred scope

Owner feedback: 2026-10-16, after preview approval of tighter Stack size fields.
Status: scoped for the roadmap; implementation deliberately deferred beyond the current queue. No branch, model run or release allocation yet. Revisit after the owner's broader audit.

## Problem and change

The owner reports scroll fatigue, especially on Results: accumulated padding, large controls, repeated labels/helper copy and two header rows leave too little information visible. The version currently appears in App.tsx's footer and requires scrolling.

- Provide an opt-in Compact view, with the current newcomer presentation as the default. Make switching reversible and remember the display preference locally, separate from build/share data.
- Prioritize Results: reduce card/section padding, repeated summary/label blocks, table row height and spacing so more clocks and useful metrics fit in one viewport. Preserve meaningful grouping, units, current selection and stale/warning states.
- Suppress routine explanatory helpers and redundant visible labels where context remains clear. Keep accessible field names/descriptions, visible validation/errors, required assumptions, and help available on demand. Identify the exact removable labels during the later scout; this is not a blanket hide-all rule.
- Reduce the title/workflow header footprint, exploring one compact bar at desktop widths. Keep build identity, Configure/Results, generation status and primary actions accessible. At narrow widths reflow rather than obscure controls or force page scrolling.
- Show the application version without scrolling and retain changelog access, without adding another header row solely for version information.
- Extend density consistently to Configure, forms and dialogs where safe, with Results and header as the first priorities. Preserve keyboard focus visibility, readable text, contrast and usable pointer targets.

## Files to assess later

Provisional, not an implementation prescription: `clock-generator-ui/src/App.tsx` (header/footer/version and preference placement), `components/WorkflowBar.tsx`, `components/ResultSummaryCard.tsx`, Results table/detail components, `hooks/useStickyHeaderHeight.ts`, theme tokens and shared form/section components. Reconcile against the finished3.2/3.3 tree and final original-roadmap audit before selecting APIs or files.

## Acceptance and evidence for the eventual item

- Same build, results and chosen clock survive changing display mode and reloading; the display preference does not alter exports/share links or generation.
- Compare identical Results and Configure states in both modes at1440/960/800/720/390px. Record header height, above-fold content/table rows and scroll distance; show a measured reduction rather than an arbitrary density claim.
- Version is visible before scrolling. Compact mode preserves generation/Cancel/Copy, selected clock, stale/below-target warnings, errors, labels needed to interpret values, help discovery and changelog access.
- Audit keyboard reach, focus not obscured under the shorter sticky header, accessible names/descriptions, contrast, touch/pointer targets and no page sideways scroll. No smaller type solely to conceal a layout issue.
- Independently review code and UX, with normal check/evidence gates. Select models under the then-current owner instructions.

## Decisions intentionally left for later

Exact toggle placement, which redundant labels/helpers to suppress, density metrics, mobile behavior and whether to deliver Results/header first. No prototype or product implementation requested in this session; no change to current phase completion/release scope.
