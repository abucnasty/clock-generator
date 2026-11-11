# Moves

A pull request that changes a record file (a file in this folder) adds an entry at the top of this file, newest first: its title and the pull
request number, then one line for each moved job (the job key as in the file name) with what moved and why. A job whose clock got worse (the verdict
lower, a lost hold, a lower rate, more wake-ups a minute; CONTRIBUTING.md, "The record of the blast jobs") must be named here, and says why it is accepted. Many jobs that move for one reason may share
a line that names the reason and lists the jobs. A pull request that moves no record needs no entry.

CI checks this file: the "Record check" fails when a selected clock got worse than in the base and its job key is not in the lines the pull
request adds to this file.

## The agricultural science sample states its lanes as its build of five copies has them (feature/shared-lane-model-row-11b)
- config-AGRICULTURAL_SCIENCE_250, variants-AGRICULTURAL_SCIENCE_250_BACKED_UP: the config states abucnasty's build of five copies (10 tiles apart, both input belts flowing east past them, their four lanes dead ends, the bioflux shared by the copies) and the science biochamber's pickup with the nutrients on its near lane, as copies 2 and 4 of the build have it. Every clock moved. Both jobs select Time-Study Windows (clock 8de16d68, 5,268.15 wake-ups a minute) where they selected Coordinated Sources (3f3fc285, 2,603.94); the record held Phase-Shifted Batch and Takt Batches, older than that. More wake-ups, accepted: the clock with fewer leaves copies 2 and 4 short in the game, and 8de16d68 held each of the five copies at 400 in 200 window cycles of 200 in the game

## The accumulator sample is abucnasty's nine-copy build, named for its 320 a second (feature/shared-lane-model-row-16)
- config-ACCUMULATOR_640 -> config-ACCUMULATOR_320: the target is the nine-copy build's, 320 a second over 9 copies (35.56 a copy, as before), so the rate of every clock halves with it; the selected clock (coordinated_sources, clock b43dfd7b1bc7), its windows and wake-ups are the same

## Release 0.28.1 (fix/ios-startup-hang)
Every clock blueprint carries the engine's version, so the `text_sha256` of each clock moves with the bump from 0.28.0 to 0.28.1. No selection, rate, window or wakeup moved.
- all 86 jobs: `text_sha256` of every clock, for the version in the blueprint text

## Record and harness name the window cycle (#710)
The record format is clock-record-2: the `period` key of each clock is now `window_cycle_ticks`. No selection, rate, window, wakeup or `clock_sha256` moved.
- all 86 jobs: the format and the key

## Release 0.28.0 (release/0-28-0)
Every clock blueprint carries the engine's version, so the `text_sha256` of each clock moves with the bump from 0.27.2 to 0.28.0. No selection, rate, window or wakeup moved.
- all 86 jobs: `text_sha256` of every clock, for the version in the blueprint text

## Clock ids follow the strategy catalog (refactor/strategy-catalog)
A clock's id is derived from the strategy and the settings of its clock; the slot that made the clock is its `maker`, the id it had before. The lines below name the old ids and stay as history. Old id -> new id:
`even-hands` -> `time_division_windows`; `fractional` -> `euclidean_swings`; `derived` -> `time_study_windows`; `uneven-output` -> `moved_output_swing`; `shifted-swings` -> `phase_shifted_batch`; `full-hand` -> `pitch_pickups`; `results-in-turn` -> `exhaust`; `per-branch` -> `coordinated_sources`; `primitive-grouped` -> `round_robin_polling_shorter_window_cycle`;
`planned-belt-slack` -> `takt_batches`, `takt_batches_observed` or `round_robin_polling`, by the strategy and tuning method the build's clock has; `swings-N` -> the same, with `_swings_N`. A suffix says what sets a clock apart: `_shared` (was `-shared`), `_per_hand` (was `-per-hand`), `_subtick` (was `-subtick`).
Strategy ids: `per-branch` is no strategy (it is the router `coordinated_sources`), `signal-offset` -> `phase_shifted_batch`, `time-division-slots` -> `time_division_windows`; the other families keep their words in snake case. No clock moved: `clock_sha256` leaves out the ids.

