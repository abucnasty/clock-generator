Verdict: **PASS** — round 1 affected recheck; no blocker, major, or new regression found.

| # | Severity | Finding | Evidence | Proposed fix |
|---|---|---|---|---|
| 1 | minor carry | Prior focus finding **partly fixed**: 84→84px closes label growth; passive320 clipping remains inside the labelled 2D scroller. Visible left gold ring supports the prior minor classification; tooltip-opening scroll does not prove passive visibility. | [Trace](/tmp/ux-phase3-followups-round1-final/CHECKING-TRACE.json), [actual320](/tmp/ux-phase3-followups-round1-final/w320/06-larger-editable-excluded-tooltip-320.png) | Preserve full horizontal visibility without replacing the chip; retain diagnostic. |

CODE contrast major **fixed**: excluded names/fractions now8.366:1; independently parsed3,600 leaf measurements, minimum6.231:1, zero failures. My round0 readability status was too broad; this correction closes the excluded-row failure. [Actual read-only view](/tmp/ux-phase3-followups-round1-final/w1440/04-ordinary-readonly-excluded-1440.png).
Prior tooltip-landmark minor **fixed**: popup is inside the labelled plan region, readable/unclipped in inspected320/1440 images; all48 default axe executions pass before/after Escape, shared library unchanged.
Verified evidence: **4,830/0/0**,48PNG+ARIA, six widths; UI**1,289/80**, root TS/test/build exit0,412 unchanged assets. [Round1 evidence](/Users/abucnasty/.codex/worktrees/ux-safety-accessibility/factorio-scripts/docs/ux-rework/capture/phase3-followups-ROUND1-EVIDENCE.md).
Prior whole-item review otherwise retained. Checking preserves original node/focus/disabled state in24 busy DOM samples; extra-input blocking and painted checking-tooltip visibility remain unsampled. No blanket AA or complete passive-focus-visibility claim.
