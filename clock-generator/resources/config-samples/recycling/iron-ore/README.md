# Iron ore voided by a recycler

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `iron-ore-voider-400-exact-speed` | abucnasty | ore voider benchmark save F, cut by extract-cell on 2026-10-24 | none recorded | Scaffold: yes (cut 2026-10-24 from the ore voider benchmark's saves F and B by extract-cell). A recycler voids iron ore, 400 a second destroyed (`counts: "destroyed"`): four inserters bring it in from infinity chests, the recycler places what it gives back (a quarter of its crafts, at random) into a car, two inserters bring that back; at exact speed (16.875, 540 crafts a second) and overbeaconed (26.634, 852.3). The selected clock of both (even hands, 144 ticks) brought 960 ore in every period of an hour in the game, destroyed 400.009 and 399.997 a second against 400 ± 0.5, its car never full (at most 74 and 66 of 4,000), and was back at 960 the first period after the ore was cut and once a backlog of 2,000 ore in the car had drained (46 and 43 periods). What comes back is random in the game, so the test judges the hour's mean against the binomial's range, not each period. Note: in `test:game` (`iron-ore-voider-400-clock.game.test.ts`). |
| `iron-ore-voider-400-overbeaconed` | abucnasty | ore voider benchmark save B | none recorded | as the exact-speed build above |

One cell of the ore voider benchmark (saves by abucnasty) (factorio-benchmarks, `benchmarks/2025-10-14-recycler-clocking`): a design that puts
out 240 uncommon iron ore a second a copy, and destroys the normal ore it mines with two recyclers. The cell is one of
the two: a legendary recycler on iron ore. Four legendary stack inserters bring the ore in from four infinity chests, which
stand where the design's cargo wagon was. The recycler places what it gives back (a quarter of its crafts, at random)
into a car at its result spot, and two legendary stack inserters bring that back into it. Hands of 16.

- `iron-ore-voider-400-exact-speed.json`, `iron-ore-voider-400-exact-speed.scaffold`: save F, the exact-speed recycler: 1 legendary speed module 3 and 4
  beacons of mixed legendary speed modules, crafting speed 16.875, 540 crafts a second at most.
- `iron-ore-voider-400-overbeaconed.json`, `iron-ore-voider-400-overbeaconed.scaffold`: save B, the recycler with 4 legendary speed modules 3 and 6 beacons of
  2 each, crafting speed 26.634375, 852.3 crafts a second at most. Saves C, D and G of the benchmark give the same cell.

The scaffolds were cut from the saves (migrated to vanilla 2.1.21) by factorio-benchmark-tools' `extract-cell` at
c9071e1: the cell's entities as built, the wagon replaced by the four infinity chests. The enable conditions left on some
inserters and on the recycler have no wire and do nothing. The car is the recycler's `result_target`.

**Target: 400 iron ore a second destroyed** (`counts: "destroyed"`): what the four inserters bring in from outside.
Three inserters take the uncommon ore out of the design's wagon at 80 a second each, so its drill runs 66% of the time and
mines 3200/3 ore a second, three quarters of it normal: 800 a second a copy for its two recyclers, 400 each. Measured in
the five saves over 60 s: 798.5 to 803.8 normal ore destroyed a second a copy. Crafts are 400 / (1 - 1/4) = 533.3 a
second, and 133.3 ore a second come back. The exact-speed recycler uses 98.8% of its crafts, the overbeaconed one 62.6%.
