# Moving input pickup: different items on the two lanes

These scaffolds compare a straight belt, underground entrance and underground exit, with accumulators on lane 1
and supercapacitors on lane 2. The input inserter's nearest lane is 1. The belt drains continuously at its far end.
`config.json` uses a half-tile pickup, conservatively covering all three geometries; Sidecar captures the straight
piece's actual one-tile reach. A hand collects one ingredient at a time, so the other lane cannot fill its gaps.

The earlier always-full pickup assumption selected a 1,056-tick clock targeting 528 packs. In Factorio 2.1.21 it
missed that target in 30 of 35 periods on each underground endpoint, producing 480–528. The reachable-stack model
detects the shortfall and selects two output swings per cycle: 352 packs per 704 ticks, or 30 packs/second.
The initial verification held that rate in all 52 recorded periods on each geometry.

The current game regressions record at least 60 complete periods per run and check the selected default clock
on all three scaffolds, with moving supply and with the ingredient drain removed to back up the input belt.
Recovery runs withhold each ingredient in turn and block/restore output disposal, without resetting the clock or
machine. Moving checks allow six recovery periods. Backed-up checks settle for ten periods before measurement and
allow ten periods to recover; every later complete period must meet the target.

```bash
# From clock-generator/, with Factorio and the staging save configured in .env:
npm run test:game -- src/harness/moving-pickup.game.test.ts
```

## Backed-up pickup regression

`backed-up-pickup.game.test.ts` removes the ingredient drain before placement and probes accumulators and
supercapacitors separately on each geometry. `backed-up-probe.lua` clears the machine's input and output each tick
so the hand can fill without destination blocking. It records 1,200 ticks of hand counts and exposed lane stacks.
Filtering is explicitly enabled, other filter slots are cleared, and the held item must match the requested
ingredient. The untouched lane must stay stationary, the captured reach must match the geometry, and every complete
hand must match the simulator's `0,1,2,3` grab offsets. These offsets describe filling after the first grab, not arm arrival.

The original local probes left filtering disabled, so their "supercapacitor" labels did not establish far-lane
behavior. The regression above verifies both actual ingredients.

The clock tests in `moving-pickup.game.test.ts` also use explicitly backed-up configs with their pickup geometry
retained. All three geometries must hold the target output and recover after the same ingredient/output cuts as
the moving cases, without resetting the clock or machine.

```bash
npm run test:game -- src/harness/backed-up-pickup.game.test.ts src/harness/moving-pickup.game.test.ts
```

The [same-item iron-gear fixtures](../../../intermediates/iron-gear-wheel/belted-moving-same-item) test fallback
between two lanes carrying the same item. See the [general pickup rules](../../../../../docs/simulator.md#picking-up-from-moving-belts-and-underground-endpoints).
Original raw probes and clock recordings remain local under `work/belt-pickup-investigation/`.
