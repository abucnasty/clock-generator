# Clock candidate strategies

The generator tries scheduling strategies, then checks their output, sampled starts and recovery after input
starvation and output blockage. A strategy can produce the same clock as another strategy on one build and a useful
different clock on another. Identical verification results should be shared within a generation.

## Purpose and removal audit

The October 2026 audit recommends **no immediate strategy removal**. These are the current supporting examples;
game recordings establish behavior for their recorded fixtures, not every possible build.

| Strategy | Purpose and evidence | Recommendation |
| --- | --- | --- |
| Batched swings | Baseline schedule grouped around the crafting cycle. | Keep. |
| Fractional swings | Handles fractional hand counts. [Utility Science](../src/crafting/utility-science.generation.test.ts) selects it at 16.07 wake-ups/minute versus 26.79 for batched swings. | Keep; share duplicate verification when no different clock results. |
| Other output swing counts | Changes buffering and the period. [Logistic Science](../src/crafting/logistic-science.generation.test.ts) selects three moving-supply swings or two backed-up swings; Agriculture selects two. Native LDS measurements also favor a longer cycle. | Keep both shorter and longer cycles. |
| Even hands | Synchronizes inserters sharing sources or mirrored machines. The [accumulator control](../src/crafting/candidates/even-hands.test.ts) recorded 576 items in each of 46 periods. | Keep. |
| Observed windows | Derives windows from actual transfers. [Production Science](../src/crafting/generate-blueprint.generation.test.ts) has a regression where planned windows fail and observed windows pass; Logistic's explicit search improves its default selection. | Keep; share duplicate verification. |
| Full-hand output | Avoids repeated partial grabs while allowing surplus to drain after blockage. [Automation Science](../src/crafting/automation-science.generation.test.ts) needs this search for a stable candidate. The [Advanced Circuit 230 recording](../tests/game/builds/scaffold-recordings.game.test.ts) verified 16,192 items in each of two 12,672-tick repeats. | Keep. |
| Shorter-period variants | Removes an ingredient's hand count from the period calculation where buffering permits it. [Backed-up Utility Science](../src/crafting/clock-belt.generation.test.ts) selects the low-density-structure variant. | Keep. |
| Shifted swings | Moves a whole input/output round within machine inventory limits. [Tests](../src/crafting/output-swings.generation.test.ts) show distinct stable schedules, but the audit found no current unique winner or game-only success requiring it. | First candidate for a measured removal trial; insufficient evidence to remove now. |
| Uneven output swings | Moves an output swing and observes new input windows. [Tests](../src/crafting/output-swings.generation.test.ts) show distinct stable windows. Historical [belted Utility findings](../resources/config-samples/README.md) recorded 96 items in each of 107 periods, with five windows instead of seven at the same wake-up rate. | Review after shifted swings; a real recorded scheduling benefit must first be replaced. |
| Backed-up alternative | Models a different input supply condition and is ranked against the user's belt choice. | Keep pending a separate decision about offering supply alternatives. |

History supports treating these as scheduling methods, rather than assuming they were simulator workarounds:
`06f650ab` introduced shifted and uneven swings around machine limits; `aa1aec0f` introduced full-hand output;
`bc3027f4` added even hands to synchronize mirrored takers after an insertion-limit correction.

Before removing a strategy, compare all relevant fixtures with explicit searches enabled, including moving and
backed-up supply. Record any lost stable clock, recovery guarantee, throughput, wake-up improvement or window-count
advantage. Retain game-backed examples as regression controls. No strategy has been removed by this audit.

## Duplicate verification

The audit found overlapping clocks from batched/fractional/observed strategies on Automation Science and
batched/fractional on Logistic Science. Agriculture's batched and fractional clocks also match, but the old signature
missed that match because their inserter-window object keys were inserted in different orders.

Verification identity ignores object member order and preserves array order, including entity update order. It
includes physical config, moving/backed-up assumptions, pickup geometry, seeds, expected output, automatic clocks,
transfer counts and the clock-only check with any failure witness. A planning-only fractional distribution can be
ignored at a forced whole output swing count when every entity is explicitly clocked, always enabled or disabled;
AUTO fuel controls remain distinct.

Sequential generation shares recovery and requested start-dependence assessments within the request. UI workers
can skip an assessment already owned by the primary or by a completed earlier display entry. Later entries cannot
suppress earlier entries merely by finishing first. Clock-only checks still run while constructing each candidate;
this is not a claim that every repeated planning or simulation step has been eliminated.

## Local performance check

Measured October 19, 2026 with Node 25.2.1, the bundled UI worker, structured-cloned messages and one worker. Timing
excludes module/data loading and browser startup. The baseline is the implementation before verification reuse and
the one-swing queue change. Agriculture is one fresh before/after pair; smaller samples are medians of three fresh
processes per implementation, alternating order. These are local measurements, not CI or browser latency promises.

| Build | Total seconds before → after | CPU seconds before → after | First fully verified clock, seconds before → after |
| --- | --- | --- | --- |
| Agriculture | 98.348 → 84.498 | 100.217 → 86.290 | 80.403 → 32.399 |
| Automation | 1.534 → 1.547 | 2.001 → 2.024 | 1.329 → 1.340 |
| Logistic | 0.548 → 0.570 | 0.870 → 0.929 | 0.125 → 0.133 |
| Utility | 2.274 → 2.252 | 2.763 → 2.756 | 0.427 → 0.431 |

Agriculture used about 14% less CPU; an earlier optimized run also finished in 85.5 seconds. Smaller samples do not
show a material wall-time gain, and Logistic has a small regression. No additional workers were used.

Every retained complete clock view, assessment, blueprint and history matched its baseline, and each selected clock
was unchanged. Agriculture lists nine clocks instead of ten because the duplicate fractional row is gone. Validation
passed 1,438 engine unit tests, 1,590 UI tests and all 232 generation tests with their full test names unchanged.
