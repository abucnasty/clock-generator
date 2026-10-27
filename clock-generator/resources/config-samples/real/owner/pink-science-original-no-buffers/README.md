# Original electromagnetic science scaffold without buffer chests

The blueprint of [#100](https://github.com/abucnasty/clock-generator/issues/100) (see `../pink-science-original/`) with
its output buffers taken out: each steel buffer chest is replaced in place by an infinity chest set to remove all, and the
inserters that took the science packs out of the buffers, with the infinity chests they dropped into, are removed. 211
entities become 203. Every source, belt, machine and the rest of the build stay as they are, and so does the target: 96
science packs a second for the full blueprint, 240/s across 2.5 copies of it.

`pink-science-original-no-buffers-scaffold.txt` is that blueprint. `pink-science-original-no-buffers.json` is the config
of the original sample with the same change: the two final takers and the two buffer chests are gone, and each science
plant's drain drops straight into an infinity chest that removes everything, where its buffer stood.

## What it shows

The science plants' drains are now the build's terminal outputs, and each drops into a sink that never fills. Where
every terminal output does, the clock generator judges the recovery after a loss by the rate over the cycle: each science
plant has to carry its share, 16 packs a period, in whole hands, not exactly 16 in every period. Here a science plant makes a
little more than its share (16.07 packs a period: its inputs move whole hands), and the drain hands that surplus on when
a hand of it is ready, a hand ahead in one period and back to 16 in the next. With the buffer chests the same surplus
went into the buffers, and the final takers took exactly 16 a period out of them; to the drain, a buffer chest with room
and an infinity chest that removes everything are the same.

Generate picks a 40-tick Small batches clock in which each science plant's drain has room for one swing more than its
hand, 1,054.1 wake-ups a minute, no inserter left always on, and every loss the check tries is survived.

`src/crafting/recycler-original-no-buffers.generation.test.ts` checks that clock in the simulator.