## Coordinated Sources (#699)
A new router, Coordinated Sources (id `coordinated_sources`; its maker, the id it had before they were derived, is `per-branch`), made after every other clock: the inserters of each source (a machine, belt or chest that inserters take from) use the enable windows of one clock the other makers built, on the recommended clock's window cycle, chosen source by source from the output upstream by simulated wakeups. Listed only where it is stable and another clock; on 16 jobs it is selected, with fewer wakeups, and on the other 70 it is not listed. Game figures: the Coordinated Sources clock on its sample's scaffold, made / expected in every window cycle recorded, and wakeups a minute in the game (simulator, seeded); every run holds the setpoint (minute protocol, turbo). The figure in brackets after a game figure is the simulator's count for that same recording, seeded from the game's first sample (cold where the seed is incomplete or the line says cold); it is not a game figure. Ids are the derived ones; the map from the old ids is in the entry above.
- config-ACCUMULATOR_640: selected time_division_windows -> coordinated_sources, wakeups 889.072 -> 696.44 a minute, window cycle 972 (game: 576 / 576 in 3 of 3 window cycles, 696.5 (696.3))
- config-PROCESSING_UNIT_80_CIRCUIT_EXPORT: selected round_robin_polling_per_hand -> coordinated_sources, 3,502.5 -> 3,050.625, window cycle 24 (game: 32 / 32 in 149 of 149 window cycles, 3,034.8 (3,047.3 cold); the export belt 2 meets its rate); variants-PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP: round_robin_polling_per_hand -> coordinated_sources, 3,444.375 -> 3,030 (game: 32 / 32 in 149 of 149, 3,098.9 (3,330.2))
- config-ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED: selected round_robin_polling_shorter_window_cycle -> coordinated_sources, 2,171.25 -> 2,086.875, window cycle 40 (game: its game test on the two-cell scaffold, 5,760 / 5,760 in the baseline minute, back after each of the seven disturbances, both cold starts at the setpoint)
- config-ADVANCED_CIRCUIT_240: selected takt_batches_observed -> coordinated_sources, 429.545 -> 334.091, window cycle 528 (game: 704 / 704 in 6 of 6, 416.0 (443.2)); variants-ADVANCED_CIRCUIT_240_BACKED_UP: takt_batches_observed_swings_1 -> coordinated_sources, 954.545 -> 872.727, window cycle 264 (game: 352 / 352 in 13 of 13, 1,102.9 (1,187.4)); worse from the game test rig's start (the old takt_batches_observed_swings_1 clock wakes 993.8 a minute in the game, the new one 1,102.9), better from the cold start, the start the count is judged from (954.545 -> 872.727)
- config-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY, variants-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY_BACKED_UP: selected takt_batches_observed -> coordinated_sources, 163.791 -> 81.896, window cycle 352 (game: 256 / 256 in 10 of 10, 81.8 (81.8), both belts)
- config-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK: selected takt_batches_observed_swings_6 -> coordinated_sources, 450 -> 150, window cycle 72 (game: 96 / 96 in 49 of 49, 250.1 (250.0)); variants-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK_BACKED_UP: round_robin_polling_swings_6 -> coordinated_sources, 450 -> 300 (game: 96 / 96 in 49 of 49, 450.1 (613.3))
- config-IRON_PLATE_80_CAR_CHEST: selected takt_batches_observed_swings_2 -> coordinated_sources, 158.75 -> 137.5, window cycle 144 (game: 192 / 192 in 24 of 24, 144.0 (129.2 cold))
- config-LITHIUM_PLATE_80_SILO_CHEST: selected time_division_windows -> coordinated_sources, 13.34 -> 3.335, window cycle 2,160 (game: 2,880 / 2,880 in 1 of 1, 136.7 (70.0); the furnace output inserters the warm-up wakes, as the scaffold test's note says); worse from the game test rig's start (the old time_division_windows clock wakes 46.7 a minute in the game over one window cycle, the new one 136.7), better from the cold start, the start the count is judged from (13.34 -> 3.335)
- config-LOGISTIC_SCIENCE_240_DIRECT_INSERT: selected takt_batches_observed -> coordinated_sources, 200.069 -> 100.035, window cycle 576 (game: 384 / 384 in 6 of 6, 100.0 (100.0))
- config-PRODUCTIVITY_MODULE_80_CHEST_CHAIN: selected round_robin_polling -> coordinated_sources, 666.25 -> 620, window cycle 72 (game: 16 / 16 in 49 of 49, 623.2 (630.6))
- config-UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT: selected takt_batches_observed -> coordinated_sources, 42.985 -> 32.239, window cycle 336 (game: 96 / 96 in 10 of 10, 32.2 (32.1))
- variants-AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING: selected pitch_pickups -> coordinated_sources, 50.174 -> 0, window cycle 72 (game: 32 / 32 in 49 of 49, 0.0 (0.0))

## Loop windows report #516's two-hop bound (#516)
A clock with windows for a loop of machines now carries #516's two-hop bound in its assessment (`loop_stock_bound`), a report that keeps, drops and ranks nothing: only the results digest of those clocks moves, no clock, verdict or wakeup count.
- config-AGRICULTURAL_SCIENCE_250 (planned-belt-slack, shifted-swings, swings-1), variants-AGRICULTURAL_SCIENCE_250_BACKED_UP (planned-belt-slack), config-IRON_BACTERIA_380_CULTIVATION (planned-belt-slack-subtick, swings-4-subtick, swings-6-subtick): results digest only (the assessment)

## Enable windows shaped against ghost wakeups (#641)
Each window of the primary batched-swings clock whose closing edge left its inserter in sleep on a machine's list closes before the inserter went to sleep or took the hand it held, or is dropped where that leaves it nothing; kept where the clock holds, wakes fewer and gets back from every loss the primary gets back from. Game figures: wakeups (ghost wakeups) a window cycle of one copy on its one-copy scaffold, before -> after, output 100% in every window cycle both sides.
- config-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY, variants-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY_BACKED_UP: planned-belt-slack stays selected, wake-ups 245.687 -> 163.791 a minute (game: 24 (16) -> 16 (8))
- config-ELECTRIC_FURNACE_20: planned-belt-slack stays selected, wake-ups 100 -> 62.5 a minute (game: 33 (12) -> 15 (6))
- config-ELECTROMAGNETIC_SCIENCE_330: swings-2 stays selected, wake-ups 138.265 -> 92.176 a minute (game: 27 (9) -> 18 (0))
- config-LOGISTIC_SCIENCE_240_DIRECT_INSERT: planned-belt-slack stays selected, wake-ups 237.582 -> 200.069 a minute (game: 38 (6) -> 32 (0))
- config-UTILITY_SCIENCE_120: planned-belt-slack stays selected, wake-ups 64.382 -> 42.921 a minute (game: 12 (4) -> 8 (0))
- config-AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER: planned-belt-slack stays selected, wake-ups 25.035 -> 0 a minute (game: 1 (1) -> 0)
- config-ADVANCED_CIRCUIT_240: planned-belt-slack stays selected, wake-ups 443.182 -> 429.545 a minute (game: 75 (17) -> 75 (17), no change in the game)
- config-PRODUCTION_SCIENCE_120_TWO_BELTS, variants-PRODUCTION_SCIENCE_120_TWO_BELTS_SHARED_PICKUP: fractional stays selected, wake-ups 85.714 -> 53.571 a minute (game: 8 (5) -> 5 (3))
- config-IRON_PLATE_80_CAR_CHEST: selected derived -> swings-2, wakeups 200 -> 158.75 a minute, window cycle 288 -> 144 (game: 48 (0) a window cycle of 288 -> 7 (0.33) a window cycle of 144)
- config-UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT: selected derived -> planned-belt-slack, wake-ups 53.731 -> 42.985 a minute (game: 5 (2) -> 4 (0))
- config-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK: selected swings-2 -> swings-6, wakeups 526.875 -> 450 a minute, window cycle 72; swings-6 shaped 585 -> 450. Worse from the game test rig's start (game on the one-copy scaffold: swings-2 wakes 250 a minute, swings-6 450), better from a cold start, the start the count is judged from (the simulator counts 450 for inserter 5 on swings-2 from a cold start, and a game run staged from a cold start wakes it 9 times a window cycle; from the game test rig's start it wakes 3); on the three-copy scaffold both make 288 in every window cycle
- variants-ADVANCED_CIRCUIT_240_BACKED_UP: swings-1 stays selected, wake-ups 1,036.364 -> 954.545 a minute; variants-ROCKET_FUEL_60_JELLY_HANDS_15_BACKED_UP: fractional stays selected, 779.062 -> 769.219
- blocked-blocked-output-turbo-stack-1, blocked-blocked-output-turbo-stack-2, blocked-blocked-output-turbo-stack-4: planned-belt-slack stays selected, wakeups 18.848 -> 0 a minute; the derived clock is no longer made (a clock made without a search is stable)
- containers-container-wagon-filtered, containers-container-wagon-legendary, containers-container-wagon-normal: planned-belt-slack stays selected, wake-ups 18.75 -> 0 a minute
- front-front-entrance-turbo-mirrored-backed-different-items, overhood-over-hood-turbo-mirrored-backed-different-items: planned-belt-slack, 3.217 -> 0; front-front-entrance-turbo-mirrored-moving-different-items: planned-belt-slack, 11.285 -> 0
- front-front-entrance-turbo-unmirrored-backed-different-items, overhood-over-hood-turbo-unmirrored-backed-different-items: selected planned-belt-slack -> fractional, 3.754 -> 0
- front-front-entrance-turbo-unmirrored-moving-different-items, overhood-over-hood-turbo-unmirrored-moving-different-items: selected derived -> planned-belt-slack, tied at 0 (planned-belt-slack no recovery -> stable); overhood-over-hood-turbo-mirrored-moving-different-items: selected derived -> planned-belt-slack, 18 -> 0
- Alternatives only, the selection unchanged: config-AUTOMATION_SCIENCE_240 and variants-AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING fractional no recovery -> stable, 300.16 -> 0 (its job checks keep the old windows inline as a clock that breaks on a loss); config-LITHIUM_PLATE_80_SILO_CHEST planned-belt-slack and swings-1 to swings-7 (swings-5 no recovery -> stable); config-AGRICULTURAL_SCIENCE_250 swings-1, config-LDS_240 planned-belt-slack, config-LOGISTIC_SCIENCE_240 swings-3, config-ROCKET_FUEL_60 fractional, and swings-1 or fractional of the front-exit and electromagnetic pickup fixtures: fewer wake-ups a minute

