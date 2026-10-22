# Iron plates through a car

The owner's build: a big mining drill with 4 legendary speed modules 3 mines iron ore and drops it into a car, which is
used as a chest. Two legendary stack inserters take the ore from the car into two legendary electric furnaces, each with
2 legendary productivity modules 3 and 7 legendary beacons. Their output inserters put the plates onto a turbo belt that
a loader empties into a disposal chest. The target is 80 plates a second from one copy.

- `car-scaffold.txt`: the owner's blueprint as given. The loader and disposal chest are part of it.
- `car.sidecar-export.json`: what Sidecar 0.12.0 exported from the blueprint built in the harness game.
- `car.json`: that export as the paste reads it (each list through its schema), with the target added. No field was
  edited.

The harness game has no ore, so the harness puts iron ore under the drill before it builds it (`drill_resource`, from the
config's drill). The export was taken after a warm-up of 3600 ticks without a clock, as a furnace has no recipe until it
gets its first input. The sidecar exports a car empty, whatever it holds when selected.

The rate is within the machines: the furnaces make 2 × 86.1655 / 3.2 × 1.5 = 80.78 plates a second at most, so 80 uses
99.0% of them. The drill mines 2.5 × (1 + 17.5) = 46.25 ore a second before mining productivity. The harness's research
is mining productivity 3 at level 8000, 7,999 levels, so the drill's productivity is +79,990% and it makes about 37,000
ore a second against the 53.3 the furnaces take: it never limits anything, and the car, 80 stacks of 50 ore, is always
full while the drill runs.

## In the game

The selected clock (3 output swings, 72 ticks) and the clock with 1 output swing move 96 plates in each of 63 periods in
the game, and get back to it after the drill is stopped until the car has run dry (71 periods), the output is blocked for
4 and the drill is stopped again (`tests/game/builds/car-clock-controls.json`). Building the two inserters that take from
the car after the output inserters changed nothing in any period. The simulator counts 200.0 wake-ups a minute for the
selected clock from the scaffold's cold start, where the game's states give 3.8; the difference is not explained yet.
