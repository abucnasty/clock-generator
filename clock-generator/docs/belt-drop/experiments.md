# Belt drop experiment findings

[Belt drop documentation](README.md)

What was measured, how the probe was validated, and where the simulator differs. The tables of the measurements are in the
[timing reference](timing.md).

## Coverage

All on turbo belts and undergrounds, Factorio 2.1.24, one legendary stack inserter or one inserter of the kind named, a steel chest with 64 iron
plates, the first hand judged (later hands are in the recordings). **1,444 scenarios in 11 recordings**, kept in
`tests/game/mechanics/belt-drop-timing/recordings/`.

| Question | Measured | Not measured |
| --- | --- | --- |
| Approach | the four sides and ends of a straight line (`left`, `right`, `back`, `front`) and eight at an underground pair: beside the entrance and the exit (both sides), into and over the hood of each | side-loading, splitters, bends, a line that turns |
| Direction the line runs | east for every approach; north, south and west for the four sides and ends, empty lane (identical to east at all four belt stack sizes) | |
| Belt speed | turbo (the game tests keep one tier); the earlier calibration measured an empty lane at the four speeds | express, fast, normal |
| Belt stack size | 1, 2, 3 and 4 for the legendary stack inserter, 1, 3 and 4 for the other kinds | |
| Lane state | empty; a stream on 25%, 50% and 75% of the lane in every phase; a full lane; a queue of 2, 3 and 4 stacks at a dead end | traffic from a second inserter, a lane that is stationary and full beyond the drop point |
| Inserter kind | the stack inserter at legendary quality at all four belt stack sizes; at normal and legendary quality: inserter, long-handed inserter, fast inserter, bulk inserter, stack inserter | the three qualities between; the burner inserter (needs fuel, refused by the engine) |

**The kinds the pickup refusal lifts for.** The engine refuses a belt pickup for every kind but one: the legendary stack inserter, the only row
of `BELT_PICKUP_CALIBRATED` (`inserter-spec.ts`; `inserter-scope.ts` refuses the rest with "not supported yet", follow-up F7). The other
kinds work on chests and machines, and drop on belts, which is what this sweep measures: the **inserter, long-handed inserter, fast
inserter, bulk inserter and stack inserter, each at any of the five qualities** (the five prototypes of the game data less the burner
inserter). A drop onto a belt is not refused for any of them. The pickup refusal itself is unchanged.

## Validation against the earlier calibration

Before any new case counted, the probe ran the calibrated case alone (`validation-1` to `-4`): turbo, one orientation (east), the side the
scaffold's inserter stands on (`left`), an empty lane, belt stack sizes 1 to 4. It reproduces `Belt.amountToDropAtTick`'s ticks (offsets
`0,1,2,4,6,…`), the amounts (1, 2, 3, 4 and the 15-item hand at 3), the landings at 3/8, 1/2, 5/8 and 5/8 tile from the end, and the
earlier calibration's own baseline file (`speed-expectations.json`, turbo): both hands at every size, and the time between hands (36, 20,
14, 12 ticks). The same scenario in the run of the whole matrix gives identical figures. The earlier test
(`belt-drop/turbo-stacks.game.test.ts`) still passes on 2.1.24 for all four turbo sizes, so the game did not move between 2.1.21 and 2.1.24 on this.

## Where the simulator differs

