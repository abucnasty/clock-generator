# Belt pickup experiments

The [same-item fixtures](fixtures/same-item/README.md) isolate moving near-lane/far-lane fallback. The
[different-item fixtures](fixtures/different-items/README.md) compare straight and underground reach and backed-up
availability. Current general findings and calibration limits live in the
[simulator documentation](../../../../docs/simulator.md#picking-up-from-moving-belts-and-underground-endpoints).

From `clock-generator/`:

```bash
npm test -- src/control-logic/inserter/modes/pickup/belt-lane-fallback.test.ts
npm run test:generation -- src/crafting/moving-belt-pickup.generation.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/same-item-pickup-fixture.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/backed-up-pickup.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/pickup-capture.game.test.ts
```

The first two commands run in the simulator. The last three need Factorio and check respectively 12 lane-fallback
cases, six actual ingredient/geometry cases, and Sidecar classification/export behavior. Their independent replay
and simulator comparisons remain in the test code, separate from sampling helpers.

[`helpers/lua/capture.lua`](../../helpers/lua/capture.lua) owns bounded sampling, output and cleanup; [`helpers/lua/belt-pickup.lua`](../../helpers/lua/belt-pickup.lua) observes hands
and exposed stack positions/IDs. Both are shared across scenarios through the host composer. Scenarios retain
entity selection, filtering, circuit changes and destination clearing. A standalone scenario file is not directly
runnable with `--lua`: use `npm run probe -- ...`, which composes it and stores the generated chunk for inspection.

Same-item sampling covers ticks 1–1200; analysis discards its first 60. Backed-up sampling covers ticks 101–1300
while clearing the machine during the earlier ticks too. Observation precedes inventory clearing in both.
Offsets are relative to the first observed grab, not arm arrival or a proof about arbitrary phases.

The [build checks](../../builds/README.md) independently measure throughput and recovery using these fixtures.
