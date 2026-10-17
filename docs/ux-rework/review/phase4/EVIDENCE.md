# Phase 4 acceptance evidence

Final product source: `a2485d6` (product delta `f62b3b1` over combined `41cbd15`). The initial Display and D10 conversion/Undo native focus images are from41cbd15; their behavior/style is unchanged by the toolbar-fill-only fix. Final D10 offer images and all subsequent focused/context/phase-end screenshots usea2485d6. The final cleanup changes documentation and removes disposable audit automation only. No Phase4 change has merged into feature or master.

## Functional checks

All commands in [combined checks](receipts/combined-checks.json) pass: UI 1,376 cases/86 files, engine 1,075 cases/82 files, generation 147 cases/13 files, both lint/knip checks, icons, build. [Independent UI test/build repeat](receipts/independent-repeat.json) passes with its own matching engine. The [final product checks](receipts/final-product-checks.json) rerun all UI gates after the minor toolbar hierarchy fix; all pass. Engine source is unchanged by that fix. CI results are recorded in the PR.

## Focused keyboard and colour acceptance

Actual UI keyboard input checked Display, density and colour radios, menu/dialog return, first-visit guide/manual route, clock radios, Why/Wake/Install tabs, conversion and Undo, and the Diagram editor. Theme/density changes retained a dirty rate of298 and the previously generated297/s result with its old-clock warning. Cancel required deliberate Discard and reopened175; Save reopened176, then175 was deliberately restored. No fixture files changed.

Named build A retained its rounded782 manual clock, Wake/table and actual2329.5px page position across reload; B retained its own rounded391 clock and Install. Returning to A restored A's own context. Clean-editor entity selection survives reload; changed entity content has sensible fallback. [Reload](receipts/D7-reload.json), [Save/Cancel](receipts/dialog-save-cancel.json). Both-mode actual token/composited paint and semantic-chart contrast regression tests remain; source reviews and fresh Light/Dark chart/diagram images confirm labels/patterns preserve meaning. This is the owner's focused keyboard-and-colour scope, not a full WCAG AA conformance claim.

Fresh Results, Configure and conversion screenshots at1440/960/720/390 are under [screens](screens/). Results page width equals viewport width at all four widths; exactly one selected-clock detail panel is visible. Long screenshots are full-page browser captures and can place the sticky header at the current scroll position; transition layers in a few older temporary screenshots are not persistent app states. Selected review images here are JPEG copies of the browser-returned original bytes, with corrected file extensions; no image editing.

## D3 repeat and D9 cleanup

The original two fixture files and baseline manual candidate pins are unchanged. A uses297/s and11Copies; B uses216/s and5.5Copies. The bounded final walkthrough reached explanation, comparison, direct Install, actual Copy and context restoration in explanatory and separate Compact views at1440/720. Both builds' copied blueprint bytes and canonical decoded hashes match the baseline exactly. [D3 receipt](receipts/D3-repeat.json) labels its one carried unchanged-copy row and records observed positions. This manual repeat uses a different observation protocol: do not compare its position snapshots to the baseline cumulative scroll totals, or claim a human usability study or measured percentage improvement.

[D9 final measurement](receipts/D9-final-benchmark.json):57 executed cases removed,1433→1376 across86 files. All412 production assets are byte-identical before/after cleanup and across the independent build. Sequential one-pair local wall time2.747s→2.729s is effectively unchanged; no CI or speed improvement is claimed. All51 protected baseline declarations and distinct later behavior tests remain.

## Known carried minors

A-P3-05/B3E-2/C3E-2 remains: opening/closing a header menu can move the underlying scroll position, although Escape returns focus to its opener. [Observed receipt](receipts/menu-return.json). D7 saved-build/reload restoration does not fix menu dismissal; this remains an explicit follow-up.

Persona A also retains A-P4-1: the raw clock timing label “Standing still” alongside a saved Moving run and an engine-selection-rule match remains confusing. These are separate authoritative fields; the proposed follow-up should explain timing versus saved setting without changing the engine rule or claiming new belt compatibility. Previously retained developer-timeline clipping/shape/copy nits also remain outside Phase4.

D8 is investigation/proposal only; no per-machine rate feature was implemented. The owner must approve any implementation separately. Independent CODE and item UX reviews, all three fresh phase personas and the process coach PASS reports are linked alongside this file. The dedicated final cleanup removes the custom harness; its delta CODE/UX reviews and necessary checks preserve the ordinary functional gates. All PRs remain open for owner review; no automatic merges.
