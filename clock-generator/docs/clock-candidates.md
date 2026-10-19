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
| Other output swing counts | Changes buffering and the period. [Logistic Science](../src/crafting/logistic-science.generation.test.ts) selects three moving-supply swings or two backed-up swings; Agriculture selects two. The removal trial below confirms a current benefit from the farthest longer-cycle candidate on iron bacteria. | Keep both shorter and longer cycles. |
| Even hands | Synchronizes inserters sharing sources or mirrored machines. The [accumulator control](../src/crafting/candidates/even-hands.test.ts) recorded 576 items in each of 46 periods. | Keep. |
| Observed windows | Derives windows from actual transfers. The removal trial below worsens backed-up belted Utility from 0 to 10.71 wake-ups/minute. [Production Science](../src/crafting/generate-blueprint.generation.test.ts) also has a regression where planned windows fail and observed windows pass. | Keep; share duplicate verification. |
| Full-hand output | Avoids repeated partial grabs while allowing surplus to drain after blockage. [Automation Science](../src/crafting/automation-science.generation.test.ts) needs this search for a stable candidate. The [Advanced Circuit 230 recording](../tests/game/builds/scaffold-recordings.game.test.ts) verified 16,192 items in each of two 12,672-tick repeats. | Keep. |
| Shorter-period variants | Removes an ingredient's hand count from the period calculation where buffering permits it. [Backed-up Utility Science](../src/crafting/clock-belt.generation.test.ts) selects the planned low-density-structure variant. The observed variant independently improves inserter-crafting Logistic Science's ranking and recovery. | Keep both planned and observed variants. |
| Shifted swings | Moves a whole input/output round within machine inventory limits. The removal trial below finds uniquely better-ranked clocks for Flying Robot Frame, Chemical Science and a backed-up Utility variant. | Keep as a deferred search; removal worsens supported results. |
| Uneven output swings | Moves an output swing and observes new input windows. The removal trial below finds a uniquely better-ranked moving-supply Utility clock. Historical [belted Utility findings](../resources/config-samples/README.md) recorded 96 items in each of 107 periods, with five windows instead of seven at the same wake-up rate. | Keep as a deferred search; removal worsens a default fallback result. |
| Backed-up alternative | Models a different input supply condition and is ranked against the user's belt choice. With no belt-pickup inserters it rebuilds an exact primary duplicate. | Skip construction only when no inserter takes from a belt; retain it for belt-fed builds. |

History supports treating these as scheduling methods, rather than assuming they were simulator workarounds:
`06f650ab` introduced shifted and uneven swings around machine limits; `aa1aec0f` introduced full-hand output;
`bc3027f4` added even hands to synchronize mirrored takers after an insertion-limit correction.

Before removing a strategy, compare all relevant fixtures with explicit searches enabled, including moving and
backed-up supply. Record any lost stable clock, recovery guarantee, throughput, wake-up improvement or window-count
advantage. Retain game-backed examples as regression controls. No strategy has been removed by this audit.

## Shifted-swings removal trial

The trial compares the verified alternatives with and without the Shifted-swings strategy using the production
ranking function. Raw runs are retained so an equivalent later alias can reappear after the strategy is excluded.
Unavailable candidates and candidates dominated by an already verified earlier entry do not require evaluating
every other strategy. No clock-start, lane-phase or recovery checks are weakened.

The sweep attempted all 44 named configuration fixtures with both moving and backed-up supply: 88 conditions.
It assessed 82; six failed before the removal comparison because their baseline primary could not be generated.
These were Productivity Module (missing belt 1), the intentionally bad Accumulator config (ready-state timeout),
and StupidFatHobbit cell 02 (an output belt without a consumer), each in both supply modes. They are unassessed,
not successful removal controls. Processes ran sequentially at local commit `944ddc34`.

No assessed condition lost the availability of a stable clock or a clock passing all recovery checks. Four
conditions lost a better-ranked clock, listed below. This compares availability and production ranking; it does
not prove preservation of the fastest recovery among every alternative on every build.

These are modeled outcomes, with simulated wake-ups per minute for one build copy. Arrows show **with → without**
Shifted swings; both selected clocks remain stable at the target rate and pass all modeled recovery checks.

| Build | Supply | When it matters | Wake-ups/minute | Windows | Worst recovery, clock periods |
| --- | --- | --- | --- | --- | --- |
| Flying Robot Frame | Moving | Deeper search | 0 → 12.50 | 5 → 5 | 3 → 3 |
| Chemical Science, shared foundry | Moving and backed up | Deeper search | 81.023 → 82.214 | 36 → 48 | 4 → 4 |
| Utility Science, always-enabled LDS chain | Backed up | Default fallback search | 580.602 → 631.616 | 8 → 8 | 6 → 7 |

