# Formal UX audit — 3.G / 3.H / 3.I, round 0

**Verdict: FIX — one major remains in 3.G.** The inspected evidence supports closing the original tooltip, navigation, row-action, and modal-scope defects. Shared-success speech now reaches an exposed live region, but its queued write can outlive the offer it describes.

Reviewed source: `1ff5c6def2c5c39922cf6261c1ccbd1c7611937f`, UI tree `56f2e5394345426018ba1b21493db356945094d4`, unchanged engine `81e2f2279361387d3141a14e53e147d37288c3d4`. I read all ten differing UI files against the phase checkout, the three specs, current owner decisions, root receipts, and actual PNG/ARIA/geometry/live/paint evidence. This is the formal bundle audit, separate from earlier triage and the three forthcoming phase-end personas.

## Major requiring correction

**[Major] A queued shared-success announcement can survive dismissal or Undo of its offer.**

[App.tsx:333](/tmp/ux-phase3-3ghi-verifier-1ff5c6d/clock-generator-ui/src/App.tsx:333) checks replacement, configuration, and mounted state before completing restoration. [messages.ts:87](/tmp/ux-phase3-3ghi-verifier-1ff5c6d/clock-generator-ui/src/utils/messages.ts:87) then validates the current message before creating the announcement. Those checks happen before the eventual live-region write.

When the application remains hidden during dialog exit, [announcer.ts:61](/tmp/ux-phase3-3ghi-verifier-1ff5c6d/clock-generator-ui/src/utils/announcer.ts:61) schedules an unconditional write 100ms later. Dismissing the offer clears `current` but preserves `announcement`; [MessageHost:57](/tmp/ux-phase3-3ghi-verifier-1ff5c6d/clock-generator-ui/src/components/Messages.tsx:57) therefore does not cancel or revalidate that pending write.

A cached restore can finish during the final portion of the closing dialog. Once the page becomes available, dismissal—or Undo before another announcement cancels the timer—can invalidate the offer while its old success/name/Undo hint remains queued. The screen reader can then receive a success and shortcut that no longer describe the current state. The underlying timer predates this bundle, but 3.G’s deferred completion remains subject to this window and does not satisfy its obsolete-success acceptance criterion.

The current native evidence does **not** reproduce this interval. Both corrected 720 early shortcuts were consumed inside the closing dialog; fallback Undo happened after shared speech. Their honest `NOT EXERCISED` designation is correct.

**Concrete fix:** carry message ownership/validity through the final delayed write, or cancel that message’s pending write when its offer becomes invalid. Preserve immediate visible Undo, the pre-add snapshot, combined success/restoration speech, and existing Copy-under-dialog announcements. Do not solve this with a longer delay or a global announcement queue. Add only meaningful regression protection for invalidation between scheduling and writing, then rerun affected native success/Undo and dialog-announcement evidence plus required checks.

## Findings disposition

| Cited defect | Disposition | Independent assessment |
|---|---|---|
| Cached restoration suppresses shared-opening speech | **Fixed for observed opening paths; 3.G partly fixed overall** | All four cached traces contain exposed combined success/name/shortcut/restoration text; uncached traces contain success/name/shortcut. Pending-write invalidation remains the major above. |
| Copy tooltip blocks Configure/Results after consent Cancel | **Fixed** | Native normal/560 geometry and direct activation support the responsive placement. Inspected screenshots retain visible Copy focus and reachable navigation. |
| Full-name help blocks header navigation | **Fixed** | Cached/uncached direct navigation succeeds across all four widths and heights with help retained. |
| Slow hover-only transfer loses full-name help | **Fixed** | Each width’s four-point transfer retains help without trigger focus; header exit and Escape dismiss it. The inspected 960×560 image shows the complete name. |
| Focused row-action tooltip creates an accessibility defect | **Fixed** | The redundant tooltip is removed; specific accessible names and visible focus remain. All-width normal/560 records have no tooltip and successful target hits. |
| Build menu exposes background content behind its modal backdrop | **Fixed** | All 16 scope records hide root/main while exposing the named menu region, restore accessibility on close, and return focus to the same opener—including the original 390 scrolled position. |
| More options has the analogous header-only modal scope | **Fixed** | Its 16 records establish the same isolation and restoration. Actual ARIA exposes the named region/menu and intended actions. Terms/examples handoffs and Reset/Undo remain covered. |

## Evidence and capture corrections

I accept the evidence as a **union of preserved runs**, without inventing a clean whole-broad total:

- Author checks: 1,292 tests/80 files, lint, default knip, icons, and build passed. Root independently passed type-check/test/build and verified the exact 412 served assets.
- Four-width supplement: **7,871/1/0**. Its original 720 target-size failure remains recorded.
- Corrected affected 720: **889/0/0**. Separate genuine 16-Tab paths at 900 and 560 reach Show all columns fully below the header before any wheel input; the inspected short-height image shows visible focus. Framed observation does not replace that proof.
- Broad walkthrough: **7,735/0/4**, retaining four unsupported Fuel measurement exceptions.
- Complete corrected Fuel workflow: **451/0/0**, covering all four widths, six-event chart/table equivalence, persistent trace descriptions, Space closing, and touch reopening.

The Fuel correction is justified. Actual pixels resolve the transparent-caption hit-test limitation. The raster receipt verifies 48 samples and 96 contrast comparisons, minimum **7.767081:1**. At 1440, the native state retains three visible outline bands; the separately labelled 13px wheel observation exposes the fourth while preserving focus, raw data, and open state. No four-band native visibility claim is warranted.

The inspected geometry contains no ordinary horizontal overflow failures. Row-trigger paint measurements exceed their required contrast thresholds. Actual menu ARIA, cached-success/Undo, focused row, short-height navigation, Terms/Copy-failure, and Fuel images support the recorded behavior.

## Carries and limits

- **Escape page-context movement: minor, carried to D1.** Exact baseline parity is established at 390 only. Focus returns visibly, but scroll preservation is not fixed or passed.
- **Pending shared-speech invalidation:** native critical interval remains unexercised; the source-backed major prevents acceptance.
- **Passive 320 Exclude-chip clipping:** retained historical minor; no broader narrow-screen or AA waiver inferred.
- **Extra native busy-input/painted busy-tooltip interval:** remains unsampled. Existing evidence and guards must not be described as a native busy-state pass.
- The three new reducer cases protect distinct deferred-message behaviors and are justified. They do not protect final delayed-write invalidation; D9’s independent cleanup requirement remains.

**Required next step:** correct the queued-write ownership gap and return for focused re-review. No additional product redesign or escalation to an owner feature decision is needed.
