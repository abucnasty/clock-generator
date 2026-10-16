# Reviewer A — targeted 2.F recheck

**PASS for my assigned 2.F findings.** No further correction is required within this item’s scope.

UTC start: **2026-10-16 10:32:22**
UTC end: **2026-10-16 10:33:01**

Reviewed product **8e0b53dc45fc238caedde71a449b8c010574a7af**, final evidence head **2220e31**, against my preserved original report, Phase 2 synthesis and finalized 2.F specification. The product-source diff between those two heads is empty.

| My assigned finding | Status | Recheck evidence |
|---|---|---|
| **A-P2-01 — contradictory wake-up definitions** | **Fixed** | At **1440/720/390**, the actual Wake windows, Terms and expanded-table help screenshots and ARIA now distinguish **craft starts for inputs** from **craft finishes/productivity payouts for outputs**. Terms retains “provisional.” The source extracts the existing approved wording into `PROVISIONAL_WAKE_UP_DEFINITION`; all three consumers reuse it. Expanded help preserves minute, one-copy, long-run, sufficient-run and start-point qualifications. |
| **A-P2-03 — unconditional net UPS promise** | **Fixed** | The actual first-visit screenshots and ARIA at all three widths now say the build holds the desired rate “with fewer inserter wake-ups.” The unconditional “costs less UPS” promise is gone. Existing entry actions remain present and legible. |

Source evidence, relative to `/Users/abucnasty/.codex/worktrees/ux-phase2-copy/factorio-scripts/clock-generator-ui/src/`: `utils/glossary.ts:48,87–89`; `utils/wakeWindowCopy.ts:16`; `components/ClockAlternativesPanel.tsx:60`; `utils/sidecarGuide.ts:25`.

I also inspected the neighboring fractional-scope correction without taking over B/C’s finding ownership. Before screenshots show **10/s without a total caption** at Copies 0.5; after screenshots show **10/s — all 0.5 copies**. Controls show **20/s** for one copy and **45/s — all 2.25 copies**. Wake-ups remain **75 a minute — one copy** throughout. PNGs and ARIA agree at 1440/720/390.

Actual images inspected:

- `/tmp/ux-phase2-copy-before-reconciled/w{1440,720,390}/01-before-answer-copies-0.5-*.png`
- `/tmp/ux-phase2-copy-after-8e0b53d/w{1440,720,390}/01-first-visit-*.png`, `02-answer-copies-0.5-*.png`, `08-answer-copies-1-*.png`, `09-answer-copies-2.25-*.png`
- `/tmp/ux-phase2-copy-help-reconciled-8e0b53d/w{1440,720,390}/02-wake-windows-definition-*.png`, `03-terms-wake-up-*.png`, `04-terms-short-*.png`, `05-expanded-table-wake-up-help-*.png`, `06-expanded-help-short-*.png`

The **777 PASS / 3 FAIL / 0 failed steps** run remains recorded accurately. Its three failures concern the capture’s incorrect Tab-to-menu-item assumption. The corrected affected run records **498/0/0**, including Tab to the header button, ArrowDown to Terms, names, visibility and focus checks. I reviewed that evidence; I did not run a browser or those checks myself.

**Carries remain unchanged:** A-P2-02/B19/N35 partial-paste safety; N32/C21 stale-plan readability; and the synthesis’s other 3.F assignments covering clipboard failure, Fuel event equivalence, output-swing scope, Advanced help and actual 320px reflow evidence. My other unassigned findings retain their recorded dispositions. This recheck neither closes them nor expands 2.F, 3.2 or D1–D8.

This is a targeted UX PASS, **not whole-phase AA certification, installation verification or phase-merge approval**. Sidecar acceptance remains historically passed; the owner’s **2.5 A installation check remains pending**.