"The simulator" is its lane rule for a belt drop (`LaneTraffic`, used by `BeltHandDrop`; the rule is in
[the simulator page](../simulator.md#a-stack-inserter-dropping-onto-a-moving-lane)) and, for an empty lane, `Belt.amountToDropAtTick`. The
comparison is made offline (`recordings.test.ts`, `simulator-replay.ts`): for the first hand of each scenario on a straight line the
simulator is given the hand it would give that inserter (the configured hand cut to whole belt stacks), the tick the hand first tries to drop
(the game's pickup and its wait on an empty lane) and the scenario's own stream of copper as the stock on the lane, and its stacks'
ticks, sizes and places are set against the game's. No simulator code was changed.

| Case | Game | Simulator today | Verdict |
| --- | --- | --- | --- |
| Empty lane, a side or behind, legendary stack inserter, belt stack 1–4, any direction | `0,1,2,4,…`, landings 3/8, 1/2, 5/8 (behind: 0.176, 0.301, 0.426) | the same, all 3 approaches × 4 sizes × 4 directions | **equal** |
| Stream on 50% of the lane, full lane | see [timing](timing.md) | the same ticks and places in all 12 first hands per size at 50% (3 approaches × 4 phases) and the 3 per size on a full lane | **equal** |
| Stream on 75% of the lane | `0,6–8,14–16,22–24,…` | the same ticks; behind the line, in one phase of eight, the first stack lands 0.07 tile from where the game puts it (0.824 against 0.754 along) | **equal but one landing** (23 of 24 per size) |
| Stream on 25% of the lane | in 6 of 8 phases per approach the simulator is right; in the others the game puts the second stack down in the next tick (side drops, phases 4 and 6: `0,1,4,6,…` and `0,1,2,6,…`; behind the line, phases 2 and 4), a tick after the first, 1/8 tile behind it, with a stream stack within a quarter tile behind its landing (that stack waits a tick) | the second stack a tick or more later and a quarter tile further back (3.25 against 3.5 along) | **differs** in 6 of 24 first hands per belt stack size |
| A line that ends at the inserter (`front`) | the last tile holds four stacks of a lane; fewer with a queue; the rest of the hand stays in the inserter | the whole hand lands (the rule assumes a freely draining lane, as the simulator page says); equal only for a hand of exactly four stacks on an empty lane (belt stack 4) | **differs** at belt stack 1–3 and with any queue |
| An underground end the line flows through, 7 approaches | `0,1,3,5,7,…` (the third stack a tick later) for 6; `entrance-from-downstream` `0,1,2,4,…`; the stacks read on a 0.5-tile open half | no underground drop: a belt drop with `0,1,2,4,…` at the middle of a tile | **differs** from the third stack on for 6 of 7, and in where every stack lands |
| A drop into the hood of an exit, where the line ends | two stacks, then none | the whole hand | **differs** |
| Other kinds than the stack inserter, belt stack 1 | one item a drop, `0,1,2,4,…` | one stack of 1 item a drop: the same | **equal** |
| Other kinds than the stack inserter, belt stack 3 or 4 | one item a drop (`0,1,2,4` for a hand of 4; 12 drops over 21 ticks for the bulk inserter's 12); the hand is not cut to whole belt stacks (4 at belt stack 3) | whole belt stacks: one drop of 4 for a hand of 4 (belt stack 4), a hand of 3 for the basic inserter at belt stack 3, three drops of 4 for the bulk inserter | **differs**: the hand's drop phase is 4 ticks (basic, long-handed, fast) to 16–18 ticks (bulk) shorter in the simulator, which puts the hand's items in one slot of the lane where the game uses four |
| The swing from chest to belt (delay to the first drop), all five kinds, both qualities | `rotation + 1`: 35, 14, 24, 9, 12, 4, 12, 4, 12, 4 | `rotationTicks(prototype, quality) + 1` | **equal** |
| Lane choice by approach | the lane farther from the inserter for a side drop; the right lane (2) for a drop along the line, either way; the same for every kind | a hand with no named drop spot takes the lane of its item or the larger stack; the config's `drop` names the lane | not compared (the config names the lane, as the [lane probe](../../tests/game/mechanics/belt-drop-lane/README.md) says) |

**Reproducibility.** The same scenario built in two runs (the legendary stack inserter of `stack-n` and of `kinds-n`, with the same hand, stream
and phase) gives the same ticks, sizes and lanes, and the same landings in 22 of 24 pairs. The two that differ are one scenario at belt
stack 1 and 4: behind the line, a stream of 50%, phase 2. The first stack is read 0.246 tile from the end in `stack-n` and 0.176 in
`kinds-n` (0.07 tile apart, a stream stack beside it); the ticks agree. Most likely it is whether the game updates the inserter or the belt
first within that tick, which follows the order the entities were built in (not isolated here). A landing beside a stream stack is
therefore good to about 0.07 tile, and the one case the simulator misses on a 75% stream (0.754 against 0.824 along) is inside that.

The 25% phases the rule misses were tried against five variants of the one comparison in `LaneTraffic.landingAt` that decides whether a
stream stack counts as ahead of the landing (on the offline replay, scratch only, not kept): none does better than the rule as it is (224 of
252 first hands with a stream or a full lane over the four sizes; the variants give 224, 212 or 0), so the fix is not that comparison alone.

### What a release that takes the fix would change

For the release that takes #388's simulator half; none of it is done here.

1. A drop's size by kind: one item a drop for every inserter except the stack inserter (and no cutting of its hand to whole belt stacks), the
   stack inserter's belt stack as now.
2. A line that ends: a belt (or an underground exit) the config marks as ending at the inserter holds the last tile's room (four stacks a
   lane, two on an exit's open half), and the hand waits for it; the rule's free-drain assumption holds only without it.
3. Underground ends as drop targets, with their tick pattern (`0,1,3,5,…`, or `0,1,2,4,…` across an entrance's hood), and a drop point
   by approach (hood half or open half) instead of the single spot at the middle of a tile.
4. The phases of a 25% stream the rule gets wrong: the game puts the second stack down a tick after the first although a stream stack stands within
   a quarter tile behind the landing (that stack waits a tick); the simulator puts it down a tick or more later. The drop-spacing check
   (`src/config/drop-spacing.ts`, [drops of several copies](../simulator.md#drops-of-several-copies-onto-one-belt)) asks the same rule.
5. Any clock or verdict that moves must be checked in the game, as the issue says; none moves here.

## Related to the other documents

- The pickup sweep's coverage matrix lists belt drops at stack sizes 1–4 on the four speeds
  ([experiments](../belt-pickup/experiments.md#related-belt-drop-calibration)); this sweep adds the approaches, lane states and kinds.
- The [lane probe](../../tests/game/mechanics/belt-drop-lane/README.md) found the lane and the drop positions for the basic and the stack
  inserter at a yellow belt; this probe's turbo figures agree (the far lane for a side drop, the right lane along the line, a basic inserter
  one item at a time).
