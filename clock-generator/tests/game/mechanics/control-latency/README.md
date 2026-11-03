# Control latency

A decider combinator switches inserters on and off at ticks a probe chooses: a constant combinator gives signal A, the
decider gives E = 1 while A > 0, and each inserter is enabled while E > 0. Recorded in Factorio 2.1.24 with legendary stack
inserters, one cell per state of the inserter when the switch comes ([cases](cases.ts), [probe](probe.lua)). The probe
logs every tick, at one point of the tick: the decider's input and output, each inserter's circuit signal, its disabled
flag, its status, its hand (count and position) and what its source or machine holds. The recording is
[recordings/control-latency.json.gz](recordings/); [recordings.test.ts](recordings.test.ts) reads it offline.

Counted from the first sample in which the decider's input shows the change:

| What the inserter is doing when it is enabled | Decider output | Disabled flag and status | First items in the hand |
|---|---|---|---|
| idle at a chest with items | +1 | +2 | +3 |
| asleep at a machine that has room again by then (room made while it was disabled) | +1 | +2 | +3 |
| idle over a backed-up belt | +1 | +2 | +3 (its first stack) |
| two inserters on one decider, each at its own chest | +1 | +2 | +3, both |
| over an empty belt | +1 | +2 (waiting for source items) | when plates arrive |

- **A disable** shows in the disabled flag 2 samples after the decider's input; a hand that is moving then finishes its
  swing, drops and swings back to its pickup, and stays there.
- **Two inserters on one decider, one hand's worth in their one chest:** the inserter built second took it, in the sample
  the first items came in the other cells. One observation; not a rule about order.
- **Asleep at a machine, woken by another entity:** when another inserter takes the machine's products off its output
  block, the inserter waiting to put into it has its first items one sample after the take (2 of 2); when the machine's
  craft takes its input under the insertion limit, one sample after the plates go down (3 of 3). Never in the sample of
  the take or the craft. Also when the machine finished a craft (its last: it had no plates for another) in the sample
  before the take, or in the take's sample, or two or three samples before it (4 of 4).

The simulator reproduces each of these under both dispatches (`src/simulation/control-latency.test.ts`): an inserter
woken while the tick walks the update list is updated first in the next tick.

```bash
npm test -- tests/game/mechanics/control-latency/recordings.test.ts src/simulation/control-latency.test.ts
# a new recording (Factorio and the harness save configured, see ../../README.md)
CONTROL_LATENCY_CAPTURE_DIR=.scratch/control-latency/run-01 npm run test:game -- tests/game/mechanics/control-latency/control-latency.game.test.ts
```
