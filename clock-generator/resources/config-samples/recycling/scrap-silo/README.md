# Scrap recycled into a rocket silo

A recycler on scrap whose twelve results, each from 1% to 20% of a roll, go into a rocket silo, and one filter
inserter for each result takes it out. No save holds such a cell: it was built by script on an empty map of the
harness (Factorio 2.1.21) for the clocking of results that come by small chances, and kept as built.

- `scrap-silo.json`, `scrap-silo-scaffold.txt` (28 entities): one normal recycler (no modules, no beacons) on scrap,
  facing north, and a rocket silo north of it, touching it, so that the recycler's result spot lies inside the silo:
  the recycler puts every result into the silo itself (the silo is the machine's `result_target`). The silo's rocket
  part recipe is of uncommon quality, so that every result goes into its rocket inventory, which lifts 1,000,000 of
  weight; at normal quality the recycler puts processing units and low density structure into the silo's input slots,
  where no inserter takes them out, and stops for good (the config of that is refused). No rocket part is made.
- Twelve normal stack inserters (hand 16), four on each of the silo's west, north and east sides, each with one result
  as its filter, take it out into an infinity chest that removes everything. A normal stack inserter brings the scrap
  from an infinity chest south of the recycler.
- Scrap recycling productivity is researched to level 30: +300%, the recipe's cap. A scrap then gives four rolls of
  the twelve results.

**Target: 2 scrap a second destroyed** (`counts: "destroyed"`): two electric mining drills on scrap without mining
productivity mine 1 scrap a second each, and that is what such a recycler is there for. It is 80% of the recycler's
2.5 scrap a second, so the supply is the limit, and the feed brings one hand of 16 every 480 ticks. The silo's lift
sets the clock's period (every number of the windows scales with the rate), not the recycler.
