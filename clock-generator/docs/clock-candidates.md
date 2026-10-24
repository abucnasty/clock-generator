# Clock candidate strategies

The generator tries scheduling strategies, then checks their output, sampled starts and recovery after input
starvation and output blockage. A strategy can produce the same clock as another strategy on one build and a useful
different clock on another. Identical verification results should be shared within a generation.

## Purpose and removal audit

The October 2026 audit retains the scheduling strategies tested so far and identifies one redundant construction:
the backed-up-belt alternative when no inserter picks from a belt. An early guard now skips that construction.
Removal trials confirm current benefits from the other tested strategies, including default fallback cases.
Game recordings establish behavior for their recorded fixtures, not every possible build.

| Strategy | Purpose and evidence | Recommendation |
| --- | --- | --- |
| Batched swings | Baseline schedule grouped around the crafting cycle. | Keep. |
| Fractional swings | Handles fractional hand counts. [Utility Science](../src/crafting/utility-science.generation.test.ts) selects it at 16.07 wake-ups/minute versus 26.79 for batched swings. | Keep; share duplicate verification when no different clock results. |
| Other output swing counts | Changes buffering and the period. [Logistic Science](../src/crafting/logistic-science.generation.test.ts) selects three moving-supply swings or two backed-up swings; Agriculture selects two. The October 2026 removal trial confirms a current benefit from the farthest longer-cycle candidate on iron bacteria. | Keep both shorter and longer cycles. |
| Even hands | Synchronizes inserters sharing sources or mirrored machines. The [accumulator control](../src/crafting/candidates/even-hands.test.ts) recorded 576 items in each of 46 periods. | Keep. |
| Observed windows | Derives windows from actual transfers, and holds when they pass the clock-only check, not when the run they were observed in does (#269: on the express moving undergrounds that run moves 560 of 528 at 3 output swings while the windows hold, natively too). Its clock-only checks judge each moving lane-phase start over its repeating cycle, not its first period (#272: read off a run from one lane phase, the express mirrored moving over-the-hood windows held their first period from every start but repeated six 112s and one 96 from nine of 64, as the game did; their padding now takes 3 ticks more, which holds 112 natively). The October 2026 removal trial worsens backed-up belted Utility from 0 to 10.71 wake-ups/minute. [Production Science](../src/crafting/generate-blueprint.generation.test.ts) also has a regression where planned windows fail and observed windows pass. | Keep; share duplicate verification. |
| Full-hand output | Avoids repeated partial grabs while allowing surplus to drain after blockage. [Automation Science](../src/crafting/automation-science.generation.test.ts) needs this search for a stable candidate. The [Advanced Circuit 230 recording](../tests/game/builds/scaffold-recordings.game.test.ts) verified 16,192 items in each of two 12,672-tick repeats. | Keep. |
| Shifted swings | Moves a whole input/output round within machine inventory limits. The October 2026 removal trial finds uniquely better-ranked clocks for Flying Robot Frame, Chemical Science and a backed-up Utility variant. | Keep as a deferred search; removal worsens supported results. |
| Uneven output swings | Moves an output swing and observes new input windows. The October 2026 removal trial finds a uniquely better-ranked moving-supply Utility clock. Historical [belted Utility findings](../resources/config-samples/README.md) recorded 96 items in each of 107 periods, with five windows instead of seven at the same wake-up rate. | Keep as a deferred search; removal worsens a default fallback result. |
| Shared windows | The windows of the grouped hands rule with the takers that open on the same tick sharing one, the longest any of them needs, so that they share one decider combinator ([stability](stability.md), item 10). Listed beside the separate clock only where it holds from every start, passes the margin of a tick either way and gets back from every backpressure loss. [Military Science](../src/crafting/shared-windows.generation.test.ts) selects it (4 deciders) where the separate windows do not recover; the productivity module chain lists it at 6 deciders and 1,254.4 wake-ups a minute against 12 and 575.6. | Keep; ranked as any other clock (stable first, then the fewest wake-ups). |
| Backed-up alternative | Models a different input supply condition and is ranked against the user's belt choice. With no belt-pickup inserters it rebuilds an exact primary duplicate. | Skip construction only when no inserter takes from a belt; retain it for belt-fed builds. |
| Moving-belt alternative | On a config whose belts are backed up: the build planned with the belts moving, belt pickup slack on its belt windows, and the clock-only check, swing backoff and loss trials on the config's backed-up belts, where it holds by its own check. A last resort, made after the searches only when no other clock can be selected as stable. #275: the normal backed-up side underground entrance and exit and front exit refill slower than a stack a tick, every clock planned for backed-up belts misses (natively too), and this one holds 176 a period in the game with exact recovery. | Keep as a fallback; it costs time only on builds with no stable clock. |

History supports treating these as scheduling methods, rather than assuming they were simulator workarounds:
`06f650ab` introduced shifted and uneven swings around machine limits; `aa1aec0f` introduced full-hand output;
`bc3027f4` added even hands to synchronize mirrored takers after an insertion-limit correction.

Before removing a strategy, compare all relevant fixtures with explicit searches enabled, including moving and
backed-up supply. Record any lost stable clock, recovery guarantee, throughput, wake-up improvement or window-count
advantage. Retain game-backed examples as regression controls. No strategy has been removed by this audit.

The trial transcripts and local benchmark tables behind this audit (#257) were not kept in the repository.
