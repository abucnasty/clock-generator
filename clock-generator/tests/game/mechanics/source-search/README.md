# Destination refusal and source search

Six controlled Factorio 2.1.21 cells cross three destination states with 48 gears in one stack or 48 singleton
slots of a steel chest. Each legendary stack inserter has a 16-item override and feeds an AM3 engine assembler.
Missing steel/pipe prevents crafting. The [exact captured scaffold](fixtures/scaffold.txt) is separate from
ConfigPaths; `GameFixturePaths.SOURCE_SEARCH` catalogs the fixture. No hand contents are injected.

![Native six-cell source-search scaffold](fixtures/scaffold.jpg)

The native JPEG shows the warmed base layout. Probe-created isolated green wires, destination stock and source
interventions are absent from this image. Its exact blueprint hash/version/recipe is in
[generated screenshot provenance](../screenshots.generated.json).

The [probe](fixtures/probe.lua) clears inventories, sets flat false conditions with readback, observes disabled empty
hands, inserts source stock after observation 2, and enables after observation 3. Native Update 4 is visible in row 5.
The source loop is positively mapped to its own inventory and each stack-based CanInsertData pointer is checked.
Do not substitute inventory capacity for the live loop span, or RSI/RDX for the stack-based argument.

| Destination at Update 4 | Broad fullness | Slot visits one / many | Item checks one / many | Visible held |
| --- | --- | --- | --- | --- |
| Output 50, gears 0 | true | 0 / 0 | 0 / 0 | 0 / 0 |
| Output 0, gears 128 | false | 1 / 48 | 1 false / 1 false | 0 / 0 |
| Output 0, gears 0 | false | 1 / 16 | 1 true / 16 true | 16 / 16 |

The refused same-item many-stack search visits 48 slots but checks the rejected item once. Accepted singleton
slots each require an item check. At Update 12 the formerly accepting sinks have 16 gears and refuse more:
remaining one-stack32 versus 32 singletons gives 1 versus 32 visits and one false check each. The ordinary simulator
regression derives pickup quantities/source depletion from supplied inventories; it does not claim to implement
these native invocation counts or the same-item rejection optimization.

`observations.json` retains selected owned events/counts, initial inventories, interventions, role/native-unit
mapping, raw hashes and limits. Its source captures02/03 repeat exactly and each matches the full 24-row normal
reference. Six positive source-span mappings match occupied slot indices/quantities. **106 fullness calls from Lua
status reads per capture are explicitly excluded**; only verified Update-owned calls are hand work. Status
`waiting_for_source_items` in the ingredient-refused cells does not prove empty supply.

Plain same-item normal gears, contiguous occupied slots and the ordinary source branch were measured. Empty
holes, mixed/spoiling items, alternative inventories and other search branches remain unverified. This is Mechanics,
not throughput/recovery, Selection, a performance coefficient or a general cache policy.

From `clock-generator/`:

```bash
npm test -- src/simulation/components/container-hand-pickup.native.test.ts
npm run test:game -- tests/game/mechanics/source-search/source-search.game.test.ts
python3 scripts/mechanics/project-native-observations.py /path/to/release-investigations
```

The ordinary game check repeats visible physical outcomes without GDB. Native call evidence is stored, never
reacquired by ordinary CI. The exporter verifies frozen source and raw hashes and reproduces compact JSON,
scaffold and probe. The probe changes only the original debugger pause to opt-in `pause_at_gate`; ordering and
capture window remain unchanged. SHA256SUMS seals intentional inputs/projections; full recordings/generated
probes belong in ignored `.scratch`. Rejected early-stock and unsupported-loop-span pilots remain in the source
research package and supply no accepted observations.
