# Formal CODE review — round0: FIX

Reviewed immutable product `1ff5c6def2c5c39922cf6261c1ccbd1c7611937f`, UI tree `56f2e5394345426018ba1b21493db356945094d4`, against `b0bc5acd885886f754540cb956d6a62b58856e35`. I inspected the complete ten-file UI diff, surrounding restoration/Undo/announcer code, specs3.G/3.H/3.I and the supplied evidence receipts. No product files, browsers, builds or Git state were changed.

## Required fix

**Major — deferred shared-success ownership ends before the actual live-region write.**

The new guards correctly reject an obsolete completion **before** `announce-message` is accepted. They do not invalidate a completion already queued for delivery:

- [messages.ts:92](/tmp/ux-phase3-3ghi-verifier-1ff5c6d/clock-generator-ui/src/utils/messages.ts:92) converts the guarded completion into an announcement containing only id/text.
- [MessageHost:57](/tmp/ux-phase3-3ghi-verifier-1ff5c6d/clock-generator-ui/src/components/Messages.tsx:57) schedules that announcement without retaining its owner or cancelling it when the offer disappears.
- [announcer.ts:60](/tmp/ux-phase3-3ghi-verifier-1ff5c6d/clock-generator-ui/src/utils/announcer.ts:60) writes the captured text100ms later without revalidating ownership.
- [useUndo.ts:92](/tmp/ux-phase3-3ghi-verifier-1ff5c6d/clock-generator-ui/src/hooks/useUndo.ts:92) dismisses the offer on Undo, while [messages.ts:84](/tmp/ux-phase3-3ghi-verifier-1ff5c6d/clock-generator-ui/src/utils/messages.ts:84) preserves the same announcement object.

A reachable ordering follows from the source:

1. A cached same-config share waits for the real asynchronous IndexedDB read (`resultsStore.ts:236`, `useSimulationWorker.ts:771`).
2. Restoration completes shortly before the shared dialog finishes exiting. The hidden-root fallback schedules the100ms write.
3. The dialog exits and focus returns to the build switcher. Native Undo is now permitted.
4. Undo restores the previous library owner and dismisses the shared offer before the timer fires.
5. Because the config key is unchanged and restored clocks are already present, this Undo need not produce another announcement. The timer then announces the obsolete opening and unavailable Undo offer.

The storage operation has no ordering guarantee relative to dialog exit. Therefore the code establishes this interval without requiring an artificial worker delay or a successful native reproduction. This violates3.G’s explicit prohibition on obsolete deferred success after a newer action.

**Smallest bounded remedy:** retain ownership for this deferred announcement through its pending delivery, and cancel or revalidate that pending write when its offer is undone, dismissed, replaced or otherwise invalidated. Keep ordinary announcement/dismissal behavior unchanged. This belongs at the existing announcement ownership/delivery boundary; it needs no global queue, arbitrary wait or cache/Undo redesign.

Add a meaningful regression at the pending-delivery seam: accept the deferred completion, queue its hidden-root write, invalidate its owner before the timer expires, then prove no stale text is written. Exercise the corresponding still-current delivery positively. Another reducer-only completion test would not cover this failure.

## Other changes

- **3.G: partly fixed.** Immediate Undo, pre-add snapshot, library ownership/revert arguments, cached selection recovery and composed opening/hint/restoration are preserved. App revision/config/mounted guards and reducer supersession checks address earlier completion races. The delivery-stage gap above remains.
- **3.H: fixed within reviewed scope.** Responsive Copy placement, removal of the redundant row tooltip and the local BuildSwitcher hover/focus lifecycle are bounded. The header listener cleans up, menu opening suppresses its tooltip, and Escape/blur/touch closure bypasses the mouseleave guard. Actual narrow hover-only evidence shows readable full-name help below the workflow controls.
- **3.I: fixed within reviewed scope.** Both header menus now use MUI’s body-level modal isolation with named paper regions. Trigger references, menu labels, alignment, native actions and dialog handoffs remain intact. No manual background-hiding machinery was introduced.

No additional blocker or major emerged from the remaining diff.

## Tests and evidence

The three new reducer tests are justified: they protect immediate Undo/composed once-only speech, newer workflow supersession, and completion after closure/replacement. They are small behavioral regressions, not coverage-driven permutations. Retain them; they do not protect the pending timer identified above.

The evidence union is acceptable as recorded:

- Author gates and root independent tsc/test/build pass on the identified source;1292 tests and412 verified assets are documented.
- Broad `r12` remains **7735/0/4**, with four retained Fuel measurement exceptions—not a clean broad run.
- Corrected complete Fuel evidence is **451/0/0**. The raster method addresses transparent-caption hit-testing and separately exposes1440’s full outline without changing focus, RAW or the3:1 threshold.
- The supplement remains **7871/1/0**, supplemented by corrected720 evidence **889/0/0**, including genuine16-Tab focus proof without wheel assistance.

The early native Undo attempts remain **NOT EXERCISED**: focus was inside the closing shared dialog, so the shortcut was correctly ignored. Later successful Undo observations cannot establish protection of the pending-write interval.

The baseline-equivalent390 Escape scroll movement remains an explicit minor assigned toD1. The retained320 chip and unsampled busy-state limits are not upgraded into new PASS claims.

**Disposition:** fix the owned pending-announcement delivery gap, verify that specific regression and rerun the required affected checks. This is a bundle CODE verdict, not a phase-end verdict.
