# Direct turbo splitter pickup — priority-port controls

The supplied [scaffold](scaffold.txt) has one north input to an eastbound turbo splitter, right-output priority,
and no splitter filter or input priority. Four legendary stack inserters maintain four-item iron/cable stacks.
A legendary, unmirrored stack inserter stands immediately east of the south output and feeds electronic circuits
in a legendary electromagnetic plant. The north output drains through an underground belt and turbo loader.
The south output has no continuation belt: its stock backs up between pickups, even while the north output moves.

![Supplied turbo splitter scaffold, with the target inserter on the south priority output and the north output draining](scaffold.jpg)

Native screenshot of the supplied build, captured with the shared screenshot script. The JPEG is 852×459,
quality 82, about 76 KiB, compressed from a roughly 630 KiB PNG. It illustrates the original layout; the timing
test adds a circuit gate for controlled startup. Raw PNG and screenshot recording remain under ignored
`work/mechanics-screenshots/2026-10-18T20-54-22-187Z/`.

## Reproduce these controls

Run from `clock-generator/`, using the Factorio configuration described in the [game guide](../../../../README.md):

```bash
npm run test:game -- tests/game/mechanics/belt-pickup/splitter.game.test.ts

# Select only the ingredient-swapped control.
npm run test:game -- tests/game/mechanics/belt-pickup/splitter.game.test.ts -t 'ingredients swapped'

# Retain the exact transformed blueprint, generated Lua, config, recording and native report.
# Choose a new empty directory for each run.
SPLITTER_CAPTURE_DIR=../work/belt-pickup/turbo-splitter-new-run npm run test:game -- tests/game/mechanics/belt-pickup/splitter.game.test.ts

npm run screenshots -- --case=splitter
```

The test holds only the target inserter with a circuit gate during 1,200 natural warm-up ticks, leaving the
feeder inserters and northern drain running. A temporary empty constant combinator establishes the circuit
connection; belt geometry, priority, mirroring and timing stay fixed across the controls. The probe asserts an empty
hand and empty, idle machine, then disables that inserter's circuit condition and records 60 ticks. It neither
seeds transport lines nor edits held items nor clears destination inventories. The machine operates normally.

The [probe](probe.lua) composes shared observation/capture helpers. It enumerates all splitter transport lines,
and observes upstream and downstream lines, stack IDs/counts/positions, held items, and machine inventories.
[config.json](config.json) is an **ordinary-belt comparison**, not a claim that the simulator supports splitters.
The two test variants share that setup and probe. The ingredient-swapped control changes only the four feeder
chests' iron/cable filter names and the comparison config's ingredient lanes. Retained captures are separated
into `original/` and `swapped/` under `SPLITTER_CAPTURE_DIR`.

## Measured baseline

Factorio **2.1.21**, hand capacity 16, belt stack size four, turbo speed, unmirrored input. At release:

| Transport lines | Observed length | Stock/role in this layout |
| --- | --- | --- |
| 1–2 | 179/256 tile each | Populated input: iron on 1, cable on 2 |
| 3–4 | 179/256 tile each | Empty input |
| 5–6 | 1/2 tile each | North output, draining into the underground |
| 7–8 | 1/2 tile each | South output: two blocked four-item stacks per line, at positions 0 and 1/4 |

The first sample has an empty hand; the following hands fill as below. Ticks are relative to gate release,
not absolute simulation phase or a statement about every inserter arrival orientation.

| Hand | Item | Grab ticks | Offsets from first grab |
| --- | --- | --- | --- |
| 1 | Iron plate | 2, 3, 4, 5 | 0, 1, 2, 3 |
| 2 | Copper cable | 13, 14, 15, 17 | 0, 1, 2, 4 |
| 3 | Copper cable | 25, 26, 27, 29 | 0, 1, 2, 4 |
| 4 | Copper cable | 37, 38, 39, 41 | 0, 1, 2, 4 |
| 5 | Iron plate | 49, 50, 51, 53 | 0, 1, 2, 4 |

Each grab adds four items and the hand keeps its item throughout collection. Line 8's cable stacks remain
unchanged during the entire first iron hand. Of line 7's initial iron stacks, the upstream stack at 1/4 tile
is removed first, leaving the stack at the blocked end; the latter disappears on the third grab.

