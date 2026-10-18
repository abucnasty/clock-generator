# Inline pickup from an underground entrance

Question: which lane does an empty inserter choose when it stands directly east of an eastbound underground
entrance, and how do mirroring and moving versus backed-up supply affect its first hand?

The user-supplied `scaffold.txt` retains its ingredient drain loader: **the base fixture is moving supply**.
The input inserter is west of the electromagnetic plant, facing west into the entrance. A separate upstream
underground exit feeds that entrance directly. The ingredient belt continues beneath the plant to its drain.
Lane 1 carries accumulators and lane 2 supercapacitors, in four-item stacks. The legendary input has no mirror
flag. The flipped variant uses `flipFrontUndergroundInput(blueprint, "entrance")` to change only this inserter's
`mirror` flag to `true`; its direction, position and both ingredients stay fixed. The probe checks the actual
`mirroring` property against the host's expectation. Fluids, modules, beacons and output disposal are retained.

For the backed-up case, `backUpFrontUndergroundEntrance` removes exactly the ingredient drain loader, preserving
the output drain and every other entity. Its position differs from the older side-pickup scaffolds, so their
plant-center-based drain selector must not be used here. All four cases stage the cell's inserters until the pickup
lanes have stayed full for 600 ticks. This allows back-pressure to travel through the long underground when the
drain is absent. Full lanes alone do not establish that a belt has stopped; the capture checks motion separately.

## Scaffold screenshot

![Eastbound underground entrance with an unmirrored inserter immediately east of it and a moving ingredient drain](scaffold.jpg)

