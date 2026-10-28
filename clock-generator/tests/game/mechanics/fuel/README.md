# Burner fuel

How a stone furnace, a steel furnace, a burner mining drill and a captive biter spawner use fuel, recorded tick by tick
in the game next to a biochamber, the one burner the simulator fuels today.

`fuel.game.test.ts` runs four game runs (see [cases.ts](cases.ts)); each builds its machines side by side on a spot beside
the recorder's idle assembler, and [probe.lua](probe.lua) logs every tick, for each machine, its burner's energy buffer
(`burner.heat`; the entity's `energy` is the same number), what is left of the burning item
(`remaining_burning_fuel`), the items in the fuel slot, the progress bar, the status, the output and the fuel inserter's
hand. The probe supplies ingredients and takes products away (it is a cheat the machine does not see), puts fuel in at
chosen ticks, and stops a machine's work at chosen ticks by taking its ingredients away, filling its output, or setting
`disabled_by_script`. The mining productivity research of the save is put at 0 except in `drill-productivity`.

| Run | Ticks | What it records |
| --- | --- | --- |
| `steady` | 6,000 | every burner working from a full slot, on coal, wood, solid fuel, bioflux or nutrients: the burn a tick, the buffer, the swap of the burning item |
| `stops` | 3,000 | machines with no work from the start; furnaces, the biochamber, the drill and the spawner stopped for 300 ticks by their ingredients, a full output or a script; machines run out of fuel and given one item; a drill dropping into a furnace |
| `drill-productivity` | 1,200 | the drill with the save's mining productivity research, alone and into a furnace |
| `feed-hand-1`, `feed-hand-4` | 900 | an inserter from a chest of fuel into each burner, the hand set by the force's bonuses (1 and 5 for a stack inserter; 4 and 16) |

A run builds up to 20 machines in rows of ten, nine tiles apart; a furnace that takes a drill's ore stands where the
drill drops (`at_drop_of`).

`recordings/` keeps the four runs' logs as gzip (`<run>.json.gz`, about 1.3 MB in all). `recordings.test.ts` reads them
without Factorio and asserts what they show: the usage and buffer of each prototype, the buffer-and-top-up
rule in every tick of every machine, the swap of the burning item, stops and restarts, running out of fuel, and the
inserter's fill. A game run writes a new log with `FUEL_CAPTURE_DIR`, an empty directory:

```bash
FUEL_CAPTURE_DIR=.scratch/fuel-run \
  npm run test:game -- tests/game/mechanics/fuel/fuel.game.test.ts
```

Each run takes a few seconds. Copy a run's `<run>.json.gz` from the capture into `recordings/` to replace a log.

Measured conditions: Factorio 2.1.21 (build 87673), the staging save's surface, a plain `inserter`, `fast-inserter` and
`stack-inserter` powered by an electric energy interface. Not recorded: modules or beacons on a burner (none of the
four takes any), fuels with a burnt result (nuclear fuel), a burner whose fuel slot holds two kinds of fuel.