Fresh-process A/B generation confirmed Flying Robot Frame with both default and deeper-search settings, and the
backed-up Utility default fallback. Exclusion was applied only to an in-memory diagnostic module; production source
and compiled files stayed unchanged. Every other candidate's assessment and ranking matched its control.

Flying Robot Frame retains its 160 items/second and Utility its 240 items/second. Utility's replacement uses the same
384-tick period but takes an extra period to recover in the worst modeled trial. Flying Robot Frame's default result
is unchanged because its search already waits for an explicit request. The strategy remains in the generator.

## Uneven-output removal trial

The same comparison was repeated for Uneven output swings, leaving Shifted swings available and preserving raw
aliases and every verification check. All 88 conditions were attempted; 82 were assessed, with the same six baseline
failures listed above. No assessed condition lost stable/full-recovery availability. One lost a better-ranked clock:
the moving-supply Utility Science build with the always-enabled LDS chain, in default fallback generation.

| Metric | With Uneven output swings | Without it: Shifted swings |
| --- | --- | --- |
| Output rate | 240 items/second | 240 items/second |
| Wake-ups/minute per build copy | 631.616 | 669.764 |
| Windows | 8 | 8 |
| Clock period | 384 ticks | 384 ticks |
| Worst recovery | 5 periods | 5 periods |

The replacement adds about 6% more modeled wake-ups. This is a current scheduling benefit: the batched and observed
windows fail coal-starvation recovery on this build, while both search results pass. Uneven output swings moves the
second output swing 24 ticks later and derives new input windows; Shifted swings moves the whole second round
35 ticks earlier. They do not produce the same schedule.

Fresh-process complete-generation A/B confirmed the replacement and both sets of selected clock windows. Every
other candidate's assessment and ranking matched its control. The exclusion existed only in memory; production
source and compiled files stayed unchanged. This trial compares availability and production ranking, not the fastest
recovery among every alternative on every build.

The older belted Utility fixture no longer needs this strategy for its best ranking. That does not justify removing
it from other builds. Keep Uneven output swings as a deferred search.

## Further removal trials

The next trials stopped when a counterexample established distinct value. Complete-generation A/B runs confirmed
each replacement, with the production definitions changed only in memory. Arrows show **with → without** the named
candidate. All selected clocks below retain their target output and full modeled recovery.

| Candidate excluded | Counterexample | Search setting | Wake-ups/minute | Windows | Worst recovery, ticks |
| --- | --- | --- | --- | --- | --- |
| Observed windows | Belted Utility, combined blue/LDS, backed up | Deeper search | 0 → 10.714 | 5 → 7 | 1,344 → 1,344 |
| Farthest longer swing count | Iron bacteria, moving | Default | 3,533.700 → 4,800.330 | 18 → 38 | 1,728 → 1,728 |
| Observed windows with a shorter period | Inserter-crafting Logistic Science, moving | Default fallback | 7,360.875 → 9,088.950 | 21 → 59 | 120 → 360 |

Removing all longer counts also worsens iron bacteria; removing only the six-swing candidate is enough to cause the
default regression. The shorter-period observed search was compared in five conditions before the Logistic
counterexample was found. Recovery is compared in ticks because its replacement has a 360-tick period instead of
120 ticks: both say one period, but the replacement takes three times as long. These trials also compare the fastest
modeled recovery among target-rate clocks matching the configured supply. No full-corpus removal safety claim is made
for these retained strategies.

## Redundant construction when there are no belt pickups

The backed-up-belt alternative (`planned`) is redundant when **no inserter has a belt source**, including fuel and
always-enabled inserters. There is no pickup supply to change: the entity registries match across the supply flags,
and every valid sample tested gives this alternative the primary clock's exact verification signature. The generator
previously discarded its result as a primary duplicate, after constructing and checking the clock again.

The scoped sweep covered seven such named fixtures in both supply modes: 12 valid conditions and two unassessed
Productivity Module conditions with the existing missing-belt error. All six valid moving-supply cases are exact
primary duplicates; with backed-up supply the alternative is already absent. No stability, recovery, target-rate or
ranking loss was found. The guard leaves belt-fed builds eligible for the alternative. Checking only whether
the primary clock has a belt label would be insufficient: an always-enabled belt pickup still changes supply behavior.