Tracking IDs across samples places the four consumed iron stacks on lines **7, 1, 7, 1 in the preceding
observation**. This does not prove the arm directly reaches input line 1: the splitter may route a stack into
the output and the inserter may consume it between two observations. The initial output stock alone contains
only eight iron plates, so routing during collection supplies the rest of the hand.

Validated raw evidence is retained under ignored `work/belt-pickup/turbo-splitter-baseline-06/` (with the same
measurements also reproduced in runs 04–05). Earlier attempts failed setup or host assertions and are not the
validated regression run. The regression fixes the source/line
observations and all five hand sequences above rather than just asserting eventual pickup.

## Ingredient-swapped control

Swap the four feeder chests' ingredient names without changing the recipe, stack sizes, splitter priorities,
inserter mirroring, wiring, 1,200-tick warm-up or gate release. The recording confirms the same unmirrored
west-facing pickup, right-output priority, no input priority and no splitter or inserter filter.
All eight line lengths are unchanged. At release, line 7 contains two four-item **cable** stacks, and line 8
contains two four-item **iron** stacks, again at positions 0 and 1/4 tile.

| Hand | Item | Grab ticks | Offsets from first grab |
| --- | --- | --- | --- |
| 1 | Copper cable | 2, 3, 4, 5 | 0, 1, 2, 3 |
| 2 | Copper cable | 13, 14, 15, 17 | 0, 1, 2, 4 |
| 3 | Copper cable | 25, 26, 27, 29 | 0, 1, 2, 4 |
| 4 | Iron plate | 37, 38, 39, 41 | 0, 1, 2, 4 |

The first hand now takes cable from the **same physical line 7**, leaving line 8's iron stock unchanged.
Its consumed stack IDs have the same preceding-observation line sequence `7,1,7,1`. The trace accounts for
north-output stacks transferred downstream, so draining stock is not mistaken for pickup. The initial upstream
stack at 1/4 tile is taken before the blocked-end stack, as in the original arrangement.

The first choice therefore follows the physical line in these two arrangements, rather than a fixed iron-first,
cable-first or recipe ordering. Once collecting, the hand continues with its held item. This establishes a
preference for this unmirrored pickup with both ingredients needed; it does not rank every splitter line or
prove the same preference for other orientations, filters, priorities or mirroring states.

The machine operates normally after release, so swapping supply also changes later ingredient buffering and
the number of hands seen within 60 ticks. Both controls retain the same per-hand pause once initial stock has
been withdrawn. Validated raw captures and exact derived blueprints are retained under ignored
`work/belt-pickup/turbo-splitter-ingredient-swap-02/original/` and `.../swapped/`. The native regression checks
both variants' initial stock, first-hand IDs, all complete hand timings and the existing Sidecar warning.

## Simulator impact and next control

The first `[4,8,12,16]` hand matches both the current ordinary one-tile moving supply and backed-up supply.
The second hand does not: the game has `[4,8,12,12,16]`, while either ordinary saturated one-tile supply predicts
`[4,8,12,16]` for an isolated cable hand starting at tick 13. The comparison filters the simulator to cable
to isolate supply timing; it does not claim to reproduce the whole operating machine or infer recipe selection.
First-hand agreement therefore cannot identify splitter geometry or prove a generic saturated supply:
replenishment depends on routing into the locally blocked port even as the north output drains.

This is a measured limitation of applying the ordinary-belt approximation to an already unsupported pickup.
It does not yet establish a general splitter timing/routing rule, so the baseline makes **no production simulator
or Sidecar change**. Sidecar still emits the existing
`splitter` warning and omits pickup geometry/preferred lane; normalizing turbo speed does not capture routing.

The ingredient swap confirms that this first choice follows a physical line and leaves the timing limitation
unchanged. It supplies no new general routing rule to implement, so the simulator and Sidecar remain unchanged.
Next, flip only the target inserter's mirroring with the swapped ingredients retained to test whether preference
moves to line 8. Mirroring, opposite-port, priority/filter and both-outlets-blocked controls remain unmeasured.
No general splitter support is claimed. Continue with turbo speed only.
