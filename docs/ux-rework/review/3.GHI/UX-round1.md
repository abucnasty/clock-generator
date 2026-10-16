# Formal UX recheck — 3.G / 3.H / 3.I, round 1

**Verdict: PASS.** The round-zero major is fixed. No remaining blocker, major, or new minor emerged from this recheck.

Reviewed immutable source `21261c5d86089f273a7880cc3a6f180eba17760c`, UI tree `da84a421c68e193343c1803db89d0301dde42f96`, unchanged engine `81e2f2279361387d3141a14e53e147d37288c3d4`. I inspected the four-file round-one diff, production timer tests, approved design, source-equivalence receipt, fresh native evidence, and root verification receipts. The seven previously reviewed App/Undo/tooltip/menu sources remain unchanged.

## Prior major: fixed

**Queued shared-success speech can no longer outlive its valid offer.**

[Messages.tsx:58](/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src/components/Messages.tsx:58) keeps the latest committed message state and invalidates it on host cleanup. [messages.ts:100](/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src/utils/messages.ts:100) requires both the owning message and latest announcement to remain current. [announcer.ts:61](/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src/utils/announcer.ts:61) rechecks that predicate at the actual delayed write.

The related exposure gap is also fixed: a hidden or disconnected queued region reroutes still-current speech through the existing delivery logic with the same ownership predicate. Valid speech is preserved, and a replacement spare receives the existing empty-region initialization delay.

The three added tests exercise the real production announcer: invalidation before delivery, valid composed delivery, and rerouting after a modal hides the original spare. These are meaningful regressions in the existing test file, with local cleanup; no redundant permutation suite or new framework was added.

## Current UX evidence

Fresh current-source runs completed:

- Full 13-workflow, four-width walkthrough: **8,002 PASS / 0 FAIL / 0 failed steps**.
- Full four-width 3.G/H/I supplement: **8,043 PASS / 0 FAIL / 0 failed steps**.
- Author checks: **1,295 tests / 80 files**, lint, default knip, icons, and build passed. Root independently passed type-check/test/build and verified all 412 served assets.

I independently inspected current PNGs across 1440/960/720/390, ARIA, live chronology, geometry, menu scope, and focused-control evidence.

| Previous defect | Round-one disposition |
|---|---|
| Cached shared-opening success suppressed by restoration | **Fixed.** All four cached traces expose composed success/name/shortcut/restoration speech; uncached traces expose the corresponding success/name/shortcut. |
| Obsolete queued shared-success delivery | **Fixed by production ownership checks and timer regressions.** Native critical-interval coverage remains limited as stated below. |
| Copy/full-name help blocks Configure or Results | **Fixed.** Fresh cached/uncached normal and 560px records retain target hits and successful direct navigation. |
| Slow hover-only transfer loses full-name help | **Fixed.** All-width transfer traces retain help without trigger focus; header exit and Escape dismiss it. |
| Focused row-action tooltip defect | **Fixed; no regression found.** Specific names and visible focus remain. |
| Both header menus expose background content | **Fixed.** All 32 current scope records hide root/main while open, expose the named menu region, restore the background, and return focus to the same opener. |

The separate 720 keyboard proof reaches Show all columns through 16 genuine Tabs at both heights, fully below the 146.25px header before wheel input. The inspected short-height PNG supports the geometry.

Fuel retains native focused/open evidence, semantic event-table equivalents and trace descriptions. Current raster verification records 48 samples/96 comparisons, minimum **7.767081:1**. At 1440, three bands are native-visible and the fourth is measured in the separately labelled observation; other widths need no observation wheel.

## Limits and carries

- **Native pending-Undo interval remains NOT EXERCISED.** The early shortcuts were ignored inside the closing dialog. Later Undo traces show no obsolete speech during their observation window, but do not establish that race. Production timer tests and source checks protect the previously defective seam.
- **Escape page-context movement remains a minor carried to D1.** Baseline parity is established at 390 only; scroll preservation is not claimed fixed.
- Passive 320 Exclude-chip clipping and the unsampled extra busy-input/painted-tooltip interval remain explicit historical limits.
- Original negative, partial, and superseded runs remain preserved. Fresh r16 completion does not relabel their outcomes.

**UX disposition:** the bundle may proceed to its PR/CI/merge gates once the independent CODE recheck also passes. This is a bundle UX verdict, not phase approval or blanket AA certification. Three fresh phase-end personas and the owner checkpoint remain required.
