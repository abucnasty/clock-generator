# Logistic science

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `logistic-240` | abucnasty (Sidecar export and blueprint) | Sidecar 0.15.0 export of one assembler (legendary, crafting speed 68.890625) with two stack inserters: one takes the transport belts and the inserters from a turbo belt, one puts the packs onto a second belt; 11 copies make 240 a second. The config states that the feed belt runs east (`flow_direction` 4) and that the packs belt carries packs on both lanes: in the scaffold, read by position, each row's packs line moves the packs of five copies onto each lane and splits those of the eleventh between the two. `logistic-240-owner-test-build.blueprint` is abucnasty's test blueprint: 22 assemblers in two rows of 11 with a hand-made clock; `logistic-240.scaffold` is the same build without the clock (the 4 deciders and the lock constant combinator, the 44 stack inserters' circuit conditions) | #590 | Scaffold: yes (2026-11-04), the whole build and not one copy: 22 copies, 11 in each row, made 240 a second a row and 480 in all by the config's 11 copies a row. The bottom row is a mirror of the top: its inserters stand north of the belt, so their near lane is lane 1 where the config has lane 2, and the inserter item is on lane 1 where the config has it on lane 2 (accepted as the same pickup). In the game (turbo belts, cache off): the recommended clock, batched swings with 4 output swings per cycle, 176 ticks, moves 704 packs in every one of 21 window cycles in each row (64 a machine, 240 a second) and 1,408 over the build (480 a second). The Sidecar's belt reading was fixed for it: a lane's item is read on the belts the inserters pick up from before the first belt put down, as the feed belt starts with transport belts on both lanes. The key LOGISTIC_SCIENCE once named the old three-inserter config |
| `logistic-240-direct-insert` | none recorded | none recorded | #442 | Scaffold: yes (2026-10-21). Recommended clock exact, with "Backed-up belts" off and on: 64 in each of 374 window cycles of 96 ticks (fractional swings, 2 output swings per cycle; 40 a second a copy, 240 over 6 copies), 200.0 wakeups a minute in the game against 175.0 in the simulator (2026-10-24). The config is the build on turbo belts, each science assembler with an input belt of its own; it replaced a yellow-belt config whose transport belt machine could not be built. The transport belt foundry's productivity of 50 is what the game records. With the ingredients cut twice and the outputs blocked once, the clocks selected on 2026-10-21 (288 ticks) made 192 again from the first window cycle after each. Loss protocol (2026-11-05, #442, one copy on the scaffold, turbo belts): the clock generated then for moving belts (fractional, 96 ticks; the same clock is made with backpressure at its belt pickups since 2026-11-11, when the config's empty input lanes got their dead ends too) made the 40 a second of the copy over the baseline, got back after the inserters were cut from the belts and after the two output loaders were removed, as the simulator's losses (supply of inserters, output not taken away) do; the scaffold's inserter belts end closed, so they stand full in the game. Since 2026-11-10 the config states the full build's lanes: 12 science assemblers in two rows of six, one copy a column of an upper and a lower assembler; the copies are mirrored pairs, their pickups 20 then 4 tiles apart along each inserter belt, stated as an even spacing of 12 tiles; each row's inserter belt runs east with the inserters on the lane far from the pickups (lane 1 of belt 3, lane 2 of belt 4) and ends with nothing after its last tile, a dead end. The selected clock is the same as before (Coordinated Sources, 576 ticks, 100.0 wakeups a minute in the simulator); in the game on the scaffold (2026-11-10, Factorio 2.1.24, both ways) it moves 384 packs in every one of 6 window cycles checked (40 a second, the copy's target), the machines at the config's speeds. Note: in `test:game`, both ways. |

## The output belt of `logistic-240`

The config states the output belt of one row of the scaffold (`output_belt`), for its 11 copies. The other row is the
same row turned over: every belt entity, its direction, the underground pairs and the splitter's priorities are the
reflection of the first row's (checked entity by entity on the scaffold), so its lines are this statement with left and right
swapped. The sample does not state them again: a config has one set of copies, and a row of its own would need copies 12
to 22. The two rows do not meet: each has its own loader.
- Copies 1 to 3 drop on the right lane of the first stretch, which runs east into an underground entrance. Copies 5 and 4
  drop on the left lane of a stretch that runs west, turns north and side-loads onto that entrance from its right side.
  The first stretch goes on under ground and side-loads from the north, onto its left lane, a straight belt at the start of
  stretch 3, the main line.
- Copies 6 to 8 (stretch 4) and copies 9 and 10 (stretch 5) drop on the right lane of their stretch and side-load onto an
  underground exit of the main line, on its right lane.
- Copy 11 drops on the right lane of a stretch that ends in the right input of a splitter. The splitter has this one
  input: its left input has no belt, because an underground pair of the main line passes under it. Its input and output
  priority are both right. Its right output side-loads onto the next underground exit of the main line; its left output
  turns north, east and south and side-loads onto the next underground entrance, on its left lane. The main line ends in
  the loader after 6 more tiles.
- The lanes and tiles were read from the position and direction of each entity of the scaffold. Every hand drops from the
  side of its belt, on the far lane.

In the game (Factorio 2.1.24, turbo belts, warm-up 3,600 ticks, 10,912 ticks recorded) the selected
clock (Takt Batches, 4 output swings, 176 ticks) makes 64 packs a copy in each of 61 whole window cycles on each of the 22
copies (1,408 a window cycle over the build). The clock with 1 output swing (88 ticks) was stable in the simulator before
the output belt was stated; it is now unstable, and in the game it moves 512 of the 704 packs of a window cycle a row and
finds no steady state in 36,000 ticks.
