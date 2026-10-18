# Turbo belt drop timing at stack sizes 1–4

Question: does `Belt::amountToDropAtTick` predict actual deposits at each effective belt stack size, without
changing researched technologies?

The [scaffold](scaffold.txt) has one legendary stack inserter taking iron from a source chest and depositing
onto an eastbound turbo belt. Two more straight tiles lead to an input loader and a receiving steel chest.
A constant combinator gates the inserter during 120 warm-up ticks. The source is empty during warm-up;
the probe then inserts exactly 32 iron plates into the source chest and releases the gate. The source is an
infinity chest with an iron filter set to **at least zero**, with unfiltered removal disabled: it identifies the
source item for capture but supplies no additional items. Conservation checks enforce that finite supply. Belts and held
items are never seeded or edited. The receiving chest retains all deposits, so every item can be accounted for.

![Single legendary inserter depositing onto three eastbound turbo tiles and a loader to a receiving chest](scaffold.jpg)

Native Factorio screenshot of the base layout, produced by the existing screenshot script and compressed to
quality-82, 562×324 JPEG (about 29 KiB from a 262 KiB PNG). It illustrates geometry; it does not show a measured deposit or prove timing.

The [probe](probe.lua) changes only `force.belt_stack_size_bonus` to `stackSize - 1`, using the writable
[LuaForce runtime property](https://lua-api.factorio.com/2.1.21/classes/LuaForce.html#belt_stack_size_bonus).
It compares the complete researched/level state of all technologies before and after that change and at the
end of capture. The inserter's configured hand override remains 16. All four tests use the identical blueprint,
source quantity, geometry, direction, mirroring, warm-up and gate timing, each in its own fresh session/save.
Factorio version: **2.1.21**. The engine config is intentionally absent: this isolated chest-to-belt question
compares the exported `Belt` function directly, not a generated clock or a synthetic crafting machine.

## Findings

Offsets below start at the first actual native deposit, not arm arrival or gate release.

| Belt stack size | Effective full hand | First-hand native drop ticks | Drop offsets | Items per drop |
| --- | --- | --- | --- | --- |
| 1 | 16 | 6,7,8,10,12,14,16,18,20,22,24,26,28,30,32,34 | 0,1,2,4,6,…,28 | 1 |
| 2 | 16 | 6,7,8,10,12,14,16,18 | 0,1,2,4,6,8,10,12 | 2 |
| 3 | 15 | 6,7,8,10,12 | 0,1,2,4,6 | 3 |
| 4 | 16 | 6,7,8,10 | 0,1,2,4 | 4 |

The second full hand has the same offsets, starting at tick 42, 26, 20 or 18 respectively. The receiving tile
is empty before each hand starts dropping. All empty ticks as well as deposits match the production function.
The first three stacks appear at native line positions 3/8, 1/2 and 5/8 tile; subsequent stacks enter at 5/8.
Existing IDs move 1/8 tile per tick across the three straight tiles, with no compression or obstruction.
Each deposit creates one stack whose count matches the hand decrement and never exceeds the selected limit.

At stack size 3, the natural pickup is **15 rather than 16**. The engine already rounds belt-bound hands down
to a multiple of the lane stack size; its existing `handSizeFor` regression expects 15. This is a hand-capacity
effect, not a different deposit cadence. Two full hands deliver 30 items; the final two source items remain
held through tick 120, waiting for a full hand. Other sizes deliver all 32. Source + hand + every belt/loader
stack + receiving chest always totals 32, including that partial hand.

No production simulator or Sidecar change is needed. Offline regression expectations for stack sizes 2 and 3
are added beside the existing belt function tests, derived from these native traces. This validates turbo
straight-belt drops into initially empty receiving tiles under the measured geometry, not obstructed drops,
other belt speeds, unusual hand overrides or every orientation.

## Reproduce

From `clock-generator/`, with the [game harness configured](../../../../README.md):

```bash
# Select one stack size at a time during investigation.
BELT_DROP_CAPTURE_DIR=../work/belt-drop/new-run npm run test:game -- tests/game/mechanics/belt-drop/turbo-stacks.game.test.ts -t 'stack size 3$'

# Affected native regression and offline checks.
npm run test:game -- tests/game/mechanics/belt-drop/turbo-stacks.game.test.ts
npm test -- src/entities/belt/belt.test.ts src/entities/inserter/inserter-hand-size.test.ts
npm run screenshots -- --case=turbo-belt-drop-stacks
```

The retained run directory must be empty for the selected size. Each size gets its own subdirectory containing
the exact blueprint, composed probe, ordinary recorder output and `game/script-output/belt-drop-stacks.json`.
The report has a pre-release snapshot and 120 native tick samples of the hand, both chest quantities, and every
transport line's stack ID, position, item and count. The shared capture/snapshot helpers only observe; assertions
and production comparisons live in the game test. All four finalized controls passed in
ignored `work/belt-drop/turbo-final-02/`.
