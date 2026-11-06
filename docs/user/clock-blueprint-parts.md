---
$schema: urn:oasis:names:tc:dita:xsd:reference.xsd
id: clock-blueprint-parts
---

# Parts of a clock blueprint

A clock blueprint has only combinators. It has no inserters and no machines. The combinators have wires between them.
Do not change these wires.

## Parts

| Part | Signal | Function | Wires |
|---|---|---|---|
| Clock: a decider combinator | **Clock** | Counts from 1 to the wraparound value, one count each tick. Then it starts again at 1. It counts only while **Lock** is 0. | Green, from its output to its input. |
| **Clock lock**: a constant combinator, below the clock | **Lock** = 1 | Stops the clock when it is on. It is off in the blueprint. | Red, to the clock and to each filter. |
| Filter: a decider combinator | All signals | Sends the signals of the clock to the enable window combinators while the lock is off. | Green, from the clock network to the enable window combinators. |
| Enable window combinator: a decider combinator | The items of its inserters, each = 1 | Sends its items while the clock is in the enable windows of its inserters. Its description gives the inserters or mining drills. | Green, from the filter. Its output goes to the inserters. |
| Modulo combinators: arithmetic combinators, in some clocks only | **Signal A**, **Signal B** and the letters after B, **Signal T** | Make a shorter count from the clock, for inserters that have a shorter window cycle. | Green, on the clock network. |
| Subtick combinators: two arithmetic combinators, in a subtick clock only | **Clock** | Multiply the count, then give the position in parts of a tick. | Green, from the clock to the filter. |
| Fuel clock: a decider combinator and a filter, in some clocks only | **Clock** or a letter signal | Counts for the inserters that put fuel into machines. | Green. Red from the lock. |

There is one enable window combinator for each inserter, mining drill or group of inserters with the same enable
windows.

Each combinator of the clock has this text at the start of its description: "Part of the clock: do not wire or change."

The blueprint label is the name of the product, then "clock". If the clock has modulo combinators, the label ends with
"(modulo clock)". The blueprint string is then a book with two blueprints of the same clock. Use the first blueprint.

## Stop a clock

To stop the clock, set the **Clock lock** to on. While the lock is on, the clock does not enable an inserter or a
mining drill.

To start the clock again, set the **Clock lock** to off. The clock starts again at 1. The first window cycle after this
can be one tick longer or shorter.

## Related information

- [Export a build from Factorio](export-a-build.md)
