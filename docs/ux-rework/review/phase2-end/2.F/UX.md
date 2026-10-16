**PASS — 2.F UX round0.** No material findings. Sol/high, fast off. UTC **2026-10-16 10:29:48–10:31:05**. Reviewed final `2220e31`, product `8e0b53dc45fc238caedde71a449b8c010574a7af`; product diff through the capture-only final head is empty.

| Cited findings | Verdict and evidence |
|---|---|
| **A-P2-01, B1, C2E-6** | **Fixed.** `utils/glossary.ts:48` supplies the shared provisional definition; Wake windows and Terms match exactly. `components/ClockAlternativesPanel.tsx:60` preserves input starts, output finishes/productivity payouts, one-copy/minute scope, long-run/sufficient-run and start-point qualifications. |
| **A-P2-03** | **Fixed.** `utils/sidecarGuide.ts:25` describes fewer inserter wake-ups without promising net UPS savings. Fresh390 intro remains readable with its existing primary action. |
| **B11, C2E-9** | **Fixed.** `utils/clockSummary.ts:144` shows total scope whenever Copies differs from1. Before390 visibly lacks the0.5 caption; real after results show10/s/all0.5 copies,20/s with concise one-copy presentation, and45/s/all2.25 copies. Wake-ups remain75/minute for one copy. |

Independently opened **10 actual PNGs** across1440/720/390, including baseline, intro, all three Copies controls, Wake windows, Terms, expanded help and short-height help. Read relevant ARIA, actual keyboard/mouse/focus/contrast assertions and executed-runtime provenance. Definitions and captions remain legible; measured text contrasts range7.49:1–15.72:1.

Preserved baseline **99/0/0**, failed full-after **777/3/0**, and corrected affected **498/0/0**. The three failures were Tab-to-menu assumptions; the repair requires actual ArrowDown focus on Terms while retaining header Tab reach, names, visibility and help checks. Both executed script hashes match RUN records. Old-behavior numeric tests genuinely fail for0.0625/0.5/0.9999.

Root’s independent **967 tests/57 files + build PASS** and412-asset proof were inspected. No browser/npm, file or Git mutations performed. Strict-definition experimentation,3.F carries and D1–D8 remain unchanged. Separate affected A/B/C rechecks and owner phase/install checkpoints remain; this is no blanket AA or phase approval.