## Strategy marks for pickups counted from entry and a harmonic window cycle (#683)
- 22 jobs, 44 clocks: results_sha256 only. A clock made with its belt pickups counted from their entry (`pickups_from_entry`) or whose inserters had a hand count rounded up by rule F (`grouped_hands.harmonic_window_cycle`) carries a mark, and the results digest hashes it; no clock hash, selection, verdict, rate or wakeup count moves
- config-ACCUMULATOR_640, config-ADVANCED_CIRCUIT_240, config-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY, config-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK, config-LDS_240, config-LITHIUM_PLATE_80_SILO_CHEST, config-LOGISTIC_SCIENCE_240_DIRECT_INSERT, config-MILITARY_SCIENCE_120, config-PROCESSING_UNIT_80_CIRCUIT_EXPORT, config-PRODUCTIVITY_MODULE_80_CHEST_CHAIN, config-UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN
- front-front-exit-turbo-mirrored-backed-different-items, front-front-exit-turbo-unmirrored-backed-different-items, pickup-electromagnetic-turbo-straight-belt-backed, pickup-electromagnetic-turbo-straight-belt-moving, pickup-electromagnetic-turbo-underground-entrance-backed, pickup-electromagnetic-turbo-underground-exit-backed
- variants-ADVANCED_CIRCUIT_240_BACKED_UP, variants-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY_BACKED_UP, variants-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK_BACKED_UP, variants-LOGISTIC_SCIENCE_240_DIRECT_INSERT_TWO_OUTPUT_SWINGS, variants-PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP

