# Later: ships when ready

This is the list of planned work that has no release of its own: each package ships when it is ready, in the release then in flight, and leaves this page when it ships. Live status is on the Real Boy board, https://github.com/users/abucnasty/projects/2; this page does not follow every merge. The milestones and follow-ups it names are in [ROADMAP.md](../ROADMAP.md), and the themed releases are in [0.21.0.md](0.21.0.md) to [0.24.0.md](0.24.0.md).

The goals keep their order ([GOALS.md](../../GOALS.md)): goal 1, the clock meets its target exactly and recovers; goal 2, the fewest wake-ups. Model corrections are reported apart from search-only changes, and search-only changes keep every result identical. The time spent searching at generation does not grow ([working rules](../working-rules.md), rule 6).

## Packages

Packages are named `later/<code>` and come in no fixed order.

### Thaeln's cell 09

**`later/thaeln-cell09`**: a plan and a clock that support Thaeln's build (`REAL_THAELN_CELL09`) through the generator's general rules. Its coal inserter moves 15/8 hands a cycle, which stretches every planned clock to eight cycles (1,344 ticks). None of the clocks planned for it is stable, so the generator falls back to the observed-windows search, which takes about ten minutes, by far the slowest of any sample. It starts from a clock Thaeln made for this build that works in the game, which the owner will provide, and turns what its windows do into a planning rule. What the generator does today: all eight standard alternatives are unstable at 480 a second; planning with the coal out of the period (336 ticks) is unstable too; and the observed-windows search on that period ends at "no recovery", at about 1,155 wake-ups a minute. The owner is not convinced the generator supports this build correctly and investigates it apart from 0.19.0, which leaves it out of its checks and game runs. Done when the generator plans a clock for this build by a rule that applies to any inserter with a fractional hand count, without the observed-windows search; the clock holds in the game with recovery, and every other sample's result is unchanged or checked again in the game.

### A complete productivity chain

**`later/productivity-chain`**: a complete multi-machine chain sample (issue #89) in place of the productivity-module sample 0.19.0 drops (#279). That sample was an early sketch of a five-machine chain, copper cable, plastic, electronic circuits and advanced circuits into productivity modules at 40 a second, with no raw inputs and no output belt; the coverage check has refused it since #53. The replacement has its inputs, an output belt and a scaffold. Done when the sample generates, is among the samples every engine change is checked against, and its selected clock is checked in the game.

### If chosen: other inserters on belts

**`later/f7`** delivers follow-up F7. 0.19.0 refuses a belt pickup by anything but the legendary stack inserter and warns about pickups outside 16-item hands on 4-item stacks, because belt timing is calibrated there only; a belt drop by another kind runs on the stack inserter's drop model. Measure in the game, for the kinds and qualities the owner names (by default every kind at normal and legendary quality), pickup and drop timing at all four speeds, moving and backed-up; and for the legendary stack inserter, pickups from 1–3-item stacks and with a smaller hand. Every pickup calibration and clock control so far is 16-item hands on 4-item stacks (#270 warns); the 8- and 12-item hands of the same-item captures are seeded checks only. The questions to settle in the game: with stack 3 against a hand of 16, the model takes 3+3+3+3+3+1, so does the game stop at 15; 16-grab hands at stack 1 (reach and refill); and the fixed 4-tick belt pickup in the swing period. One capture gap goes with these: a belt of unstacked items exports as 4 once belt stacking is researched, which the warning cannot see; the fix is to export the largest stack seen on the lane, without the research floor. Two capture gaps go with it: a non-stack inserter does not stack items on a belt in the game, but the model drops a stacked hand for it; and an inserter with filters on and an empty whitelist is exported like one with filters off. Done when the straight-pickup and belt-drop controls pass for each measured kind, the refusal is lifted for exactly those, and the warning is narrowed to what stays unmeasured.

### A rocket silo that crafts and launches

**`later/silo-phase-2`** delivers phase 2 of milestone M2. 0.20.0 makes a rocket silo a chest, with no craft run. A silo that crafts and launches waits for its launch sequence and timings to be recorded in the game; whether it is then a machine or something new is open.

### The swing-back hand

**`later/swing-back`** (#276): when another inserter takes a machine's products off its output block in the tick a belt hand comes back from its swing, the simulator has the hand take its first stack in that tick. In the game it comes a tick later when the taker drops onto a belt (56 of 56 hands), and by the decider order when it drops into a chest (79 of 79). The game's rule, tried in the simulator, moves no selected clock. It is recorded as a known limit in [simulator.md](../simulator.md#other-known-limits).

## Decisions before they start

- Follow-up F7: whether it is taken on, and which inserter kinds and qualities to calibrate.
- `later/swing-back`: whether the swing-back hand becomes a model change.
