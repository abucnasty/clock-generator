**PASS — UX minor CLOSED.** Sol/high, fast off. UTC **2026-10-16 10:26:51–10:27:04**.

`InserterEditor.tsx:118–122` focuses the real first filter slot before removing the Automatic-return action. Its stable slot key preserves that element through React’s commit; no timer, effect, API or layout change was added.

Opened fresh1440/720 List and390 Diagram PNGs plus ARIA. Actual affected evidence is **156/0/0**, including same connected slot focus after Enter/commit, visible unobscured focus, exact live/draft persistence and single announcements; **90 axe PASS, zero skips**.

Verified independent1202 tests/71 files and build PASS, source proof, and unchanged product through final `e2cddd4`. No remaining material UX finding in this closure. Original round0 PASS/history and PR B carries remain; no formal major-fix round charged or phase/AA approval implied.
