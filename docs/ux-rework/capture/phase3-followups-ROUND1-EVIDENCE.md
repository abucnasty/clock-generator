# 3.F formal fix round 1 evidence

Observed timed work interval: **2026-10-16 14:20:28–14:30:56 UTC**. The first explicit clock observation is used; the earlier dispatch time is unavailable. Administrative completion is recorded in the final handoff. Author: phase3_followups_fix_sol, GPT-6.1 Sol/high/fast off. This is implementer evidence; independent formal round 1 CODE/UX verdicts remain pending. One of the maximum two formal fix rounds has been spent.

## Changes and preserved contracts

The excluded row no longer applies ancestor opacity. Item names and swing fractions use existing `text.secondary`; strike-through, the Excluded label and block icon remain. Both actionable chip states reserve 84px. A private ref mounts all three plan Tooltip portals in the existing labelled Accordion region, outside ScrollX; CODE approved this before implementation. There is no new public API, focus manager, timer, validation bridge or mutation behavior. The existing element-prop guard test adds only a `useRef` mock required by that private ref; all five existing guard tests and their assertions remain, with no new test cases or audit/deletion.

Exact independent reports are preserved unchanged: [CODE round 0](../review/3.F/CODE-ROUND0.md), [UX round 0](../review/3.F/UX-ROUND0.md). The exact prebuild approval is [ROUND1-DESIGN-CODE.md](../review/3.F/ROUND1-DESIGN-CODE.md). The major and two minors are submitted for independent reassessment; this note does not author a review verdict.

## Immutable source and gates

Product/test head: `560656dedfca8f73c6ea74611c70a8904f609463`; UI tree `e2df6420024a8481b4cec8df68f310006ffe6508`; unchanged engine tree `81e2f2279361387d3141a14e53e147d37288c3d4`. Normal current-P3 merge `55978c0` inherits the Phase2 merge and D9 ledger without any product-tree change. Capture commit `a140b9e` is documentation/capture only. Source continuity is recorded in [CONTINUITY.json](/tmp/ux-phase3-followups-round1-final/CONTINUITY.json).

Verifier: `/tmp/ux-phase3-followups-verifier-r1-corrected`, detached outside ignored worktrees, with its own engine file dependency resolving to `/private/tmp/ux-phase3-followups-verifier-r1-corrected/clock-generator`.

| Check | Result |
|---|---|
| UI `npm test` | **1,289 tests / 80 files passed** |
| Lint, default Knip, icons, TypeScript, build | All exit 0 |
| Explicit `node scripts/copy-factorio-data.mjs` | Own source; all 10 source copies exact, example index 9, all 412 dist hashes recorded |
| HTTP preflight | 14 exact resources: 11 JSON plus HTML/main JS/CSS, excluding fallback HTML |
| Root independent TS/test/build repeat | All exit 0; 1,289/80; all 412 hashes identical |

Author [GATES.json](/tmp/ux-phase3-followups-round1/corrected/GATES.json), [SOURCE.json](/tmp/ux-phase3-followups-round1/corrected/SOURCE.json), [HTTP.json](/tmp/ux-phase3-followups-round1/corrected/HTTP.json); independent [PROOF.json](/tmp/ux-phase3-followups-root-repeat-r1-560656d/PROOF.json). Root completion preceded final captures; all 412 files were checked again before final browser execution. Engine unit **1,008** / generation **142** are inherited unchanged-tree evidence, not rerun claims.

The first verifier at `34a4718` failed UI tests **1,284 passed / 5 failed** because the direct-call component test lacked a mock for the newly used ref hook. That complete failed output remains [test.log](/tmp/ux-phase3-followups-round1/test.log). The test-mock correction was committed, pushed, and freshly verified in the distinct corrected verifier.

## Fresh affected browser evidence

[Final index](/tmp/ux-phase3-followups-round1-final/INDEX.md): **4,830 PASS / 0 FAIL / 0 failed steps**, actual widths **1440, 960, 800, 720, 390, 320**. Each width captures ordinary Included, editable Excluded with tooltip, editable Excluded after Escape, and read-only Excluded, on both the original SMALL fixture and existing real 13-machine/29-inserter utility-science fixture. All **48 PNG + 48 ARIA**, **48 full default axe executions with zero skips**, and all **48 document/strict ordinary-local geometry** checks pass. [SUMMARY.json](/tmp/ux-phase3-followups-round1-final/SUMMARY.json) and exact [source pin](/tmp/ux-phase3-followups-round1-final/source/SOURCE.json) include hashes; actual two input fixtures are hashed alongside it.

The scoped measurement enumerates real text nodes, uses each leaf's computed color, composites every enclosing background and group opacity, then compares the final foreground/background pixels. Shared `lib.mjs` is byte-identical to the prior **297-alias** library, with no changed default axe behavior or rule exclusions. Existing analytic assertions are retained and stricter leaf assertions are added. Every measured plan text leaf is graded at 4.5:1; all **3,600** leaf measurements pass, minimum **6.231:1** (focused chip text). Excluded item names and fractions are **RGB189 on RGB35, 8.366:1** in both editable and read-only states. Actual control glyph and focus paint measurements also run through enclosing opacities.

