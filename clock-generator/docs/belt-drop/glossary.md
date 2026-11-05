# Belt drop glossary

[Belt drop documentation](README.md)

How to read the [timing tables](timing.md) and the [experiment findings](experiments.md). These are definitions, not diagrams.

## The line and where things are read

Every scenario is a **line** of eight **slots** numbered 0 to 7 along its travel. Coordinates are in the line's own frame, in tiles: **u**
along the travel from the middle of slot 0 (so slot `k` spans `k − 0.5` to `k + 0.5`) and **v** to the right of the travel. The line runs
east, north, south or west in different scenarios; nothing differs between them (checked in `recordings.test.ts`), and the tables use east.

A slot is a turbo transport belt, or for the underground approaches slot 0 is an **entrance**, slots 1 and 2 are the tunnel (open ground,
where an inserter or a chest can stand), slot 3 is the **exit** and slots 4 to 7 are belts again. An underground end exposes half a tile of
each lane: an entrance's **open half** is the upstream half of its tile, its **hood** the downstream half, where items go below ground; an
exit's hood is its upstream half, its open half the downstream half, where items come out (the terms of the
[pickup glossary](../belt-pickup/glossary.md)).

A **lane** is the game's transport line: 1 is the left lane in the direction of travel, 2 the right. An underground end also has lines 3
and 4 for the part below ground; they are the same lanes.

**Position** (the *landing*) is what the game reports for a stack: the distance in tiles to the end of the piece it stands in, read in the
tick the stack appears, after that tick's step of the belt. A turbo belt steps 1/8 tile a tick, so a stack placed at a spot is read
1/8 tile nearer the end than where it was put. On a belt piece (1 tile long) the place along the piece is `1 − position`; an open half is
0.5 long. **Path** is the same measured from the start of slot 0: slot + 1 − position.

## The twelve approaches

An inserter swings from its chest to a drop point; the approach is where it stands. `left` and `right` are the sides of the line in the
direction of travel.

| Approach | The inserter stands | Drop point (u, v) | Falls on |
| --- | --- | --- | --- |
| `left` | beside slot 3, on its left | 3, +0.2 | the middle of the belt, a fifth of a tile toward the far side |
| `right` | beside slot 3, on its right | 3, −0.2 | the same, from the other side |
| `back` | behind slot 0, dropping along the travel | 0.2, 0 | slot 0, 0.7 along it |
| `front` | ahead of slot 7, dropping against the travel; the line **ends** at the inserter | 6.8, 0 | slot 7, 0.3 along it |
| `entrance-left`, `entrance-right` | beside the entrance | 0, ±0.2 | the middle of the entrance tile |
| `exit-left`, `exit-right` | beside the exit | 3, ±0.2 | the middle of the exit tile |
| `entrance-from-upstream` | behind the entrance, dropping along the travel | 0.2, 0 | the entrance's **hood** half (0.7 along) |
| `entrance-from-downstream` | over the tunnel, dropping back at the entrance | −0.2, 0 | the entrance's **open half** (0.3 along), across its hood |
| `exit-from-upstream` | over the tunnel, dropping forward at the exit | 3.2, 0 | the exit's **open half** (0.7 along), across its hood |
| `exit-from-downstream` | ahead of the exit, the line **ends** at the inserter | 2.8, 0 | the exit's **hood** half (0.3 along) |

The inserter that drops a fifth of a tile past the middle of the belt is the vanilla one: none of the kinds measured allows a custom drop
position. **Into the hood** is a drop whose point falls on the hood half (`entrance-from-upstream`, `exit-from-downstream`), the near side
of the underground end for the inserter; **over the hood** a drop that reaches across the hood to the open half (`entrance-from-downstream`,
`exit-from-upstream`), the far side. A drop from the side onto an underground end falls on the middle of its tile, on the line between the
two halves.

## Lane states

The receiving lane where the hand lands, set before the chest is filled (tick 40) and, for a stream, kept going while the hand drops.

| State | What is on the lane |
| --- | --- |
| **empty** | nothing |
| **25%**, **50%**, **75%** (`d25`, `d50`, `d75`) | a scripted stream of copper stacks from tick 1 on both lanes: one stack every 8 ticks (a quarter of the lane's room), every 4, or three of every 8; the **phase** shifts the stream against the hand, 0 to 7 ticks (0 to 3 at 50%) |
| **full** | a stack every second tick, which is the lane at full density; the stream stops at tick 60 so the gap's arrival can be measured |
| **queue n** | on a line that ends: `n` stacks of copper on each lane at the end of the last piece |

A stream stack is placed at the start of the line by the script (`insert_at`, which puts it one step in); the sink at the end of the line
empties the last piece after every sample, so a flowing line never backs up.

## Hands, delays and offsets

The **hand** is what the inserter holds after the pickup: the research gives a basic, fast and long-handed inserter 4, the bulk inserter 12
and the stack inserter 16; at belt stack 3 the stack inserter's is cut to 15 (a whole number of belt stacks). A drop is one **stack** on the
belt: a belt stack for the stack inserter, one item for every other kind. **Delay** is the ticks from the pickup (the first tick the hand is
held) to the first stack. **Offsets** are the ticks of the stacks counted from the first, so `0,1,2,4` is a hand of four stacks in five ticks.
The first four offsets are the same on a free lane for every approach that is a straight belt (the empty-lane tables).
