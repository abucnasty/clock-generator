# Later: ships when ready

This is the list of planned work that has no release of its own: each package ships when it is ready, in the release then in flight, and leaves this page when it ships. Live status is on the Real Boy board, https://github.com/users/abucnasty/projects/2; this page does not follow every merge. The milestones and follow-ups it names are in [ROADMAP.md](../ROADMAP.md), and the themed release is in [0.24.0.md](0.24.0.md).

The goals keep their order ([GOALS.md](../../GOALS.md)): goal 1, the clock meets its target exactly and recovers; goal 2, the fewest wake-ups. Model corrections are reported apart from search-only changes, and search-only changes keep every result identical. The time spent searching at generation does not grow ([working rules](../working-rules.md), rule 6).

## Packages

Packages are named `later/<code>` and come in no fixed order.

### If chosen: other inserters on belts

**`later/f7`** delivers follow-up F7. 0.19.0 refuses a belt pickup by anything but the legendary stack inserter and warns about pickups outside 16-item hands on 4-item stacks, because belt timing is calibrated there only; a belt drop by another kind runs on the stack inserter's drop model. Measure in the game, for the chosen kinds and qualities (by default every kind at normal and legendary quality), pickup and drop timing at all four speeds, moving and backed-up; and for the legendary stack inserter, pickups from 1–3-item stacks and with a smaller hand. Every pickup calibration and clock control so far is 16-item hands on 4-item stacks (#270 warns); the 8- and 12-item hands of the same-item captures are seeded checks only. The questions to settle in the game: with stack 3 against a hand of 16, the model takes 3+3+3+3+3+1, so does the game stop at 15; 16-grab hands at stack 1 (reach and refill); and the fixed 4-tick belt pickup in the swing period. One capture gap goes with these: a belt of unstacked items exports as 4 once belt stacking is researched, which the warning cannot see; the fix is to export the largest stack seen on the lane, without the research floor. Two capture gaps go with it: a non-stack inserter does not stack items on a belt in the game, but the model drops a stacked hand for it; and an inserter with filters on and an empty whitelist is exported like one with filters off. Done when the straight-pickup and belt-drop controls pass for each measured kind, the refusal is lifted for exactly those, and the warning is narrowed to what stays unmeasured.

### A rocket silo that crafts and launches

**`later/silo-phase-2`** delivers phase 2 of milestone M2. 0.20.0 makes a rocket silo a chest, with no craft run. A silo that crafts and launches waits for its launch sequence and timings to be recorded in the game; whether it is then a machine or something new is open.

### The swing-back hand

**`later/swing-back`** (#276): when another inserter takes a machine's products off its output block in the tick a belt hand comes back from its swing, the simulator has the hand take its first stack in that tick. In the game it comes a tick later when the taker drops onto a belt (56 of 56 hands), and by the decider order when it drops into a chest (79 of 79). The game's rule, tried in the simulator, moves no selected clock. It is recorded as a known limit in [simulator.md](../simulator.md#other-known-limits).

### Copies that differ in a drill's speed bonus

**`later/repeat-drill-bonus`** (#375): the conversion of a repeated build does not find copies that differ only in a drill's speed bonus, as on the grenade full build.

### Spoilage-removal inserters

**`later/f6`** delivers follow-up F6: spoilage-removal inserters clocked from the spoil time. The simulator has no spoilage ([game-data-and-scope.md](../game-data-and-scope.md)). Since 0.23.0 a build whose items spoil is tried with losses shorter than three quarters of its shortest spoil time ([stability.md](../stability.md)); this package would add the inserters that remove the spoilage.

## Decisions before they start

- Follow-up F7: whether it is taken on, and which inserter kinds and qualities to calibrate.
- `later/swing-back`: whether the swing-back hand becomes a model change.
- `later/f6`: whether it is taken on.
