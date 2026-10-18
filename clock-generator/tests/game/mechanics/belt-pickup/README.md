# Belt pickup experiments

The [same-item fixtures](fixtures/same-item/README.md) isolate moving near-lane/far-lane fallback. The
[different-item fixtures](fixtures/different-items/README.md) compare straight and underground reach and backed-up
availability. Current general findings and calibration limits live in the
[simulator documentation](../../../../docs/simulator.md#picking-up-from-moving-belts-and-underground-endpoints).

The [side-loaded straight-tile experiment](fixtures/side-loaded-straight/README.md) separates physical reach
from single-stream entry. Inner and outer side feeds traverse different parts of the receiving lane. The
simulator models these profiles; Sidecar 0.12.0 captures local receiving lanes and warns about merges or
ambiguous inputs. A 24-case matrix checks speeds, directions, two turbo start phases and backed-up controls;
production comparisons align phase from pre-pickup observations. Multi-stream merge timing remains unsupported.

The [front underground exit fixture](fixtures/front-underground-exit/README.md) isolates a northbound, head-on
pickup with backed-up supply. Two ingredient arrangements distinguish lane preference from fixed recipe order;
flipping the inserter with the swapped ingredients changes selection from lane 2 to lane 1. Each first hand is
compared with an explicit simulator lane preference. Sidecar 0.10.0 exports that preference and half-tile geometry
for both mirroring states. Other cardinal orientations and moving front-exit supply have not had their actual grabs measured.
The same-item backed-up exit controls also keep all four grabs on the preferred lane, filling at `0,1,2,3` in
both mirroring states. The front inserter blocks straight-through continuation, so this layout cannot be
treated as freely moving supply merely by changing a config override.

The [front underground entrance fixture](fixtures/front-underground-entrance/README.md) measures an unmirrored
inserter east of an eastbound entrance. It selects lane 1 accumulators with either moving or backed-up supply;
flipping only its mirroring switches selection to lane 2 supercapacitors in both conditions.
The first hand fills at `0,1,2,4` with the ingredient drain retained and `0,1,2,3` when that loader is removed.
The existing model supports these timings with explicit lane preference and half-tile reach; the moving comparison
allows both stream phases. Mirroring preserves each supply condition's measured timing. Sidecar 0.11.0 exports
the mirroring-selected preference and half-tile reach for this entrance, verified in all four game cases.
Its [same-item moving variant](fixtures/front-underground-entrance/README.md#same-item-on-both-moving-lanes) checks
both mirroring states: the preferred lane supplies three grabs, then the other lane supplies the fourth at
offset 3. The measured lane sequences are `1,1,1,2` unmirrored and `2,2,2,1` mirrored. Both lane snapshots and
the actual simulator support the existing fallback rule; no engine change was needed.
The [same-item backed-up controls](fixtures/front-underground-entrance/README.md#same-item-on-backed-up-lanes)
remove only the ingredient drain loader. Both hands still fill at `0,1,2,3`, but all four grabs stay on the
preferred lane: `1,1,1,1` unmirrored or `2,2,2,2` mirrored. The unselected lane remains stationary and untouched.

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
npm run test:game -- tests/game/mechanics/belt-pickup/side-loaded-straight.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/side-loaded-entry.game.test.ts
```

The first two commands run in the simulator. The remaining commands need Factorio and check respectively 12 lane-fallback
cases, six actual ingredient/geometry cases, Sidecar classification/export behavior, five front exit
ingredient/mirroring cases with capture assertions, four front entrance supply/mirroring cases, and four same-item
front entrance moving/backed-up controls, the side-loaded tile/control pair, and the 24-case side-entry matrix. Their independent replay and simulator comparisons remain
in the test code, separate from sampling helpers.

[`helpers/lua/capture.lua`](../../helpers/lua/capture.lua) owns bounded sampling, output and cleanup; [`helpers/lua/belt-pickup.lua`](../../helpers/lua/belt-pickup.lua) observes hands
and exposed stack positions/IDs. Both are shared across scenarios through the host composer. Scenarios retain
entity selection, filtering, circuit changes and destination clearing. A standalone scenario file is not directly
runnable with `--lua`: use `npm run probe -- ...`, which composes it and stores the generated chunk for inspection.

Same-item sampling covers ticks 1–1200; analysis discards its first 60. Backed-up sampling covers ticks 101–1300
while clearing the machine during the earlier ticks too. Observation precedes inventory clearing in both.
Offsets are relative to the first observed grab, not arm arrival or a proof about arbitrary phases.

The [build checks](../../builds/README.md) independently measure throughput and recovery using these fixtures.
