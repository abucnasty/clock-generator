# Moving input pickup: different items on the two lanes

These scaffolds compare a straight belt, underground entrance and underground exit, with accumulators on lane 1
and supercapacitors on lane 2. The input inserter's nearest lane is 1. The belt drains continuously at its far end.
`config.json` uses a half-tile pickup, conservatively covering all three geometries; Sidecar captures the straight
piece's actual one-tile reach. A hand collects one ingredient at a time, so the other lane cannot fill its gaps.

The earlier always-full pickup assumption selected a 1,056-tick clock targeting 528 packs. In Factorio 2.1.21 it
missed that target in 30 of 35 periods on each underground endpoint, producing 480–528. The reachable-stack model
detects the shortfall and selects two output swings per cycle: 352 packs per 704 ticks, or 30 packs/second.
The initial verification held that rate in all 52 recorded periods on each geometry.

The current game regressions record 36,000 ticks per run and check the selected default clock on all three
scaffolds. Recovery runs withhold each ingredient in turn and block/restore output disposal, without resetting the
clock or machine. They require exact output again after a six-period recovery allowance.

```bash
# From clock-generator/, with Factorio and the staging save configured in .env:
npm run test:game -- src/harness/moving-pickup.game.test.ts
```

The [same-item iron-gear fixtures](../../../intermediates/iron-gear-wheel/belted-moving-same-item) test fallback
between two lanes carrying the same item. See the [general pickup rules](../../../../../docs/simulator.md#picking-up-from-moving-belts-and-underground-endpoints).
Original raw probes and clock recordings remain local under `work/belt-pickup-investigation/`.