## Strategy ids and signals a minute on each clock (#681)
- All 86 jobs: results_sha256 only. The assessment gained signals_per_minute and the results digest hashes the strategy; no clock hash, selection, verdict, rate or wakeup count moves

## Belt belt slack inside the enable windows (#595)
- config-LOGISTIC_SCIENCE_240: selected swings-2 -> planned-belt-slack, wakeups 41.379 -> 20.571 a minute, window cycle 88 -> 176; its two pickup windows a window cycle (52-71, 76-95) keep the belt slack inside them, where the 4 ticks added after them joined them into one (61.714) (game: 100% per row on the 22-copy scaffold, 20.45 a copy a minute)
- config-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY: selected shifted-swings -> planned-belt-slack, wakeups 286.635 -> 245.687 a minute, window cycle 352; the slack inside the windows (game: 256 in every window cycle on its scaffold)
- config-ELECTRIC_FURNACE_20: selected fractional -> planned-belt-slack, wakeups 112.5 -> 100 a minute, window cycle 864; the slack inside the windows (game: 100% on its scaffold)
- config-LOGISTIC_SCIENCE_240_DIRECT_INSERT: selected fractional -> planned-belt-slack, wakeups 250 -> 237.582 a minute, window cycle 96 -> 576; the slack inside the windows (game: 100% on its scaffold)
- config-AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER: planned-belt-slack stays selected, wake-ups 50.07 -> 25.035 a minute; the slack inside the windows (game: 100% on its scaffold)
- config-UTILITY_SCIENCE_120: planned-belt-slack stays selected, wake-ups 107.303 -> 64.382 a minute; the slack inside the windows (no scaffold)
- config-LDS_240, config-UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT, variants-LOGISTIC_SCIENCE_240_DIRECT_INSERT_TWO_OUTPUT_SWINGS: planned-belt-slack, not selected, wake-ups 2,292.615 -> 2,217.55, 118.209 -> 64.478 and 325.226 -> 250.174 a minute; the selection is unchanged
- The 65 jobs with a clock whose inserters pick up from a belt: results_sha256 only; the belt note's new words (belt slack), no clock changes

