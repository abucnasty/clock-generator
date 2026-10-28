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
ticks they change at, then runs a drill through the simulator's state machine with the same windows and shows what its
Factorio state is (`factorioDrillState`). A game run writes a new log with `DRILL_STATUS_CAPTURE_DIR`, an empty directory:

```bash
DRILL_STATUS_CAPTURE_DIR=.scratch/drill-status-run \
  npm run test:game -- tests/game/mechanics/drill-status/drill-status.game.test.ts
```

Copy `<run>/<run>.json.gz` from the capture into `recordings/` to replace a log. Measured conditions: Factorio 2.1.21,
the staging save's surface. The first tick of an electric drill shows `no_power` and of a wired one
`disabled_by_control_behavior` (the network's first tick); the checks start at tick 5.