The screenshot shows the original moving layout. The backed-up variant removes only the lower drain loader on
the right. The same-item moving variant keeps this geometry and feeds accumulators from both rows of chests.
This is a layout reference, rather than the probe's initial state or evidence of timing.
See the [screenshot guide](../../../../README.md#scaffold-screenshots) for settings and regeneration.

## Findings

Measured on 2026-10-18 in Factorio 2.1.21, with a legendary stack inserter, hand capacity 16, four-item turbo belt
stacks, and plant crafting speed 109.475. The empty input has filters and circuit enable control disabled. The
probe clears machine inputs/output once, checks zero initial crafting progress, then observes ticks 1–30 using
the shared capture and belt snapshot helpers. It does not insert belt items, modify feeder hands, or refill supply.

| Mirrored | Supply | Selected lane / item | Grab offsets | Hand counts at grabs |
| --- | --- | --- | --- | --- |
| No | Moving, original drain retained | 1 / accumulator | `0,1,2,4` | `4,8,12,16` |
| No | Backed up, ingredient drain removed | 1 / accumulator | `0,1,2,3` | `4,8,12,16` |
| Yes | Moving, original drain retained | 2 / supercapacitor | `0,1,2,4` | `4,8,12,16` |
| Yes | Backed up, ingredient drain removed | 2 / supercapacitor | `0,1,2,3` | `4,8,12,16` |

Both initial exposed half-tile lanes contain two four-item stacks. The first grab is at probe tick 2 in all four
cases. Machine inputs/output remain empty and crafting progress stays zero through each first hand. The recipe's
default simulator order chooses supercapacitors; choosing accumulators instead is evidence for lane preference
over that fixed recipe order. Changing only the input's mirroring switches its choice to lane 2 supercapacitors
under both supply conditions, while leaving each condition's first-hand timing unchanged. In each backed-up case,
the unselected lane's stack IDs and positions stay unchanged throughout the first hand. With the drain retained,
the unselected lane moves even though none of its items are collected.

The existing simulator supports these observations with explicit `near_lane: 1` unmirrored or `near_lane: 2`
mirrored, and `pickup_length: 0.5` in both. `config.json` holds the unmirrored moving case; the flipped test changes
its explicit lane preference. The backed-up test changes `overrides.backed_up_belts` to `true` as well
as removing the loader from the blueprint. Backed-up first-hand counts match directly. Moving counts match one
of the model's two turbo stream phases, including the pause before the fourth grab. The comparison checks phase
compatibility; it does not infer the starting phase from the blueprint or calibrate absolute arm-arrival timing.
No engine behavior change was required for these measured first hands.

Sidecar 0.11.0 captures this preference automatically: `near_lane: 1` unmirrored, `near_lane: 2` mirrored, and
`pickup_length: 0.5`. All four game regressions check the recorder's captured source and Sidecar's exported JSON,
with no pickup warning. Classification requires a centered inserter downstream of the entrance, facing against
the belt's direction. The classifier has rotation checks in all four cardinal directions; actual entrance grabs
were measured only in this eastbound fixture. Wrong-facing, off-center and upstream inline pickups remain unclassified.
Supply motion is still a separate config choice and is not inferred from captured geometry.

Sidecar 0.10.0 reported `inline` and omitted both fields for these same captures. The fixture retains explicit
settings for the independent simulator comparison. Swapped ingredients, other cardinal orientations' actual grabs,
repeated hands and other speeds remain unverified for this geometry. The earlier upstream-side
prototype is a different approach and is not this fixture.

## Same item on both moving lanes

The next isolated case uses the unmirrored moving scaffold with accumulators on both lanes. The host helper
`useAccumulatorsOnBothLanes` changes only the two supercapacitor feeder filters to accumulators; all four feeders,
both drain loaders, inserter mirroring and geometry stay unchanged. `same-item-moving.json` changes the input config
to match. The existing `probe.lua` and staging procedure are reused, with no new Lua probe or duplicated blueprint.

Measured in Factorio 2.1.21 on 2026-10-18 under the same conditions as above:

| Grab offset | Hand count | Selected lane |
| --- | --- | --- |
| 0 | 4 accumulators | 1 |
| 1 | 8 accumulators | 1 |
| 2 | 12 accumulators | 1 |
| 3 | 16 accumulators | 2 |

The hand starts empty and both exposed lanes start with two four-item stacks. Machine inventories remain empty
and crafting progress stays zero through the first full hand. The hand's position switches from north of the
belt center to south for the fourth grab. At that point lane 1 is empty and lane 2 loses its upstream stack ID,
confirming fallback rather than merely observing a faster hand. The different-item moving control filled at
`0,1,2,4`; the same-item far lane supplies the otherwise missing grab at offset 3.

The existing independent position replay, seeded once with the observed first grab, phases and remaining stacks,
predicts all subsequent grabs and both lane snapshots without resynchronizing. It records one far-lane grab and
no differences; restricting it to lane 1 misses this hand. The actual simulator also fills in four consecutive
grabs under either turbo phase, and one phase matches the measured lane sequence `1,1,1,2`. As above, this does
not claim that the initial phase can be inferred from the blueprint. No engine behavior change is needed.
Sidecar captures lane 1 preference and half-tile reach and exports both without warnings.

This result covers one unmirrored, moving first hand. Mirrored same-item pickup, backed-up same-item supply,
repeated hands and other orientations remain separate cases. The raw capture is retained locally under
`work/belt-pickup/front-entrance-same-item-moving-01/`.

## Reproduce

From `clock-generator/`, with the [game setup](../../../../README.md#setup):

```bash
# Both mirroring states and supply conditions; no other mechanic cases.
npm run test:game -- tests/game/mechanics/belt-pickup/front-underground-entrance.game.test.ts
# Only the unmirrored same-item moving fallback case.
npm run test:game -- tests/game/mechanics/belt-pickup/front-underground-entrance-fallback.game.test.ts
npm test -- src/control-logic/inserter/modes/pickup/belt-lane-fallback.test.ts -t 'front underground entrance'
npm run screenshots -- --case=front-underground-entrance
```

Use `-t 'moving supply'` or `-t 'backed-up supply'` to narrow the game command; `-t 'mirrored=true'` runs only the
two flipped cases. The game test composes `probe.lua`, captures hand/lane observations, compares the existing
simulator and checks Sidecar capture/export without warnings. Temporary test captures are removed afterward.
Raw captures with matching configs and the committed probe are retained
locally under `work/belt-pickup/front-entrance-user-07/` (moving) and `front-entrance-user-08/` (backed up).
Flipped captures are under `work/belt-pickup/front-entrance-mirrored-moving-01/` and
`front-entrance-mirrored-backed-up-01/`. The flipped blueprint was checked to differ from the supplied scaffold
only in the input inserter's mirror flag before the optional drain removal.
These exploratory captures used Sidecar 0.10.0; the game regressions rerun all four cases with 0.11.0 to check capture/export.
The same-item capture and regression use Sidecar 0.11.0.
