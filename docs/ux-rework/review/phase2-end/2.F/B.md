## Phase 2 persona B — targeted 2.F recheck

**PASS for the assigned 2.F corrections.**

Power-user interaction designer; GPT-6.1 Sol/high, fast mode off. Actual inspection: **2026-10-16 10:32:36–10:33:19 UTC**. Reviewed final `2220e31`, product `8e0b53dc45fc238caedde71a449b8c010574a7af`.

I read my preserved original report, the synthesis, final 2.F specification and evidence note. I compared the five changed product files with the original reviewed source, opened actual relevant **1440/720/390 PNGs**, and inspected accessibility snapshots, capture logs and root verification records. No files or application state were changed.

| Assigned finding | Status | Recheck |
|---|---|---|
| **Phase2 B1 — inconsistent wake-up explanation**; related factual portion of original A25/B32/C30 | **fixed** | Terms, Wake windows and expanded comparison help now share one definition: inputs wake on craft **starts**; outputs on craft **finishes/productivity payouts**. The glossary retains “provisional.” Expanded help retains per-minute, one-copy, long-run, sufficient-run and start-point limitations. Wake windows remain a distinct enabled-ticks concept. |
| **Phase2 B11 — missing Makes scope below one copy**; related fractional portion of A16/B13 | **fixed** | Real generated results visibly show **10/s — all 0.5 copies**, **20/s** with the concise one-copy caption, and **45/s — all 2.25 copies** at every reviewed width. Wake-ups remain **75 a minute — one copy** throughout. The before image visibly lacks the 0.5 caption. |
| **Qualified introduction**, supplementary 2.F acceptance item from A-P2-03 | **fixed** | First-visit images and accessibility text now say “with fewer inserter wake-ups.” The unconditional net “costs less UPS” promise is gone; entry actions and guidance remain intact. |

Source evidence, relative to `/Users/abucnasty/.codex/worktrees/ux-phase2-copy/factorio-scripts/clock-generator-ui/src/`:

- `utils/glossary.ts:48,87`, `utils/wakeWindowCopy.ts:16`, `components/ClockAlternativesPanel.tsx:60`: shared definition and retained qualifications.
- `utils/clockSummary.ts:144`: scope shown whenever Copies differs from one.
- `utils/sidecarGuide.ts:25`: corrected introduction.

Actual visual evidence inspected:

- `/tmp/ux-phase2-copy-before-reconciled/w390/01-before-answer-copies-0.5-390.png`.
- `/tmp/ux-phase2-copy-after-8e0b53d/w{1440,720,390}/`: first visit and answer images for **0.5, 1 and 2.25** Copies.
- `/tmp/ux-phase2-copy-help-reconciled-8e0b53d/w{1440,720,390}/`: Wake windows definition, provisional Terms, expanded wake-up help and short-height help images, with corresponding ARIA snapshots.

The evidence history remains accurately reported: baseline **99/0/0**; full after run **777/3/0**, whose three failures were the mistaken assumption that Tab visits a MUI menu item; corrected affected run **498/0/0**, demonstrating actual header Tab access and ArrowDown focus on Terms. The failed run has not been relabelled. Root’s actual logs show **967 tests / 57 files** and build passing; its proof records **412 assets with no mismatches**. The old-source regression log fails precisely the below-one caption cases.

**No additional fix is required within 2.F.** This closes my B1/B11 corrections without closing unrelated findings.

The **3.F carries remain unchanged**: partial-Paste replacement/dependency safety, clipboard failure feedback, Fuel text/keyboard equivalence, output-swing scope, Advanced help, stale-plan readability and the actual 320px reflow audit. Existing Phase 3 work and deferred D1–D8 are not rescored here.

This is **not full-AA certification or phase approval**. The owner’s **2.5 A installation check remains pending**; **2.2 sidecar acceptance already passed**.
