# Belt pickup experiments

The [same-item fixtures](fixtures/same-item/README.md) isolate moving near-lane/far-lane fallback. The
[different-item fixtures](fixtures/different-items/README.md) compare straight and underground reach and backed-up
availability. Current general findings and calibration limits live in the
[simulator documentation](../../../../docs/simulator.md#picking-up-from-moving-belts-and-underground-endpoints).

The [front underground exit fixture](fixtures/front-underground-exit/README.md) isolates a northbound, head-on
pickup with backed-up supply. Two ingredient arrangements distinguish lane preference from fixed recipe order;
flipping the inserter with the swapped ingredients changes selection from lane 2 to lane 1. Each first hand is
compared with an explicit simulator lane preference. Sidecar 0.10.0 exports that preference and half-tile geometry
for both mirroring states. Other cardinal orientations and moving front-exit supply have not had their actual grabs measured.

The [front underground entrance fixture](fixtures/front-underground-entrance/README.md) measures an unmirrored
inserter east of an eastbound entrance. It selects lane 1 accumulators with either moving or backed-up supply;
flipping only its mirroring switches selection to lane 2 supercapacitors in both conditions.
The first hand fills at `0,1,2,4` with the ingredient drain retained and `0,1,2,3` when that loader is removed.
The existing model supports these timings with explicit lane preference and half-tile reach; the moving comparison
allows both stream phases. Mirroring preserves each supply condition's measured timing. Sidecar 0.11.0 exports
the mirroring-selected preference and half-tile reach for this entrance, verified in all four game cases.
Its [same-item moving variant](fixtures/front-underground-entrance/README.md#same-item-on-both-moving-lanes) checks
the unmirrored first hand: lane 1 supplies three grabs, then lane 2 supplies the fourth at offset 3. Both lane
snapshots and the actual simulator support the existing fallback rule; no engine change was needed.

From `clock-generator/`:

```bash
npm test -- src/control-logic/inserter/modes/pickup/belt-lane-fallback.test.ts
npm run test:generation -- src/crafting/moving-belt-pickup.generation.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/same-item-pickup-fixture.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/backed-up-pickup.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/pickup-capture.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/front-underground-exit.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/front-underground-entrance.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/front-underground-entrance-fallback.game.test.ts
```

The first two commands run in the simulator. The remaining commands need Factorio and check respectively 12 lane-fallback
cases, six actual ingredient/geometry cases, Sidecar classification/export behavior, three front exit
ingredient/mirroring cases with capture assertions, four front entrance supply/mirroring cases, and one same-item
front entrance fallback case. Their independent replay and simulator comparisons remain
in the test code, separate from sampling helpers.

[`helpers/lua/capture.lua`](../../helpers/lua/capture.lua) owns bounded sampling, output and cleanup; [`helpers/lua/belt-pickup.lua`](../../helpers/lua/belt-pickup.lua) observes hands
and exposed stack positions/IDs. Both are shared across scenarios through the host composer. Scenarios retain
entity selection, filtering, circuit changes and destination clearing. A standalone scenario file is not directly
runnable with `--lua`: use `npm run probe -- ...`, which composes it and stores the generated chunk for inspection.

Same-item sampling covers ticks 1–1200; analysis discards its first 60. Backed-up sampling covers ticks 101–1300
while clearing the machine during the earlier ticks too. Observation precedes inventory clearing in both.
Offsets are relative to the first observed grab, not arm arrival or a proof about arbitrary phases.

The [build checks](../../builds/README.md) independently measure throughput and recovery using these fixtures.