The old immutable `7d2153e` build is a negative control: [old index](/tmp/ux-phase3-followups-round1-negative/INDEX.md) records **424 PASS / 28 FAIL / 0 failed steps**. The new measurement catches actual excluded Logistic/Utility science text **RGB90 on RGB35, 2.278816:1**, matching the independently reviewed old PNG. Old 5306 refused HTTP; this read-only negative probe used a separately started exact old verifier preview on free port5311. Final product preview is port5310; owner5280 was never accessed.

All 12 actual checking observers record two busy samples apiece, original node connected/focused/`aria-disabled=true`; width remains **84→84px**. No extra native input was dispatched during busy. The existing controlled mutation-guard and lifecycle tests provide that deterministic coverage. No painted checking-tooltip frame was sampled; DOM samples do not prove painted visibility during the brief busy interval.

Actual larger focused tooltip **before Escape** passes full default axe/region at every width and is within the labelled plan region. Normal helper scrolling exposes the full focused chip, gold ring and unclipped popup in the actual final PNGs:

- [320 focused tooltip](/tmp/ux-phase3-followups-round1-final/w320/06-larger-editable-excluded-tooltip-320.png)
- [1440 focused tooltip](/tmp/ux-phase3-followups-round1-final/w1440/06-larger-editable-excluded-tooltip-1440.png)
- [320 read-only Excluded](/tmp/ux-phase3-followups-round1-final/w320/08-larger-readonly-excluded-320.png)

## Residual minor and preserved diagnostics

**Residual passive visibility diagnostic remains for reviewers.** At320 on the larger fixture, the original Included chip already has a center miss within the labelled local table; it remains a center miss after exclusion, despite width84→84. This fix removes the 62→82.8 growth but does not establish complete passive visibility. Normal `openTooltip` scrolling exposes the full chip/popup in the final screenshot; that capture action is not claimed to close passive clipping. The original gold-ring evidence and busy y84 DOM samples remain; no new WCAG2.4.7/2.4.11 failure or painted-frame conclusion is inferred.

The initial new plan capture **431/1/6** retained a hover-only-tooltip dismissal caused by the capture's pointer-rest call and an ordinary320 partial-help state. Probe2 **893/2/1** retains the same partial-help state plus one tooltip timeout. The final local capture supports an additive `keepPointer` option solely to photograph the actual hovered/focused tooltip; shared helpers and default behavior are unchanged. Probe3 actual1440/320 then passed **1,610/0/0** before the final six-width run.

The partial Advanced help was concretely measured at y−0.21875..29.78125 with the focused chip y694.61..718.61. A normal native wheel100 moves it to y−100.21875..−70.21875 while the chip stays visible at y594.61..618.61; strict focus and unchanged full axe then pass. [NATIVE-SCROLL-PROOF.json](/tmp/ux-phase3-followups-round1-final/NATIVE-SCROLL-PROOF.json) and prior [interactive geometry](/tmp/ux-phase3-followups-round1-plan-probe2/INTERACTIVE-ordinary-editable-excluded-tooltip-320.json) preserve before/after. This is ordinary scroll ordering, not a product/CSS change or blanket waiver.

An early legacy `STEPS=stale` diagnostic is **902/4/0**: an asynchronous busy poll observed running, but validation completed before its subsequent disabled assertion and native extra actions. Four downstream assertions failed; the captured interval does not establish a running mutation defect or runtime PASS. It remains [stale.log](/tmp/ux-phase3-followups-round1/stale.log). Final checking evidence uses original-node read-only observers and does not repeat that race. Initial probes overlapped the root repeat window and are diagnostics, not final-source acceptance.

All original failures remain untouched, including original large-tooltip **24/1/0**, Escape **27/0/0**, full1 **13,599/0/0 diagnostic with ordinary overflow**, full2 **14,349/0/0**, and strict320 **478/0/0**. Prior full2's other product states inherit only their exact unchanged source: the only UI delta since7d is TransferPlanPanel and its direct-call test mock; Copy, Paste, Fuel, dialogs, editors and their hooks are byte-identical. Fresh affected plan states supplement those existing450 states; they do not imply a rerun of unrelated clipboard/Fuel behavior or blanket AA certification. No shared library assertions, axe rules, Worker timings, private handlers, storage state, dependencies, engine/sidecar, versions, CI, settings, Append or D1–D9 work was changed.

Independent round1 CODE/UX reassessment, root screenshot inspection, fresh phase-end personas/coach and owner/final approvals remain with root.

## Root verification and formal closure

Independent [CODE round1 PASS](../review/3.F/CODE-ROUND1.md) and [UX round1 PASS](../review/3.F/UX-ROUND1.md) close the contrast major and tooltip minor. Passive320 clipping remains an explicit minor carry with the painted-busy/extra-input limitations above. Root independently asserted all48 document/local geometry states,3,600 leaf measurements and12 original-node traces, recomputed every leaf contrast ratio, and verified all executed capture bytes match final child source. The old negative retains27 failed text leaves (28 total failed checks). Root opened actual320 focused-tooltip and1440 read-only images. [ROOT-VERIFICATION.json](/tmp/ux-phase3-followups-round1-final/ROOT-VERIFICATION.json) preserves the checks. These verdicts permit the child PR/CI gate; fresh three-persona phase review and owner phase/final checkpoints remain.
