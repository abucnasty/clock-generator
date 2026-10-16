**PASS — 3.2 B CODE round 0**, with one nonblocking capture minor. No blocker/major or formal fix round charged.

UTC: **2026-10-16 10:38:09–10:39:52**. Reviewed the entire B diff against `4b86e77`, final `215abfb`.

- Duplicate, reorder/Undo, UUID selection, selected-only bulk edits, metadata/omissions, mixed→Auto and focus handling satisfy the reconciled contracts.
- Independently ran **120/120 focused tests**. Confirmed full **1216/72**, TypeScript/build and remaining gate evidence.
- Independently verified identical captured/merged/final product trees, **412 matching assets**, committed capture/runtime equality and the selftest’s sole import substitution.
- Read actual **5775/0/0**, preservation **2289/0/0**, baseline **288/0/0**, seven helper proofs and retained failures; inspected all three requested PNGs.

**Minor:** [lib.mjs:1002](/Users/abucnasty/.codex/worktrees/ux-editing-rows/factorio-scripts/docs/ux-rework/capture/lib.mjs:1002) checks `target.count()` after `target = locator.first()`, so ambiguity cannot fail as promised. Check the original locator’s count before narrowing on the optional path and add an ambiguous-target negative proof. Existing exact menu callers show no affected result.

Read-only; no browser or redundant full-gate rerun. No merge/phase approval implied.
