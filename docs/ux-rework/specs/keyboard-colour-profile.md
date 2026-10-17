# Focused keyboard and colour acceptance

Status: ACTIVE. Owner explicitly adopted this scope on2026-10-16 for Phase4 and remaining UX work, replacing the full WCAG2.2AA requirement. Existing accessibility features remain. Scope: complete keyboard use and colour/contrast accessibility.

## Keyboard

Every interactive control must be reachable and operable by keyboard, with logical order, visible focus, no keyboard trap, normal dialog/menu/tab conventions, safe focus return and no focus entirely hidden by author content. Static prose/headings do not receive unnecessary Tab stops. Basis: WCAG2.2 criteria2.1.1,2.1.2,2.4.3,2.4.7,2.4.11. Validate actual workflows through native keyboard actions, including dialogs/editors and narrower layout; use component-standard patterns rather than exhaustive pixel-position permutations.

## Colour and contrast

Colour alone never carries status, selection, errors or chart-series meaning: supply visible text/icons/shapes/patterns. Normal text4.5:1, large text3:1, meaningful controls/graphics3:1 against adjacent colours, using actual composited paint and relevant hover/selected/focus states in Light/Dark. Existing System/theme settings remain; no new palette feature is implied. Basis: WCAG2.2 criteria1.4.1,1.4.3,1.4.11.

## Validation boundary

Keep full functional unit/build/lint/knip/icons/CI checks, independent code+UX reviews, three fresh phase personas, D3 same-fixture repeat and owner merge checkpoint. Keep existing accessibility features and regression protection. Replace comprehensive AA certification-style evidence with targeted keyboard/colour acceptance; other AA criteria (such as full screen-reader semantics/announcement audits, touch target sizing, zoom/text-spacing/reflow certification) are outside this focused acceptance unless separately required by functional/responsive scope. Preserve ordinary responsive reachability and useful layout. Do not claim full WCAG2.2AA conformance from this subset.

Reuse exact-source unchanged evidence and standard component contracts; do not build new capture infrastructure or add fixture/permutation matrices to close measurement limitations. Record genuine defects separately from harness limitations.

W3C references: https://www.w3.org/TR/WCAG22/ ; https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html ; https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html ; https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html ; https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html

## Owner operational directions

The owner subsequently requested removal of the custom full-AA capture/audit harness immediately AFTER Phase4 finishes, before further phase work. Do not remove it prematurely; stop expanding it now. Preserve evidence/history outside disposable automation as needed. Inventory at phase7ff9acc:55 tracked capture scripts,34879 lines under docs/ux-rework/capture. Ordinary functional/regression tests and product keyboard/colour support remain.

The owner explicitly prohibited automatic PR merges. Leave every PR open for owner review; no feature/master merge and no child-PR auto-merge without direct owner authorization. Prepare a concrete reviewable Phase4 aggregate/checkpoint while preserving all independent reviews and CI.
