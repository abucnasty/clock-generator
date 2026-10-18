# Belt pickup experiments

The [same-item fixtures](fixtures/same-item/README.md) isolate moving near-lane/far-lane fallback. The
[different-item fixtures](fixtures/different-items/README.md) compare straight and underground reach and backed-up
availability. Current general findings and calibration limits live in the
[simulator documentation](../../../../docs/simulator.md#picking-up-from-moving-belts-and-underground-endpoints).

The [side-loaded straight-tile experiment](fixtures/side-loaded-straight/README.md) separates physical reach
from single-stream entry. Inner and outer side feeds traverse different parts of the receiving lane. The
simulator models these profiles; Sidecar 0.11.0 captures local receiving lanes and supported turbo merges,
and warns about other merges or ambiguous inputs. The original 24-case matrix checks speeds, directions, two turbo start phases and backed-up controls;
production comparisons align phase from pre-pickup observations. Other merge layouts remain unsupported. A subsequent
[repeated two-stream turbo case](fixtures/side-loaded-straight/README.md#repeated-two-stream-turbo-test) captures
45 hands and validates a candidate shared-stock replay against all observed queues, stack IDs and positions.
It includes temporary compression and follower slowdown. The same setup at
[express speed](fixtures/side-loaded-straight/README.md#repeated-two-stream-express-test) falsifies the candidate's
entry acceptance rule at tick 19, despite matching every hand count. Express merge support remains deferred.

The [release-17 turbo follow-up](fixtures/side-loaded-straight/README.md#repeated-turbo-test-with-release-at-tick-17)
also rejects the original entry-shift cap. A revised experimental turbo replay matches both starting phases,
pause/resume, outlet blocking/release, a north/south reflection, and different items with their streams swapped.
Each comparison checks all 511 observed transitions. These controls require shared finite stock and
backpressure in addition to held-item selection. A separate
[seeded cutoff calibration](fixtures/side-loaded-straight/README.md#turbo-entry-window-cutoff-calibration)
accepts all integer shifts 89–95 and rejects 96, including outer-absent controls at the boundary. It also
confirms that compressed followers wait instead of moving upstream. The engine now implements the measured
turbo two-stream case using shared finite stock and incoming queues, and Sidecar captures its two ingredients
and downstream geometry. Production comparisons verify all seven repeated-hand controls and all ten cutoff
cases. A generated gear clock holds all 60 recorded periods; a separate freely running mixed-ingredient build
confirms starvation of its inner ingredient and the simulator reports that stalled preparation state.
Other geometries, stack sizes, speeds and sub-unit boundaries remain unverified. Further investigation focuses
on turbo belts.

The [direct turbo splitter baseline](fixtures/splitter/README.md) uses the supplied right-priority output,
with a draining north output and a locally blocked south pickup port. It records all eight transport lines.
The first iron hand fills at `0,1,2,3`; the next four hands fill at `0,1,2,4`. Swapping only the ingredients
selects cable from the same physical line 7, with unchanged first-hand timing and later `0,1,2,4` pauses.
Mirroring with those swapped ingredients retained switches selection to iron on line 8, with the same timing
and an ID trace through the other input line. These three controls establish a mirroring-dependent preference
for this port: line 7 unmirrored, line 8 mirrored. First-hand agreement with the ordinary belt model does not
classify splitter routing. Sidecar's unsupported warning remains. Further mechanics work continues on stacked branches without new
PRs or publishing until requested.

The [two-serial-splitter series](fixtures/splitter-two-inserters/README.md) separately measures original,
ingredient-swapped, upstream-mirrored and downstream-unmirrored pickups, plus independent priority controls. With right priority,
both original first hands grab at 2,3,4,5; with both output priorities unset they grab at 2,3,4,7. The original
mirroring and gate timing stay fixed in that comparison. Later partial hands depend on upstream stock and shared
machine eligibility, so the findings do not assign a constant splitter delay. Unsetting only upstream priority
delays only its first hand; unsetting only downstream priority delays only that hand. Native IDs show the next
matching stack diverted to the north through output at tick 5 while the south pickup is empty. Flipping each target independently
confirms line 7 unmirrored versus line 8 mirrored for both approaches in this layout. Removing only the final
drain with both priorities unset restores first hands at 2,3,4,5. Later withdrawals reopen the through route:
the upstream second cable hand grabs at 13,14,15,18, with a native ID diverted north while its south pickup
is empty and machine inputs remain eligible. A closed final outlet therefore does not imply permanently
backed-up local supply. Both pickups remain unsupported.

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
npm run test:game -- tests/game/mechanics/belt-pickup/splitter.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/splitter-routing.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/splitter-two-inserters.game.test.ts
```

The first two commands run in the simulator. The remaining commands need Factorio and check respectively 12 lane-fallback
cases, six actual ingredient/geometry cases, Sidecar classification/export behavior, five front exit
ingredient/mirroring cases with capture assertions, four front entrance supply/mirroring cases, and four same-item
front entrance moving/backed-up controls, the side-loaded tile/control pair, the expanded 42-case side-entry matrix,
six baseline plus six additional routing controls, and eight independent two-splitter controls. Their independent replay and simulator comparisons remain
in the test code, separate from sampling helpers.

[`helpers/lua/capture.lua`](../../helpers/lua/capture.lua) owns bounded sampling, output and cleanup; [`helpers/lua/belt-pickup.lua`](../../helpers/lua/belt-pickup.lua) observes hands
and exposed stack positions/IDs. Both are shared across scenarios through the host composer. Scenarios retain
entity selection, filtering, circuit changes and destination clearing. A standalone scenario file is not directly
runnable with `--lua`: use `npm run probe -- ...`, which composes it and stores the generated chunk for inspection.

Same-item sampling covers ticks 1–1200; analysis discards its first 60. Backed-up sampling covers ticks 101–1300
while clearing the machine during the earlier ticks too. Observation precedes inventory clearing in both.
Offsets are relative to the first observed grab, not arm arrival or a proof about arbitrary phases.

The [build checks](../../builds/README.md) independently measure throughput and recovery using these fixtures.

## Queued at the end of the series

The scheduled splitter controls are complete: ingredient swaps, mirroring, both output ports, alternate input,
opposite/unset priorities, ingredient filters and blocked-drain supply. See the
[additional routing findings](fixtures/splitter/routing-controls.md). They establish local selection and
availability rules but do not calibrate complete splitter arbitration. Splitter support remains warning-only;
implementing a finite routing model is a separate scope decision. The serial two-consumer tests show why
removing the final drain cannot stand in for permanent local saturation.

After the current pickup/merge investigations, verify the tick-by-tick predictions of
[`Belt::amountToDropAtTick`](../../../../src/entities/belt/belt.test.ts) against actual drops with belt stack sizes
1, 2, 3 and 4. Vary the effective belt stack-size limit without changing researched technologies. Keep turbo
belt speed, inserter type/quality, hand capacity, geometry and starting lane occupancy fixed so stack size is
the controlled variable. Record actual hand decrements and deposited stack counts/positions, then compare
each tick with the function's prediction. Evaluate each stack size separately before changing the simulator;
other belt speeds remain deferred. This is queued work, not a completed game verification.