## A window a swing for the takers the surplus guard gates (#638)
- config-PROCESSING_UNIT_80_CIRCUIT_EXPORT: selected planned-belt-slack -> planned-belt-slack-per-hand, wakeups 5,628.75 -> 3,502.5 a minute, stable, window cycle 24; the iron and cable takers into the circuit machines open for a tick at each of their three swings
- variants-PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP: selected planned-belt-slack -> planned-belt-slack-per-hand, wake-ups 5,280 -> 3,444.375 a minute, stable; the same windows on backed-up belts
- config-ACCUMULATOR_640, config-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK, config-LDS_240, config-MILITARY_SCIENCE_120, config-UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN, variants-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK_BACKED_UP: a new per-hand clock after a grouped hands clock with guarded takers, stable, not selected; the selection is unchanged

## Batched swings' windows by arithmetic and the stock walk (#661)
- config-LOGISTIC_SCIENCE_240: selected planned-belt-slack -> swings-2, wakeups 61.714 -> 41.379 a minute, window cycle 176 -> 88; the windows by arithmetic open the belt pickup for its hands only (game: 100% on the 22-copy scaffold)
- config-ELECTROMAGNETIC_SCIENCE_330: selected fractional -> swings-2, wakeups 158.748 -> 138.265 a minute, window cycle 704; swings-2 by arithmetic 163.869 -> 138.265 (game: 100% on both scaffolds)
- front-front-exit-turbo-mirrored-moving-config-different-items, front-front-exit-turbo-unmirrored-moving-config-different-items, pickup-electromagnetic-turbo-straight-belt-moving, pickup-electromagnetic-turbo-underground-entrance-moving, pickup-electromagnetic-turbo-underground-exit-moving: selected planned-belt-slack -> swings-1, wakeups 197.915 (218.389 on the straight belt) -> 112.821 a minute, window cycle 1056 -> 352; swings-1 by arithmetic (game: 100% with recovery; the six cold starts recorded again on the new clock)
- pickup-same-item-turbo-straight-belt-moving, pickup-same-item-turbo-underground-entrance-moving, pickup-same-item-turbo-underground-exit-moving: selected derived -> planned-belt-slack, wakeups 45.283 -> 22.642 a minute, window cycle 160; planned-belt-slack by arithmetic (game: 100% with recovery)
- blocked-blocked-output-turbo-stack-1: selected even-hands -> planned-belt-slack, tied at 18.848 wakeups a minute, window cycle 192; planned-belt-slack by arithmetic 37.696 -> 18.848 (game: 100% with recovery)
- config-AUTOMATION_SCIENCE_240: swings-1, not selected, stays no recovery, wake-ups 277.071 -> 123.448 a minute; the selection is unchanged
- config-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK: unchanged; its copies take 160 ore a second of 240 from each ore belt, and the windows by arithmetic (6 ticks) left the third copy of the 3-copy build at 3,600 of 4,800 in the game, so the planning run's windows stay (#660)

