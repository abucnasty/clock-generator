# Bounded busy-input observations

These Factorio 2.1.21 observations compare only the first two common ticks of two unmatched real and control layouts.
They are not a controlled minimal pair. No new scaffold, substitute screenshot, whole-window-cycle denominator or throughput
claim is introduced. GameFixturePaths.BUSY_INPUT_OBSERVATIONS catalogs the sealed [observations](fixtures/observations.json).

All eight selected real input inserters and twelve control input inserters update once per tick: 16/24 updates.
The four refusing hands in each layout each update twice, with eight observed wakes and eight sleeps in each case.
The real refusal path has eight target-full=true checks and no selected source-filter or pickup-acceptance checks.
Control has eight target-full=false checks, eight filter checks and eight refused acceptance checks. The controlled
[source-pickup complement](../source-search/README.md) separates these gates and source inventory shapes.

Alarm totals are 8/16, distinct from the eight wakes in either case. An alarm on a hand already on the update list does not
necessarily wake it again. Only alarm beginnings were observed; no unobserved end state is supplied. Exactly twelve
observation-induced target-full checks per common slice are excluded. Visible entity status is not the sleep state.

The fixture retains exact per-role order, results and denominators. Zero selected checks do not prove zero alternative
work. Longer control attempts exceeded their existing limit and are not accepted evidence. No full-factory cause,
sharing/price conclusion, whole-window-cycle rate or production fix follows from these two unmatched ticks.

```bash
npm test -- src/harness/probe-observations.test.ts
```
