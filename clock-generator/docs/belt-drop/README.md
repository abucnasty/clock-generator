# Belt drop documentation

When an inserter's hand lands on a turbo belt: the tick of each stack, the lane and the place it lands on, from each side and end of a
line and of an underground pair, with the receiving lane in each state, for each inserter kind. Measured in the game (Factorio 2.1.24,
2026-11-05) for [#388](https://github.com/abucnasty/clock-generator/issues/388); **turbo belts and undergrounds only, the tier the game tests
keep**. This is a measurement and its write-up: the simulator is not changed by it, and [experiments](experiments.md#where-the-simulator-differs)
states where it differs, for the release that takes the fix.

- [Diagram glossary](glossary.md): the twelve approaches, where each drop point falls, the lane states, how positions are read.
- [Timing reference](timing.md): the measured tables, one per question.
- [Experiment findings](experiments.md): coverage, the validation against the earlier calibration, and the differences from the simulator.
- [Capture and configuration](capture.md): the probe, the recordings and how to repeat a run.

The [earlier calibration](../../tests/game/mechanics/belt-drop/fixtures/turbo-stacks/README.md) covers one case (a side drop onto an empty
lane at belt stack sizes 1 to 4) and `Belt.amountToDropAtTick` stands on it; this probe reproduces it before it judges anything new. The
[pickup documentation](../belt-pickup/README.md) is the same sweep for pickups, and its terms for the underground ends (entrance, exit,
hood, open half) are used here.

## In short

- **A straight line**, dropped on from a side or from behind its first tile, takes the stacks of an empty lane at ticks `0,1,2,4,6,…` from
  the first, whichever way the line runs: this is the calibrated case, and the drop from behind is the same. The first stack is read one step
  of the belt (1/8 tile) past its drop point, the second a further 1/8 behind that, the third and every later one at the same place as the
  third: from the side at 3/8, 1/2, 5/8 and again 5/8 tile from the end of the belt piece, from behind at 0.176, 0.301, 0.426 and again 0.426. A
  drop from a side lands on the lane **farther** from the inserter; a drop along the line, either way, on its right lane.
- **An underground end** takes `0,1,3,5,7,…`: the third stack comes a tick later than on a straight line. The exception is a drop from
  downstream of an entrance, across its hood onto its open half, which keeps `0,1,2,4,…`. A drop **into the hood** of an entrance puts
  every stack at the hood's mouth, where it goes below ground; a drop from downstream into the hood of an exit, where the line ends,
  takes two stacks and then none.
- **A line that ends at the inserter** takes a hand until its last tile is full: four stacks (a tile of a lane), fewer with a queue
  at its end, none with four queued.
- **A moving lane** with stacks on it delays and spreads the hand: a stream that fills a quarter of the lane makes a hand of four stacks
  last 6 to 8 ticks instead of 4, half of it 10 to 12, three quarters 22 to 24, and a full lane keeps the hand waiting until the
  stream has passed, then takes a stack every second tick. Where the stacks land follows the gaps.
- **Every inserter kind but the stack inserter drops one item at a time**, at the same ticks as the stack inserter's stacks (`0,1,2,4,6,…`),
  whatever the belt stack size; only the stack inserter puts down a belt stack. The wait to the first drop is the swing the engine
  already has for each kind and quality.
- **The simulator's lane rule** (`LaneTraffic`) reproduces the game's first hand on a straight line with an empty lane (at every belt stack
  size, from every side and direction), on a lane with half of it taken and on a full lane, and nearly so with three quarters taken. It
  differs in some phases of a stream that fills a quarter of the lane (6 of 24 first hands at each belt stack size), on a line that ends at
  the inserter, on every underground end (the simulator has no such drop), and for every kind but the stack inserter at a belt stack of
  more than one.

Publishing remains on hold.
