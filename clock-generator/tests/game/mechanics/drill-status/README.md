# Drill status

The status the game shows for a burner, an electric and a big mining drill that is switched off, whose chest is full,
or that has dropped as much as a machine takes, logged every tick and read against the state the simulator records for a
drill.

`drill-status.game.test.ts` runs two game runs (see [cases.ts](cases.ts)); [probe.lua](probe.lua) puts each drill on its
own iron ore, gives a burner drill coal and an electric one power, and logs every tick `entity.status`, the mining bar and
the ore that came out. The mining productivity research is put at 0.

| Run | Ticks | What it records |
| --- | --- | --- |
| `stops` | 1,500 | each drill into a steel chest: disabled by a circuit condition (a constant combinator, off from tick 100 to 300 and from 320 to 500), disabled by script at the same ticks, the chest filled at tick 300 and 100 ore taken at tick 800, and a chest with room for two ore |
| `machine` | 5,000 | a big drill into a stone furnace that cannot craft: it stops at its own limit |

`recordings/` keeps the logs as gzip. `recordings.test.ts` reads them without Factorio and asserts the statuses and the
ticks they change at, then runs a drill through the simulator with the same windows, takes and chest, and compares the state
it records (`DrillStateTracker`) with the game's row by row. The game's first update of every drill moves no bar; the
simulator's electric and big drill move it in their first tick, so their tick j is the recording's row j + 1, while its
burner drill fills its empty buffer in its first tick of mining and moves no bar, as that row shows, so its tick j is row j.
The windows, the fill and the take are given to each simulated drill in its own ticks, and every drill is compared with the
same rows of the game.

What the recordings show, and the simulator does the same:

- Switched off by a circuit condition a drill mines until two ticks after the condition and shows `disabled_by_control_behavior`
  from the row of its last mining tick, until the row of the last tick it is off. The simulator's control carries the two
  ticks; its state is recorded one tick before the drill stops, which is the row the game shows it in.
- A drill shows `waiting_for_space_in_destination` while it holds an item its destination has no room for: a full chest, a
  machine at its stop. An item it has just mined and drops in the next tick is not waiting.

Left out of the comparison, each in one row: the first ore of a drill's life shows `waiting_for_space_in_destination` once
with room in the chest (the simulator does not); row 800 of the full-chest run, which the probe reads after taking the ore
out; and the big drill's blocked span, which starts a row after the ore it cannot drop is mined where the burner's and the
electric drill's start in that row. A drill disabled by script shows `disabled_by_script`, which the simulator has no
control for: its mining and its disabled rows are compared as a circuit's. A game run writes a new log with `DRILL_STATUS_CAPTURE_DIR`, an empty directory:

```bash
DRILL_STATUS_CAPTURE_DIR=.scratch/drill-status-run \
  npm run test:game -- tests/game/mechanics/drill-status/drill-status.game.test.ts
```

Copy `<run>/<run>.json.gz` from the capture into `recordings/` to replace a log. Measured conditions: Factorio 2.1.21,
the staging save's surface. The first tick of an electric drill shows `no_power` and of a wired one
`disabled_by_control_behavior` (the network's first tick); the checks start at tick 5.
