# Belt drop timing reference

[Belt drop documentation](README.md)

Measured tables, one per question. Everything is a legendary stack inserter with a hand of 16 on **turbo** belts unless a table says
otherwise, Factorio 2.1.24, the save's research with only the belt stack size changed. Tick **0** of a hand is its first stack (not the
pickup); the wait before it is the **delay**. Terms are in the [glossary](glossary.md); the recordings and how the tables are asserted are
in the [mechanics fixture](../../tests/game/mechanics/belt-drop-timing/README.md). Landings are tiles to the end of the piece, read in the
tick the stack appears; the first four are given.

## The calibrated case, first

The probe is judged on the case `Belt.amountToDropAtTick` stands on before any new case: a side drop (`left`) onto an empty lane, east,
belt stack sizes 1 to 4. It gives the earlier calibration's ticks and amounts, hand for hand, at each size, both in a run of this case
alone (`validation-n`) and in the run of the whole matrix (`stack-n`).

| Belt stack | Hand | Offsets of the first hand | Landings | Lane | Next hand picked up after |
| --- | --- | --- | --- | --- | --- |
| 1 | 16 | `0,1,2,4,6,8,…,28` | 0.375, 0.5, 0.625, 0.625 | 2 | 36 |
| 2 | 16 | `0,1,2,4,6,8,10,12` | 0.375, 0.5, 0.625, 0.625 | 2 | 20 |
| 3 | 15 | `0,1,2,4,6` | 0.375, 0.5, 0.625, 0.625 | 2 | 14 |
| 4 | 16 | `0,1,2,4` | 0.375, 0.5, 0.625, 0.625 | 2 | 12 |

The delay is 4 in every case. The earlier calibration measured the same ticks at Factorio 2.1.21.

## An empty lane, from each approach

Belt stack 4 (a hand of 16 is four stacks) and belt stack 1 (sixteen stacks), the first hand. `empty` lane, east; north, south and west give the
same figures for the four sides and ends of a straight line. Delay is 4 for every approach.

| Approach | Lane | Offsets, stack 4 | Landings, stack 4 | Offsets, stack 1 |
| --- | --- | --- | --- | --- |
| `left` | 2 | `0,1,2,4` | 0.375, 0.5, 0.625, 0.625 | `0,1,2,4,6,…,28` |
| `right` | 1 | `0,1,2,4` | 0.375, 0.5, 0.625, 0.625 | `0,1,2,4,6,…,28` |
| `back` | 2 | `0,1,2,4` | 0.176, 0.301, 0.426, 0.426 | `0,1,2,4,6,…,28` |
| `front` (line ends) | 2 | `0,1,2,4` | 0.574, 0.699, 0.824, 0.824 | `0,1,2,4`, then the hand waits |
| `entrance-left` | 2 | `0,1,3,5` | 0, 0, 0, 0 | `0,1,3,5,7,…,29` |
| `entrance-right` | 1 | `0,1,3,5` | 0, 0, 0, 0 | `0,1,3,5,7,…,29` |
| `exit-left` | 2 | `0,1,3,5` | 0.371, 0.496, 0.496, 0.496 | `0,1,3,5,7,…,29` |
| `exit-right` | 1 | `0,1,3,5` | 0.371, 0.496, 0.496, 0.496 | `0,1,3,5,7,…,29` |
| `entrance-from-upstream` (into the hood) | 2 | `0,1,3,5` | 0, 0, 0, 0 | `0,1,3,5,7,…,29` |
| `entrance-from-downstream` (over the hood) | 2 | `0,1,2,4` | 0.074, 0.074, 0.324, 0.324 | `0,1,2,4,6,…,28` |
| `exit-from-upstream` (over the hood) | 2 | `0,1,3,5` | 0.176, 0.301, 0.301, 0.301 | `0,1,3,5,7,…,29` |
| `exit-from-downstream` (into the hood, line ends) | 2 | `0,1` | 0.371, 0.496 | `0,1`, then the hand waits |

