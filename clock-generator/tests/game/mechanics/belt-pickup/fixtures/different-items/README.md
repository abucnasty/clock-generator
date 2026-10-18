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
npm run test:game -- tests/game/builds/moving-pickup.game.test.ts
```

## Backed-up pickup regression

`backed-up-pickup.game.test.ts` removes the ingredient drain before placement and probes accumulators and
supercapacitors separately on each geometry. The scenario `backed-up-probe.lua`, composed with shared capture
helpers, clears the machine's input and output each tick
so the hand can fill without destination blocking. It records 1,200 ticks of hand counts and exposed lane stacks.
Filtering is explicitly enabled, other filter slots are cleared, and the held item must match the requested
ingredient. The untouched lane must stay stationary, the captured reach must match the geometry, and every complete
hand must match the simulator's `0,1,2,3` grab offsets. These offsets describe filling after the first grab, not arm arrival.

To retain one raw capture, from `clock-generator/` with `.env` configured:

```bash
npm run probe -- --fixture=backed-up --item=supercapacitor --geometry=underground-entrance --out=../work/belt-pickup/backed-up-run-01
```

Use `--item=accumulator` for the other ingredient and choose any of the three geometry names. The runner removes
the ingredient drain, selects the item, sets the matching config and composes the Lua helpers. It retains
`blueprint.txt`, `config.json`, `probe.generated.lua`, `recording.json`, and
`game/script-output/backed-up-pickups.json`. The scenario source alone is not directly runnable via `--lua`.
Sampling covers ticks 101–1300 after probe installation; destination clearing starts during the earlier ticks.
See the [game verification guide](../../../../README.md) for setup, cleanup and retention rules.

The original local probes left filtering disabled, so their "supercapacitor" labels did not establish far-lane
behavior. The regression above verifies both actual ingredients.

The clock tests in `moving-pickup.game.test.ts` also use explicitly backed-up configs with their pickup geometry
retained. All three geometries must hold the target output and recover after the same ingredient/output cuts as
the moving cases, without resetting the clock or machine.

```bash
npm run test:game -- tests/game/mechanics/belt-pickup/backed-up-pickup.game.test.ts tests/game/builds/moving-pickup.game.test.ts
```

## Mixed-item demand priority and insertion-limit fallback

Measured manually on 2026-10-18 in Factorio 2.1.21, using this straight-belt scaffold with the ingredient drain
removed. The eastward belt was backed up with four-item stacks on both lanes. The legendary stack inserter stood
north of the belt, nearest lane 1, with a hand capacity of 16.

A staged start saturated both lanes before placing a fresh, empty input inserter. Filters and circuit enable
control were disabled. The active plant started with 13 or 14 of the near-lane ingredient, none of the far-lane
ingredient, no products, and zero crafting progress. Inputs were set once, not cleared every tick: that difference
in stock was the condition being tested. The simulator's insertion limit is 14 for each ingredient at this plant's crafting speed
of 109.475. The second case swapped the ingredient feeders and config lanes while preserving the geometry and setup.
The third case retained those swapped lanes and changed only the initial near-lane stock from 13 to 14.

| Near lane / machine stock | Far lane / machine stock | First game grab | First simulator grab |
| --- | --- | --- | --- |
| Accumulator / 13 | Supercapacitor / 0 | 4 accumulators | 4 accumulators |
| Supercapacitor / 13 | Accumulator / 0 | 4 supercapacitors | 4 supercapacitors |
| Supercapacitor / 14 | Accumulator / 0 | 4 accumulators | 4 accumulators |

In all three cases, the first game sample still had an empty hand and both exposed lanes full. The first grab was
observed two ticks after probe installation, with machine stocks unchanged from their initial values. Only item
choice and grab quantity were compared, not arm-arrival timing.

For both ingredient arrangements, the completely missing far-lane ingredient did not override the near-lane
preference. Swapping the lanes changed the selected ingredient, consistent with lane preference rather than a fixed
preference for accumulators. At 14 supercapacitors, the inserter instead collected the missing far-lane ingredient.
Together, the swapped 13/0 and 14/0 cases support the modeled insertion threshold of 14 for supercapacitors in this
setup: prefer the near lane while its ingredient is accepted, then fall back to an accepted far-lane ingredient.
The existing simulator agrees with all three observations, so no simulator change was needed. These cases do not
establish insertion thresholds for other setups or behavior with moving supply, filters, or front-facing pickups.

The retained scenarios, runners, recordings, detailed samples and simulator comparisons are local under
`work/belt-pickup/mixed-demand-02/`, `work/belt-pickup/mixed-demand-swapped-01/`, and
`work/belt-pickup/mixed-demand-limit-01/` at the repository root. These observations are not part of the automated
game regression suite. Reproduction requires the staged setup and initial
inventories above; the backed-up capture command earlier in this file clears inputs and therefore does not reproduce
this demand experiment.

The [same-item iron-gear fixtures](../same-item) test fallback
between two lanes carrying the same item. See the [general pickup rules](../../../../../../docs/simulator.md#picking-up-from-moving-belts-and-underground-endpoints).
Original raw probes and clock recordings remain local under `work/belt-pickup-investigation/`.

## Scaffold screenshots

Native Factorio views of the committed base blueprints, with entity info shown. These illustrate the layouts;
they are not probe samples or evidence of pickup timing. The ingredient drain is present in these base views.

Straight belt:

![Straight-belt scaffold](straight-belt-scaffold.jpg)

Underground entrance:

![Underground-entrance scaffold](underground-entrance-scaffold.jpg)

Underground exit:

![Underground-exit scaffold](underground-exit-scaffold.jpg)

See the [screenshot guide](../../../../README.md#scaffold-screenshots) for capture settings and regeneration.
