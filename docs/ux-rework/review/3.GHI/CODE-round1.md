# Formal CODE re-review — round1: PASS

Reviewed immutable product `21261c5d86089f273a7880cc3a6f180eba17760c`, UI tree `da84a421c68e193343c1803db89d0301dde42f96`, unchanged engine `81e2f2279361387d3141a14e53e147d37288c3d4`.

I inspected all four changed files against reviewed `1ff5c6d`, the approved design/exposure extension, source-equivalence receipt and fresh evidence. No required fixes or new blocker/major findings remain.

## Round0 major: fixed

Ownership now survives through actual delivery:

- [messages.ts:94](/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src/utils/messages.ts:94) attaches the deferred message’s owner.
- [messages.ts:100](/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src/utils/messages.ts:100) requires both that current owner and the latest announcement id.
- [Messages.tsx:59](/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src/components/Messages.tsx:59) updates the committed-state ref in a layout effect and clears it during cleanup. Pending owned speech therefore observes dismissal, supersession and unmount.
- [announcer.ts:43](/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src/utils/announcer.ts:43) rejects invalid speech before immediate routing; [announcer.ts:62](/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src/utils/announcer.ts:62) checks again before delayed delivery.

The related exposure gap is also fixed. At delivery, a hidden/disconnected spare is rerouted through the existing announcer with the **same predicate**. An exposed main region receives it immediately; otherwise a fresh empty spare uses the existing100ms initialization. A later invalidation remains effective throughout rerouting.

This preserves ordinary notification/dismissal semantics. There is no new queue, custom delay or App/Undo/cache change.

## Regression tests and scope

The three added tests at [messages.test.ts:145](/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src/utils/messages.test.ts:145) are meaningful:

- Owner dismissal before delivery prevents the queued write.
- A newly hidden spare is replaced without receiving stale text.
- A still-current offer delivers the exact composed success.

They invoke the production announcer and ownership guard with Vitest timers. The local DOM stub is limited to required operations; created nodes, timers and globals are cleaned up. These tests complement the retained reducer regressions without adding a framework or coverage-driven permutations.

The other seven reviewed sources are unchanged. No further3.H/3.I source re-audit was necessary.

## Verification and limits

The final-source evidence gate is complete:

- Author:1295 tests/80 files, lint, default knip, icons and build pass.
- Root independent tsc/test/build pass; the preview receipt identifies this source, its own engine and412 assets.
- Fresh full13-workflow/four-width capture: **8002 PASS /0 FAIL /0 failed steps**.
- Fresh full3.G/H/I supplement: **8043 PASS /0 FAIL /0 failed steps**.
- All32 recorded menu-isolation/cleanup entries pass. Current Fuel pixel/hash measurements retain the3:1 requirement, with minimum measured contrast7.767:1.

I also inspected current390 shared-success and720 Fuel screenshots. The corrected observation methods retain their stated scope; historical negative runs remain negative.

The native early-Undo critical interval is still **NOT EXERCISED**: the shortcut occurred within the closing dialog and was ignored. Later native Undo success is not a race-protection PASS. The production timer regressions and source checks now protect the previously identified ordering independently.

Existing390 Escape scroll movement remains the documented baseline-equivalent minor assigned toD1. Other recorded sampling limits remain unchanged.

**Disposition:** CODE round1 PASS for this bundle. This is not a phase-end verdict or blanket accessibility certification.
