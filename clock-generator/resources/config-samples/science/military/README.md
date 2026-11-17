# Military science

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `military-240` | abucnasty (blueprint) | abucnasty's build, given 2026-11-09. Five copies, 9 tiles apart, make 240 a second, 48 each. Each copy is a mirrored pair around one foundry (legendary, 129.0, casting iron). Above the foundry and below it, a military science assembler (63.0078) takes grenades from a grenade assembler (52.5763). The foundry feeds both grenade assemblers. Each grenade assembler has one coal inserter. The speeds are the game's, read from the build in the harness (2026-11-10). Computed from the modules and beacons of the blueprint they were 63.0132 and 52.5791, 0.009% and 0.005% over the game's. Each half has a belt of stone walls and piercing rounds (the walls on the lane nearest the pickups), a coal belt and a packs belt. The walls and rounds lanes stop after the last copy's pickup, and the copies share them. In the build, each half's coal comes on two belts that three priority splitters join. The config gives each copy coal lanes of its own that stop at its pickup. The splitters are not modelled. The packs lanes go on to a loader, an infinite end. The scaffold is the whole build as abucnasty sent it, with its coal coming through the splitters as built | none recorded | Scaffold: yes (2026-11-10), the whole build of five copies and not one copy. `military-240.scaffold` is abucnasty's blueprint unchanged (395 entities), with its infinity chests, infinity pipe, loaders and void chests. The coal splitters are part of it and are not modelled. In the game (Factorio 2.1.24, turbo belts, cache off), recorded outside the test: the recommended clock is Coordinated Sources, 2 output swings each output cycle, 80 ticks. The build gets to steady state after 7,200 ticks. Then each copy moves 64 packs in each of 44 window cycles. That is 100% of 48 a second on each of the 5 copies, and 240 a second in all. Each grenade assembler's coal inserter takes 60 coal a second. The `scaffold-recordings` case fails on the test's rule for rows of output inserters (see the samples README). The config states the output belt of the scaffold, see "The output belt" below. Before this build, the scaffold was one copy of the earlier build (`military-120.scaffold`, MILITARY_SCIENCE_120, recorded 2026-11-05) |

## The output belt

The config states the output belt of the scaffold (`output_belt`): one line for each half, so two lines, each with its own loader at the end.
- Each copy has two output inserters, one for the military science assembler above its foundry and one for the assembler below it. The
  one above is output inserter 1 of its copy, the one below output inserter 2 (numbers 1, 3, 5, 7, 9 and 2, 4, 6, 8, 10 over the five copies).
- An output inserter drops onto a belt of its own: a drop tile, a curve and a second curve, 3 steps to the line. The upper half's drop
  tile runs south and the lower half's runs north. The inserter stands on the east of its drop tile, so its pack lands on the far lane:
  the right lane of the upper belt (it runs south) and the left lane of the lower belt (it runs north).
- The belt side-loads onto an underground entrance of its half's line, from the north (upper half) or the south (lower half), and the
  line runs under the next copy to the next entrance, 9 tiles on. After the fifth copy the line runs 10 tiles to the loader.
- The entrance passes only the lane of the belt that comes first along the line (the west lane); the lane on the east stops at the
  hood. Both belts carry their packs on the west lane, so every pack passes. The packs go onto the lane of the line that is nearest the
  belt: the left lane of the upper line and the right lane of the lower line. They were walked on the scaffold with the belt tracer
  (all ten drops and their paths to the loader) and agree with the `drop_capture` of the recording, which gives 3 tiles for each of
  the ten output inserters.

The simulator moves the packs on these lines, so an output inserter that cannot put its pack down waits, as in the game. With the lines
stated, the selected clock (Coordinated Sources, 80 ticks) stays stable. In the game (Factorio 2.1.24, warm-up 3,600 ticks, 10,800
ticks recorded) every copy makes its 64 packs in each of 134 window cycles. Time-Study Windows (480 ticks) is now unstable in the
simulator, at copy 5. In the game its copies 1 to 4 make their 384 packs in each of 22 window cycles and copy 5 makes 352 or 368.