- A straight line is the calibrated pattern from the side and from behind, both lanes, both directions of travel. A stack lands at the
  drop point plus one step of the belt (1/8 tile) and stays within a quarter tile behind the drop point (`recordings.test.ts` asserts it for
  every straight-line scenario of every belt stack size).
- The lane is the far one for a drop across the line and the right lane (2) for a drop along it, from behind or ahead.
- An underground end is a tick slower from the third stack on (`0,1,3,5,…`), except the drop that reaches across an entrance's hood from
  downstream (`0,1,2,4,…`). The open half is 0.5 tile long: its stacks are read within that, and a stack dropped into an entrance's hood is
  read at the mouth (0) and goes below ground at once.
- The line that ends at the inserter holds four stacks of a hand in the last tile of a lane (an exit: two in its open half) and then
  the hand waits for room that never comes (see [dead ends](#a-line-that-ends-at-the-inserter)).
- The sizes at belt stack 2 and 3 follow the same offsets as the first rows of stack 1 up to the hand (8 stacks of 2, 5 stacks of 3).

## A lane with stacks moving on it

A scripted stream of copper stacks on the lane the hand lands on: **25%** (a stack every 8 ticks), **50%** (every 4) and **75%** (three
of every 8), each started at tick 1 and kept going. The hand arrives at a different moment of the stream's cycle, the **phase**: the ranges are over the phases (8 at 25%
and 75%, 4 at 50%). Belt stack 4, a hand of four stacks, first hand; delay and duration (the offset of the last stack) in ticks. An empty lane
is a delay of 4 and a duration of 4 (5 on an underground end).

| Approach | 25%: delay / duration | 50%: delay / duration | 75%: delay / duration |
| --- | --- | --- | --- |
| `left`, `right` | 4 / 6–8 | 4 / 10–12 | 4–8 / 22–24 |
| `back` | 4 / 6–8 | 4 / 10–12 | 4–8 / 22–24 |
| `entrance-left` | 4 / 6–8 | 4 / 10–12 | 4–8 / 23–24 |
| `entrance-right` | 4 / 6–8 | 4 / 11–12 | 4–8 / 22–24 |
| `exit-left` | 4–5 / 6–8 | 4–5 / 11–12 | 4–10 / 22–25 |
| `exit-right` | 4–6 / 6–8 | 4–6 / 11–12 | 4–10 / 23–25 |
| `entrance-from-upstream` | 4 / 6–8 | 4 / 10–12 | 4–8 / 22–24 |
| `entrance-from-downstream` | 4 / 4–6 | 4 / 8–10 | 4–5 / 16–22 |
| `exit-from-upstream` | 4 / 6–8 | 4 / 10–12 | 4–8 / 22–24 |

- The hand is delayed in the gaps of the stream, not by a fixed amount: its stacks go to the gaps as the lane carries them past the drop
  point, so the duration grows with the share of the lane the stream takes (about 6–8, 10–12 and 22–24 ticks for four stacks at 25%,
  50% and 75%; a lane of three quarters leaves one gap of a quarter tile in every tile, so the hand's stacks come one in every 8 ticks).
- At belt stack 1 (sixteen stacks) the same streams give 38–40, 58–60 and 118–120 ticks on a straight line.
- The first stack lands 3/8 to 3/4 tile from the end of the piece, according to the phase: where the gaps are. The landings seen for the first
  stack on `left`, at 25%: 0.375, 0.496, 0.621, 0.746; at 50% the same four; at 75% 0.375, 0.496, 0.621, 0.746.
- Every stack of a straight line lands within a quarter tile behind the drop point (never more), as on an empty lane.

## A full lane

The stream at full density (a stack every second tick) stops at tick 60, 19 ticks after the pickup. The hand waits until a gap
reaches the drop point and then puts a stack down every second tick. Belt stack 1–4, first hand.

| Approach | Delay | Offsets (stack 4) | Landing of the first stack |
| --- | --- | --- | --- |
| `left`, `right` | 46 | `0,2,4,6` | 0.746 |
| `back` | 24 | `0,2,4,6` | 0.496 |
| `entrance-left`, `entrance-right`, `entrance-from-upstream` | 22 | `0,2,4,6` | 0 or 0.246 |
| `exit-left`, `exit-right` | 48 | `0,2,4,6` | 0.496 |
| `exit-from-upstream` | 49 | `0,2,4,6` | 0.371 |
| `entrance-from-downstream` | 5 | `0,18,20,22` | 0.371 |

- The wait is as long as the lane is full: the first stack lands 27 ticks after the last stack of the stream entered the line for a side
  drop (5 ticks for a drop from behind, whose drop point is at the line's start). Nothing is placed in front of or into a stack of the
  stream.
- `entrance-from-downstream` drops where the stream has not arrived yet (the stream enters at the line's start, upstream of the drop
  point): the first stack finds room, the rest wait for the stream to pass.
- Every approach gives the same figures at belt stack sizes 1 to 4 (`0,2,4,…`, one stack every second tick), except an exit's later
  stacks at belt stack 1 (`…,22,23,25,27,29`).

## A line that ends at the inserter

`front` (the inserter stands ahead of the last belt, dropping against the travel) and `exit-from-downstream` (ahead of an underground
exit). The lane cannot move on, so a stack read at the end of the piece stays there and the next lands behind it.

| Queue on each lane at the end | `front`: stacks taken | Landings | `exit-from-downstream`: stacks taken |
| --- | --- | --- | --- |
| none | 4 (`0,1,2,4`) | 0.574, 0.699, 0.824, 0.824 | 2 (`0,1`) |
| 2 stacks | 2 (`0,1`) | 0.574, 0.75 | 0 |
| 3 stacks | 1 (`0`) | 0.75 | 0 |
| 4 stacks | 0 | none | 0 |

The same at every belt stack size (1 to 4) and every hand: the line takes as many stacks as it has room for in the last tile (four
per lane), whatever their size. At belt stack 1 to 3 the rest of the hand stays in the inserter (it is never picked up again); at belt stack 4
a hand of 16 is exactly the four stacks, and the next hand is picked up and finds no room.

## The other inserter kinds

The five electric prototypes at normal and legendary quality (the burner inserter needs fuel and is not run by the engine), with the
save's research (hands of 4, 12 and 16), on `left` onto an empty lane; on the other sides and ends, empty, every kind lands on the lane and the
places the stack inserter does (`recordings.test.ts`), and with a stream or a full lane the kinds' first hands were recorded the same way
(the recordings). The long-handed inserter stands two slots from the line.

| Kind | Hand | Delay, normal | Delay, legendary | Items in a drop | Offsets of the first hand |
| --- | --- | --- | --- | --- | --- |
| inserter | 4 | 35 | 14 | 1 | `0,1,2,4` |
| long-handed inserter | 4 | 24 | 9 | 1 | `0,1,2,4` |
| fast inserter | 4 | 12 | 4 | 1 | `0,1,2,4` |
| bulk inserter | 12 | 12 | 4 | 1 | `0,1,2,4,6,8,…,20` |
| stack inserter | 16 | 12 | 4 | 1 / 3 / 4 for belt stack 1 / 3 / 4 (hand 16 / 15 / 16) | as the calibrated case |

- Only the stack inserter puts down a belt stack; every other kind puts down one item at a time, at the belt's ticks, whatever the belt
  stack size. At belt stack 4 a hand of 4 occupies four slots of the lane, as the stack inserter's 16 does.
- The hand is not cut to whole belt stacks for those kinds: a basic inserter holds 4 at belt stack 3 (the stack inserter 15).
- The delay is the engine's swing from a chest to a belt: `rotationTicks(prototype, quality) + 1` for each kind and quality
  (`recordings.test.ts` asserts it for all ten).
