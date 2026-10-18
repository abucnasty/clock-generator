# Two serial turbo splitters feeding one machine

The supplied [scaffold](scaffold.txt) has two eastbound turbo splitters in series, each with a pickup inserter.
The first north output feeds the second north input through an underground belt. The second north output
drains through a turbo loader into a disposal chest. Both south outputs have no continuation belt and back up
between pickups. Four feeder inserters maintain iron/cable stacks of four at the first north input.

![Supplied two-splitter build with one inserter on either side of the electromagnetic plant](scaffold.jpg)

Native screenshot of the supplied build, compressed with the existing script to a quality-82, 900×459 JPEG
(about 81 KiB from a 672 KiB PNG). It shows the original layout with right-output priority on both splitters;
the measurements add a shared startup gate. Raw screenshot artifacts are under ignored
`work/mechanics-screenshots/2026-10-18T21-08-52-459Z/`.

## Geometry and controlled setup

| Target | Source | Pickup approach | Original mirroring |
| --- | --- | --- | --- |
| Left/upstream, blueprint #14 | First splitter's south port | From the output side, facing west | False |
| Right/downstream, blueprint #19 | Second splitter's south port | From the input side, facing east | True |

These are distinct pieces and approaches, not two inserters competing on one splitter. Both deliver to the
same legendary electromagnetic plant making electronic circuits. Each inserter can affect the other's
ingredient eligibility through the shared machine; upstream withdrawals also affect downstream supply.
Differences between the two targets alone cannot establish a mirroring rule.

Every test starts its **own Factorio session and copied save**. Both target inserters are gated during 1,200
natural warm-up ticks, with feeders and drain running, then released in the same game tick. An empty constant
combinator and wires establish the startup gate. Both hands and the machine must be empty at release.
The probe never seeds belts, edits held items, clears machine inventories, or toggles priority during capture.
It records 120 ticks of both hands, all eight lines of each splitter, the other belts/underground transport
lines, stack IDs and positions, and the operating machine. Hand capacity is 16; Factorio version is 2.1.21.

The [config](config.json) is an ordinary-belt comparison input, not supported splitter geometry or routing.
The [probe](probe.lua) uses shared capture and snapshot helpers rather than a separate recording framework.

## Run the independent priority tests

From `clock-generator/`, with the [game harness configured](../../../../README.md):

```bash
# Separate tests, separate fresh sessions; output priority is fixed before warm-up.
npm run test:game -- tests/game/mechanics/belt-pickup/splitter-two-inserters.game.test.ts -t 'right priority, original$'
npm run test:game -- tests/game/mechanics/belt-pickup/splitter-two-inserters.game.test.ts -t 'no priority, original$'

# Includes the two additional ingredient/mirroring controls, also in fresh sessions.
npm run test:game -- tests/game/mechanics/belt-pickup/splitter-two-inserters.game.test.ts

# Retain exact blueprints, generated Lua, configs, native reports and recordings in a new directory.
SPLITTER_TWO_CAPTURE_DIR=../work/belt-pickup/turbo-two-new-run npm run test:game -- tests/game/mechanics/belt-pickup/splitter-two-inserters.game.test.ts
npm run screenshots -- --case=splitter-two-inserters
```

The priority comparison keeps original ingredients, original mirroring, gate timing and all geometry fixed.
The no-priority blueprint omits only the `output_priority` fields on splitters #12 and #20. Native metadata
asserts `right` in the priority test and `none` in the independent no-priority test. Both input priorities remain
unset and neither splitter has a filter. Each retained variant has its own subdirectory; nonempty run directories
are refused. The test does not reuse a running world to produce its comparison.

## Findings

At release, each south output has two stacks per line at 0 and 1/4 tile. Lines 7 and 8 are the south output
lines; the populated north input lines 1 and 2 have lengths 179/256 tile, and output lines have length 1/2 tile.
The original ingredients put iron on 7 and cable on 8; swapping exchanges only the four feeder chest filters.

| Independent case | Left first hand | Right first hand | First-hand grab ticks, both targets |
| --- | --- | --- | --- |
| Right priority, original | Iron, line 7 | Cable, line 8 | 2, 3, 4, 5 |
| Right priority, ingredients swapped | Cable, line 7 | Iron, line 8 | 2, 3, 4, 5 |
| Right priority, swapped + left mirrored | Iron, line 8 | Iron, line 8 | 2, 3, 4, 5 |
| No output priority, original | Iron, line 7 | Cable, line 8 | 2, 3, 4, 7 |

The left target's ingredient swap and mirror controls reproduce its earlier physical line preference: line 7
unmirrored, line 8 mirrored. The right target selects line 8 in its original mirrored input-side geometry;
its other mirroring state has not been isolated here. In every first hand the other output line remains
untouched. Consumed IDs were last observed on `7,1,7,1` or `8,2,8,2` as appropriate. The trace reconciles
both splitters and connecting pieces so routing is not mistaken for pickup. It does not prove direct access
to input lines: routing and consumption may occur between observations.

**Priority changes replenishment timing.** At tick 5, right priority gives both hands 16 items; without
priority both still hold 12, reaching 16 at tick 7. The next right-priority hands both grab at 13,14,15,17.
Without priority, the left hand grabs at 15,16,17,21 and the right at 15,16,19,23. Turbo speed is unchanged;
the routing decision changes when reachable replacement stacks arrive. These observations do not define
a universal splitter delay or establish a complete routing algorithm.

**Later hands depend on both stock and machine eligibility.** Recovered stock can give another `0,1,2,3`
hand, so `0,1,2,4` is not a fixed rule for every later collection. With ingredients swapped and right priority,
the downstream fourth cable hand grabs at 58,59,60,88. Cable is initially absent at its output; it returns while
that hand still holds 12. At ticks 70–87 two cable stacks are present, but the machine's earlier inventory
samples keep cable blocked under the engine's existing insertion-limit rule (calculated limit 39). Once the
previous sample falls to 38, the hand finishes at 88. This checks the existing eligibility rule against
observed inventory; it is not a full splitter simulation or a fresh calibration of that limit.

Mirroring only the upstream target with swapped ingredients makes both first hands iron. The downstream fourth
cable hand then grabs at 70,71,72,100. Shared ingredient buffering changes the subsequent schedule. The native
`products_finished` counter reaches 27 after 120 ticks for the original, swapped and no-priority cases, and 24
for the mirrored-left case. These startup observations do **not** establish steady throughput or a permanent
loss without priority. A clock expecting a full hand at tick 5 would nevertheless encounter a partial hand in
the no-priority case.

## Simulator impact and remaining scope

No production engine or Sidecar change is made. The selection controls agree with the earlier local preference;
the long partial-hand interval includes an already modeled sink block. Serial routing, finite shared supply
and output priority remain unmodeled for splitter pickups. Sidecar therefore retains a separate `splitter`
warning for each target and omits pickup geometry/lane preference. Successful ordinary-belt generation from
the comparison config would not verify this build.

Validated raw evidence belongs under ignored `work/belt-pickup/turbo-two-splitter-final-01/`, one folder per
independent case. The regression asserts every observed hand's item and exact grab ticks, first-hand stock/ID
traces, final native product counters, the existing machine-block classification, and both Sidecar warnings.
Opposite input arrangements, flipping only the downstream target, changing only one splitter's priority,
filtered routing and both-outlets-blocked supply remain unmeasured. Continue with one controlled change at a time.
