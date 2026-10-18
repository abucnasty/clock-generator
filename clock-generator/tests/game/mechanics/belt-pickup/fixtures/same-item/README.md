# Moving pickup with the same item on both lanes

These fixtures isolate an inserter taking iron plates from both lanes of a continuously moving turbo belt.
The measured rule is to take the upstream-most reachable stack on the near lane, falling back to the far lane when
the near lane has none. There is one grab total per tick and no fixed delay for changing lanes. With two saturated
lanes of four-item stacks, a hand of 16 filled at offsets `0,1,2,3` on all three geometries at turbo and express
speeds. The simulator uses this lane order and retains each lane's holes and partial stacks between hands.

Each scaffold has the same cell: a legendary assembling machine 3 making iron gears, a legendary stack inserter
bringing iron plates, and another taking gears into an infinity chest that removes them. Both hands hold 16.
The assembler has no modules: crafting speed 3.125, productivity 0. The ordinary config targets 6 gears/second.

Four feeder inserters fill the two lanes with iron plates in stacks of four. A loader and disposal infinity chest
drain the far end so the belt keeps moving. Feeder inserters and disposal infrastructure are outside the modeled
cell. Build on a powered editor surface with all inserter-capacity and belt-stack research, as with the other
scaffolds. There is no clock in these blueprints.

| Scaffold | Pickup | Matching config |
| --- | --- | --- |
| `straight-belt-scaffold.txt` | One exposed tile; control case | `straight-belt.json` |
| `underground-entrance-scaffold.txt` | Half an exposed tile | `config.json` |
| `underground-exit-scaffold.txt` | Half an exposed tile | `config.json` |

Input Inserter 2 stands beside the belt, with lane 1 nearest to it. Both configs explicitly specify the pickup
length and nearest lane. Output Inserter 1 takes gears from Machine 1 into Chest 1.

## Capture pickup timing

From `clock-generator/`, with `.env` pointing at Factorio and the staging save:

```bash
npm run build
pickup_sample=tests/game/mechanics/belt-pickup/fixtures/same-item
node --env-file=.env dist/record-in-factorio.js \
  --blueprint="$pickup_sample/underground-exit-scaffold.txt" \
  --config="$pickup_sample/config.json" --unclocked --warmup=1200 --ticks=1260 \
  --lua="$pickup_sample/probe.lua" \
  --out=../work/same-item-pickup/underground-exit-recording.json \
  --work-dir=../work/same-item-pickup/underground-exit
```

The normal recording is written to `--out`. The probe writes
`<work-dir>/script-output/same-item-pickups.json`: 1,200 ticks of held quantity, hand position, and each exposed
lane's stack positions, quantities and unique IDs. Use the IDs to distinguish a taken stack from one that simply
moved out of reach. Discard the first 60 ticks to get past any hand left over from warm-up.
An empty lane's `stacks` is `{}` in Factorio's JSON; read it as an empty list.

The probe clears the assembler's input and output every tick so its ingredient limit and output blockage cannot
stall the pickup. This deliberately interrupts production: use the probe to compare grab ticks and lane choices,
not gear throughput. Omit `--lua` to record normal production or later test a generated clock.

Repeat with the entrance scaffold, and with the straight scaffold plus `straight-belt.json`, using separate
output/work directories. The command captures one starting stream phase. First-grab/arm arrival timing,
resumption after an interrupted partial hand, yellow/red speeds and backed-up supply are outside this probe's
verified two-lane scope.

```bash
npm run test:game -- tests/game/mechanics/belt-pickup/same-item-pickup-fixture.game.test.ts tests/game/builds/same-item-pickup-clock.game.test.ts
```

The twelve game checks validate the captured machine speed, both lanes' contents and stack sizes, pickup geometry,
matching config connections, and full hands on turbo and express belts with the inserter on either side. They replay
the near-first/far-fallback rule from each hand's observed first grab and remaining stacks, predicting every later
grab and lane snapshot. They also confirm that restricting the replay to the first lane misses underground hands.
The actual simulator's unrestricted hand must match every complete measured hand's grab offsets too.

The broader investigation covered 78 captures and 5,268 uninterrupted hands, including hands of 8/12/16,
interrupted windows and staggered turbo lanes, with no mismatch for the two-lane rule. Restricting the replay to
the first lane missed the timing of 1,078 hands; the simulator now implements the measured fallback.

Six additional game tests generate the current default clocks, check every baseline period (at least 60 per
scaffold), and test recovery after two ingredient cuts and a filled/restored output disposal chest. They require
exact output after a six-period recovery allowance, without resetting the clock or machine. All six passed with
the fallback implementation: 16 gears per 160 ticks (6/second), with a 26-tick input window on every geometry.
The underground window was 28 ticks before the correction. See
[the simulator findings](../../../../../../docs/simulator.md#picking-up-from-moving-belts-and-underground-endpoints)
for the general rules and measured scope; raw investigation captures and analysis remain local under
`work/same-item-pickup/investigation/`.
