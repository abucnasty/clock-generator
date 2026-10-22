# Mining drills at a low research level

The drill's mechanics and how the simulator models them are on [the drills page](../../../../docs/drills.md).

`drills.game.test.ts` records 18 builds of a big mining drill in the game, unclocked, at a research level the probe
([probe.lua](probe.lua)) sets by script in the harness's copy of the save: mining productivity 1 and 2 researched and 3
at level 8, 28 or 45 (7, 27 or 44 levels, +70% to +440%), or none of them (+0%). With 4 legendary speed modules 3 its bar
moves 0.25 a tick, with 3 0.198, so the drill makes 0.25 to 1.35 items a tick; with 4 legendary productivity modules 3
and no research (+100%), 0.0167 and 0.033. The probe puts both bars at 0 and logs
every tick the bars, whether the drill is disabled, its sink's count and the taker's hand.

| Build | What it checks |
| --- | --- |
| `car-l8`, `car-l28`, `car-l45`, `car-none` | iron ore into a car with 100 ore of room (78 of its 80 slots filtered to copper plates), emptied by a yellow (`l8`) or stack inserter: the drill waits while the full car has no room for what it holds |
| `car-l8-3m` | a bar of 0.198 a tick, which does not divide 1: the bars are doubles summed tick by tick |
| `car-prod4-none` | the drill's own productivity modules, with no research: its productivity is theirs |
| `landfill-l8`, `landfill-l45` | stone into an assembling machine on landfill (50 a craft, 0.83 a tick); a stack inserter takes the landfill |
| `rail-l28`, `rail-l45` | stone into one on rail, which never crafts: the drill fills it to its stop |
| `*-drill-last` | the drill built after the others (the game updates the last built first) |
| `*-moved` | the build at (203, -141), another chunk |
| `*-gated` | the drill disabled by a constant combinator on its circuit condition, several times, while it holds items |

Each build checks three things:

- **The productivity.** The drill's `productivity_bonus` in the game is the force's research bonus and its productivity
  modules' together, and the config takes it x 100, as Sidecar exports it. Sidecar exports a drill into a car only once
  the drill has dropped into it, from its first enabled tick on, so the recording, made from the first tick, has no
  drill: the probe reads the drill.
- **The drill against the game's, every tick.** The simulator's drill is driven by the game's sink: in each tick the sink
  first loses what the game's taker took (its hand's growth) or what a craft took (the machine's count falls), and the
  drill is disabled where the game's was. Its sink's count and both bars equal the game's in every tick. Into a machine
  that includes the drill's stop, the larger of the stack and the automated insertion limit + 64
  (`src/rules-of-the-game.ts` rule 3): it is 114 for rail and 214 for landfill, the game's machine never goes above it,
  and it reaches it in the rail builds and in `landfill-l45` and its drill-last and moved variants.
- **The whole build in the simulator**, every entity simulated, for the builds whose other entities the simulator has as
  the game does (`simulated`: the car emptied by a stack inserter, `landfill-l8`): the sink's count in every tick. A yellow
  inserter taking from a car leaves with what is there where the simulator's waits to fill its hand, and an assembler
  starts its next craft a tick later in the simulator than in the game, so those builds are compared through the drill
  alone.

The game's drill has no mining target in the recording's first tick: game row k is the simulator's k-th tick.

`DRILLS_CAPTURE_DIR` keeps each run's recording and `comparison.json` (the game's rows, the replay, the simulator's run).

```bash
DRILLS_CAPTURE_DIR=.scratch/drills-run \
  npm run test:game -- tests/game/mechanics/drills/drills.game.test.ts -t 'car-l8$'
```

## The bars near a whole item

`remainder.game.test.ts` checks the game's tolerance on the bonus bar near a whole item (`bonusBarTick`,
`src/rules-of-the-game.ts` rule 17). Its probe ([remainder-probe.lua](remainder-probe.lua)) runs a big mining drill
into a legendary steel chest that it empties every tick, so the drill mines in every tick. For each trial it sets the
force's mining productivity bonus and writes the drill's bars so that the next mining tick lands r from a whole number
of mining times, r from 1e-9 to 0.01 on both sides. It then reads the bars and the items the game made of it. The
bonus bar moves 0.075 to 1,000 a tick, with the mining bar making an item in the same tick or not. Bars under 0.001
that do not wrap are written too.

| Build | What it checks |
| --- | --- |
| `remainder-iron` | iron ore (mining time 1), the mining bar 0.25 a tick |
| `remainder-iron-drill-last`, `remainder-iron-moved` | the drill built last; the build at (203, -141) |
| `remainder-iron-step` | one speed module: 0.094 a tick |
| `remainder-scrap`, `remainder-tungsten` | mining times of 0.5 and 5: the tolerances are in the game's units, and from 2 mining times the bar keeps the fraction of a mining time |

In every trial the simulator's bonus bar gives the game's bar and items, and the mining bar keeps its remainder however
small. No trial lands on a tolerance itself (0.001 above, 0.0001 below), where the game's sum and the simulator's can
differ in the last bit.

```bash
DRILLS_CAPTURE_DIR=.scratch/remainder-run \
  npm run test:game -- tests/game/mechanics/drills/remainder.game.test.ts
```

## A drill into a chest

`chest.game.test.ts` records a big mining drill with 4 legendary speed modules 3 (its bar moves 0.25 a tick) dropping
into a legendary steel chest (120 slots, 6,000 iron ore of room), at mining productivity 3 levels 8 to 1,000,000 set by
script as above: 0.425, 1.35, 10.2, 100, 200, 1,000, 2,500 and 25,000 ore a tick. Its probe
([chest-probe.lua](chest-probe.lua)) puts both bars at 0 and logs every tick the chest's count, both bars, whether the
drill is disabled, and what it takes.

| Build | What it checks |
| --- | --- |
| `fill-l<level>` | the chest empty, the drill always enabled, until the chest is full and 60 ticks on |
| `gated-l<level>` | the chest full; every 30 ticks the probe takes all of it, 1,000, 100 or 10 ore, and a constant combinator on the drill's circuit condition enables it for 1, 2 or 3 ticks from the period's fifth tick: 24 windows of every take, length and hold |
| `fill-l40000-drill-last`, `gated-l100000-drill-last` | the drill built after the chest |
| `gated-l100000-moved` | the build at (203, -141), another chunk |

The simulator's drill (`DrillChestWorkingMode`, the steel chest as a buffer chest of iron ore with its slots) is driven
by the probe: in tick k the chest has lost what the probe took in row k - 1 (it takes after the tick's entities), and
the drill is enabled where the game's was not disabled in row k - 1. The chest's count and both bars equal the game's in
every tick. Also asserted:

- **No cap on a tick's drop.** From 6,000 ore a tick (`fill-l1000000`) the drill fills the chest in its second tick.
- **The fill time.** From 10 ore a tick up the chest is full at tick ceil(6,000 / rate) + 1: what a tick mines drops in
  the next enabled tick, so filling from an empty hold takes one tick more than the mining ticks.
- **A window whose hold covers the room** fills the chest in its first tick (`gated`, from 2,500 ore a tick).

```bash
DRILLS_CAPTURE_DIR=.scratch/chest-run \
  npm run test:game -- tests/game/mechanics/drills/chest.game.test.ts -t 'gated-l7999$'
```