## Fractional swings back off to a count the machine takes (#655)
- config-ELECTROMAGNETIC_SCIENCE_330: selected swings-2 -> fractional, wakeups 163.869 -> 158.748 a minute, window cycle 704; fractional swings were refused at 11/2 (the machine's own swings), 5, 4 and 3 output swings a cycle and are now planned at 2 (game: 100% on both scaffolds)
- config-LITHIUM_PLATE_80_SILO_CHEST, config-UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT: a new fractional-swings clock, stable (620 and 118.209 wakeups a minute), not selected; it was refused before
- front-front-exit-turbo-mirrored-backed-different-items, front-front-exit-turbo-mirrored-moving-config-different-items, front-front-exit-turbo-unmirrored-backed-different-items, front-front-exit-turbo-unmirrored-moving-config-different-items, pickup-electromagnetic-turbo-straight-belt-backed, pickup-electromagnetic-turbo-straight-belt-moving, pickup-electromagnetic-turbo-underground-entrance-backed, pickup-electromagnetic-turbo-underground-entrance-moving, pickup-electromagnetic-turbo-underground-exit-backed, pickup-electromagnetic-turbo-underground-exit-moving: a new fractional-swings clock, stable (573.542 to 625.641 wakeups a minute), not selected; it was refused before
- config-AUTOMATION_SCIENCE_240, blocked-blocked-output-turbo-stack-3: a new fractional-swings clock, no recovery and unstable, not selected; it was refused before

## The surplus guard per taker (#654)
- config-PROCESSING_UNIT_80_CIRCUIT_EXPORT: planned-belt-slack stays stable, wake-ups 7,393.125 -> 5,628.75 a minute; the iron and cable takers into the circuit machines get windows of their three hands, and the circuits into the processing unit machines stay enabled
- variants-PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP: planned-belt-slack stays stable, wake-ups 7,331.25 -> 5,280 a minute; the same windows on backed-up belts

## Pinned variants become jobs (#600)
- variants-AGRICULTURAL_SCIENCE_250_BACKED_UP, variants-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK_BACKED_UP, variants-PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP, variants-STEEL_PLATE_26_WAGON_CHEST_IRON_ORE_OUT_OF_PERIOD: new jobs, the builds four game recordings are tied to (a sample with its belts backed up, or with iron ore left out of the window cycle)
- variants-ADVANCED_CIRCUIT_240_BACKED_UP, variants-AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING, variants-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY_BACKED_UP, variants-LOGISTIC_SCIENCE_240_DIRECT_INSERT_TWO_OUTPUT_SWINGS, variants-PRODUCTION_SCIENCE_120_TWO_BELTS_SHARED_PICKUP, variants-ROCKET_FUEL_60_JELLY_HANDS_15_BACKED_UP, variants-STEEL_HUB_26_CONTAINER_OUTPUT: new jobs, the builds generation tests pinned and the record now holds
- No existing job moved.

## Entry format

```
## <title> (#<number>)
- config-NAME: selected even-hands -> cut-hands, wake-ups 889 -> 640 a minute; the new hands cost fewer wake-ups
- pickup-A, pickup-B: window cycle time 972 -> 1944; the window now waits for the second hand
```

## The first record (#600)

- All 75 jobs: written for the first time from the blast of master `da6818f0`; no job moved.
