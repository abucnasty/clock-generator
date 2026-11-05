# Electric furnaces

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `electric-furnace-20` | abucnasty (blueprint) | the furnace supply of a production science design, rated to fit 120/s of production science (240/s with more copies); the scaffold is the owner's build, given 2026-11-05: an electric furnace assembler (legendary, 57.8125) taking steel from a foundry (185), stone bricks from three furnaces (80.0375) that each have a drill of their own dropping stone into them (speed bonuses 15.3075, 12.5 and 13.975; mining productivity 79990 as the harness reads it), and advanced circuits from two infinity chests on one backed-up turbo belt; the furnaces leave on a moving belt into a void chest. 20 a second over 2 copies, 10 each (one copy makes up to 11.56). There is no stone belt: the config's third belt is dropped | none recorded | Scaffold: yes (2026-11-05). In the game (turbo belts, cache off): the selected clock, fractional swings with 1 output swing per cycle, 864 ticks, moves 144 electric furnaces in every one of 5 periods checked (10 a second, 100%), steady state after 7,056 ticks, no difference between the game and the simulator, 141.7 wake-ups a minute against the simulator's 112.5 (within the tolerance) |

ELECTRIC_FURNACE_20 is the furnace supply of a production science design: 3 stone-brick furnaces fed by drills, a steel
foundry and advanced circuits on a belt, 20 electric furnaces a second over 2 copies. Its rates fit 120/s of
production science (240/s with more copies). It is a unit-test sample only; no scaffold exists yet.