The in-memory guard was benchmarked with three alternating-order pairs of fresh Node 25.2.1 processes per fixture,
sequentially, on local commit `944ddc34`. Timings cover default `generateClockAlternatives`, excluding module/data
startup and result fingerprinting. No additional workers were used. Values are medians in seconds:

| Build | Wall time, with → without redundant construction | CPU time, with → without |
| --- | --- | --- |
| Stone bricks, direct insert | 0.526 → 0.504 | 0.869 → 0.835 |
| Stone bricks, direct insert 2:1 | 0.598 → 0.569 | 0.908 → 0.863 |
| Lithium plates | 0.945 → 0.753 | 1.367 → 1.150 |
| Processing units | 0.326 → 0.300 | 0.592 → 0.563 |
| Accumulator 640 | 1.310 → 1.250 | 1.673 → 1.620 |
| StupidFatHobbit cell 06 | 1.346 → 1.320 | 1.667 → 1.641 |

All 18 paired comparisons retained identical selected clocks, displayed alternatives, assessments, skipped searches
and complete result fingerprints, including blueprints and histories. Additional complete-generation pairs with
explicit searches on Accumulator and Lithium, plus a belt-fed Logistic negative control, also matched. The negative
control retained its backed-up alternative. The savings are limited to builds without belt pickups; Agriculture is
outside this guard. The implemented guard has regression coverage for output-only belts, always-enabled pickups,
fuel-only pickups and explicitly configured backed-up supply.

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

## Follow-up profile and construction guard

This baseline already includes [PR 244](https://github.com/abucnasty/clock-generator/pull/244): cached mode evaluators
and clock lookups, debug plugins only when requested, per-kind tick loops, history-plugin removal for recovery, and
earlier alternative-task scheduling. Warmup, clock-only simulation and recovery use those optimized paths. The
ordering change below extends its competing-taker optimization; the measured gains do not reapply PR 244's savings.

A fresh Agriculture profile at `944ddc34` attributes about 68 of 86 seconds to recovery, while planning takes under
one second. The four recovery assessments have different inputs: there is no additional duplicate verdict to skip.
Repeated lower-level simulations remain, including about three seconds of repeated clock-only checks. Their mutable
simulation contexts cannot be shared through an unrestricted result cache.

The profile also identifies inserter update ordering as a hot path. The updater now retains its execution list,
ignores groups whose ranked and original orders already match, and rewrites a group's places only when its turn rule
changes. Every group's decision still uses stock from the start of the tick. Seed draws remain unchanged for later
groups, and a group returns to its original order when the rule closes. No sampled start or recovery trial is removed.

The following compares `944ddc34` with this ordering change and the no-belt-pickup guard, using the same bundled UI
worker protocol and one worker. Agriculture is one fresh pair; other rows are medians of three alternating-order
pairs. Both implementations run sequentially, with the same data and Node version as above.

| Build | Total seconds before → after | CPU seconds before → after | First fully verified clock, seconds before → after |
| --- | --- | --- | --- |
| Agriculture | 83.753 → 81.560 | 85.470 → 83.384 | 32.198 → 31.098 |
| Automation | 1.523 → 1.547 | 1.985 → 2.006 | 1.319 → 1.342 |
| Logistic | 0.549 → 0.546 | 0.874 → 0.871 | 0.126 → 0.126 |
| Utility | 2.269 → 2.279 | 2.783 → 2.782 | 0.439 → 0.431 |
| Lithium plates | 0.994 → 0.781 | 1.450 → 1.205 | 0.381 → 0.376 |

All paired complete UI results match, including selected clocks, rankings, verdicts, blueprints, histories and skipped
searches. Lithium benefits from avoiding duplicate construction. Agriculture improves modestly, about 2.6% wall time
and 2.4% CPU; its full generation still takes over a minute in this local measurement. The smaller belt-fed samples
do not establish a speedup, and Automation has a small regression of about 24 ms. These measurements do not establish
browser or CI latency guarantees.

Validation passed 1,445 engine unit tests, all 232 generation tests across 17 files, and 1,590 UI tests, using one
worker for each suite. The generation test names are unchanged. Engine/UI builds, typechecks, lint and unused-code
checks also passed. The audit and follow-up changes remain local pending review.

A separate one-worker trial used the existing quiet logger in Agriculture's 15 generation tests, which do not assert
on logs. All names and statuses stayed unchanged, but file runtime was essentially unchanged: 160.269 → 160.981
seconds. The trial was reverted; console capture does not explain the long runtime in this measurement.
