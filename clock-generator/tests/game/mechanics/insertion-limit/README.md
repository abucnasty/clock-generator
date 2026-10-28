# Insertion limit

What an inserter does when it drops into an assembling machine or a furnace whose ingredient is near the automated
insertion limit, recorded in the game and read against the simulator's rule (the limit is the amount a craft takes times
the overload multiplier; a machine at the limit is not given more; a hand that is taken goes in whole).

`limit.game.test.ts` runs three game runs (see [cases.ts](cases.ts)); [probe.lua](probe.lua) builds each machine with a
chest and an inserter, sets the stock of one ingredient to each chosen value in turn, lets the inserter go and logs
every tick the stock, the hand and the statuses. Machines are never given their other ingredients (or are disabled by
script), so nothing is crafted and the stock changes only by the drop.

| Run | Force bonuses | Basic hand | Stack hand |
| --- | --- | --- | --- |
| `hand-large` | the save's (3 and 11) | 4 | 16 |
| `hand-mid` | 1 and 3 | 2 | 8 |
| `hand-small` | none | 1 | 5 |

A trial is one drop from a chosen stock (every stock from 0 to a little past the limit; for a limit of 150 a sparse set
and every stock within a hand of it), or a drop from an empty machine whose stock the probe raises to the limit, one
over it or two over it in the tick the inserter holds its hand (a drop that follows another inserter's). A basic inserter
is also given a chest of 2 items in `hand-large`. A stack inserter waits for a full hand from a chest, so a smaller
hand for it comes only from the bonuses.

`recordings/` keeps the logs as gzip (`<run>.json.gz`). `recordings.test.ts` reads them without Factorio and asserts
the limit of 15 machine and recipe pairs (assembling machines 1 to 3 with and without speed modules, a stone, steel and
electric furnace), that an inserter does not pick up at a stock at or over the limit, that under it the whole hand goes
in, that a hand already held goes in whole at any stock, and that the simulator's limit, pickup gate and drop agree.
A game run writes a new log with `LIMIT_CAPTURE_DIR`, an empty directory:

```bash
LIMIT_CAPTURE_DIR=.scratch/limit-run \
  npm run test:game -- tests/game/mechanics/insertion-limit/limit.game.test.ts
```

Copy `<run>/<run>.json.gz` from the capture into `recordings/` to replace a log. Measured conditions: Factorio 2.1.21,
the staging save's surface, plain `inserter` and `stack-inserter` of normal quality powered by an electric energy
interface, items from a steel chest. Not recorded: inserters from a belt or a machine (a partial hand), fuel, fluids,
a machine that is crafting while it is filled.
