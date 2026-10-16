# D1 Compact view — approved Phase 4 scope

Owner feedback: 2026-10-16, after preview approval of tighter Stack size fields.
Status: approved for Phase 4 against `feat/ux-rework`, 2026-10-16. Owner selected B / A / A: Results/header first and Configure second; explanatory default with remembered opt-in Compact; comparison visible with one contextual Why/Wake/Install area and routine helpers collapsed. See [decision record](phase4-decisions.md). Final item specs and all normal review/verification gates remain required; no product implementation has started.

## Problem and change

The owner reports scroll fatigue, especially on Results: accumulated padding, large controls, repeated labels/helper copy and two header rows leave too little information visible. The version currently appears in App.tsx's footer and requires scrolling.

- Provide an opt-in Compact view, with the current newcomer presentation as the default. Make switching reversible and remember the display preference locally, separate from build/share data.
- Prioritize Results: reduce card/section padding, repeated summary/label blocks, table row height and spacing so more clocks and useful metrics fit in one viewport. Preserve meaningful grouping, units, current selection and stale/warning states.
- Keep comparison visible with one contextual area for Why, Wake and Install; open only the selected detail and preserve full guidance on demand. Keep essential units, assumptions, errors and stale/below-target/belt warnings visible wherever needed to interpret results.
- Suppress routine explanatory helpers and redundant visible labels where context remains clear. Keep accessible field names/descriptions, visible validation/errors, required assumptions, and help available on demand. Identify the exact removable labels during the later scout; this is not a blanket hide-all rule.
- Reduce the title/workflow header footprint, exploring one compact bar at desktop widths. Keep build identity, Configure/Results, generation status and primary actions accessible. At narrow widths reflow rather than obscure controls or force page scrolling.
- Show the application version without scrolling and retain changelog access, without adding another header row solely for version information.
- Extend density consistently to Configure, forms and dialogs where safe, with Results and header as the first priorities. Preserve keyboard focus visibility, readable text, contrast and usable pointer targets.

## Wider-screen composition — approved direction; responsive details to finalize

The owner asked whether wide screens warrant a different layout. Explore composition separately from density: Compact changes spacing and routine copy; available width determines whether related views can sit together. Either density should work in the appropriate responsive layout.

- Results candidate: a dense clock-selection/comparison table beside a selected-clock detail area containing metrics, warnings and timelines. Keep selection visible while inspecting details; avoid stacking every card into a long page or duplicating summary information across panels.
- Configure candidate: compact entity navigation/list beside the selected shared editor, with contextual facts and warnings adjacent when space allows. Reuse the finished editor and its existing commit/draft semantics.
- One slim toolbar holds build identity, navigation, primary actions/status and version. Allow space for long build names and in-progress actions.
- Choose breakpoints by content fit and useful minimum pane widths; initially compare1440/1600/1920/2560px, not a fixed “desktop” label. Fall back to the established stacked flow as width decreases.
- Avoid scroll fatigue becoming nested-scroll fatigue: make pane ownership clear, preserve keyboard navigation/focus and selected-row visibility, and provide meaningful region names where independent scrolling is necessary.

The latest compact mock is the approved design direction. Finalize responsive behavior and Configure composition in the item specs, preserving the approved two-stage delivery and shared editor. Its illustrative default desktop height is not a fixed height requirement for other builds.

## Files to assess later

Provisional, not an implementation prescription: `clock-generator-ui/src/App.tsx` (header/footer/version and preference placement), `components/WorkflowBar.tsx`, `components/ResultSummaryCard.tsx`, Results table/detail components, `hooks/useStickyHeaderHeight.ts`, theme tokens and shared form/section components. Reconcile against the finished3.2/3.3 tree and final original-roadmap audit before selecting APIs or files.

## Acceptance and evidence for the eventual item

- Same build, results and chosen clock survive changing display mode and reloading; the display preference does not alter exports/share links or generation.
- Compare identical Results and Configure states in both modes at1440/960/800/720/390px. Record header height, above-fold content/table rows and scroll distance; show a measured reduction rather than an arbitrary density claim.
- Version is visible before scrolling. Compact mode preserves generation/Cancel/Copy, selected clock, stale/below-target warnings, errors, labels needed to interpret values, help discovery and changelog access.
- Audit keyboard reach, focus not obscured under the shorter sticky header, accessible names/descriptions, contrast, touch/pointer targets and no page sideways scroll. No smaller type solely to conceal a layout issue.
- Independently review code and UX, with normal check/evidence gates. Select models under the then-current owner instructions.

## Remaining implementation decisions

Exact toggle placement (coordinate with D6 if approved), which redundant labels/helpers to suppress, density metrics, responsive breakpoints and narrow-width behavior remain to be finalized. Results/header first and Configure second are approved. Current Phase 3 completion criteria remain unchanged; Phase 4 has the existing independent reviews, verification and three phase-end reviewers.
