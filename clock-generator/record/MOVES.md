# Moves

A pull request that changes a record file (a file in this folder) adds an entry at the top of this file, newest first: its title and the pull
request number, then one line for each moved job (the job key as in the file name) with what moved and why. A job whose clock got worse (the verdict
lower, a lost hold, a lower rate, more wake-ups a minute; CONTRIBUTING.md, "The record of the blast jobs") must be named here, and says why it is accepted. Many jobs that move for one reason may share
a line that names the reason and lists the jobs. A pull request that moves no record needs no entry.

CI checks this file: the "Record check" fails when a selected clock got worse than in the base and its job key is not in the lines the pull
request adds to this file.

## Belt pickup slack inside the enable windows (#595)
- config-LOGISTIC_SCIENCE_240: selected swings-2 -> planned-belt-slack, wake-ups 41.379 -> 20.571 a minute, period 88 -> 176; its two pickup windows a window cycle (52-71, 76-95) keep the belt pickup slack inside them, where the 4 ticks added after them joined them into one (61.714) (game: 100% per row on the 22-copy scaffold, 20.45 a copy a minute)
- config-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY: selected shifted-swings -> planned-belt-slack, wake-ups 286.635 -> 245.687 a minute, period 352; the slack inside the windows (game: 256 in every period on its scaffold)
- config-ELECTRIC_FURNACE_20: selected fractional -> planned-belt-slack, wake-ups 112.5 -> 100 a minute, period 864; the slack inside the windows (game: 100% on its scaffold)
- config-LOGISTIC_SCIENCE_240_DIRECT_INSERT: selected fractional -> planned-belt-slack, wake-ups 250 -> 237.582 a minute, period 96 -> 576; the slack inside the windows (game: 100% on its scaffold)
- config-AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER: planned-belt-slack stays selected, wake-ups 50.07 -> 25.035 a minute; the slack inside the windows (game: 100% on its scaffold)
- config-UTILITY_SCIENCE_120: planned-belt-slack stays selected, wake-ups 107.303 -> 64.382 a minute; the slack inside the windows (no scaffold)
- config-LDS_240, config-UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT, variants-LOGISTIC_SCIENCE_240_DIRECT_INSERT_TWO_OUTPUT_SWINGS: planned-belt-slack, not selected, wake-ups 2,292.615 -> 2,217.55, 118.209 -> 64.478 and 325.226 -> 250.174 a minute; the selection is unchanged
- The 65 jobs with a clock whose inserters pick up from a belt: results_sha256 only; the belt note's new words (belt slack), no clock changes

## A window a swing for the takers the surplus guard gates (#638)
- config-PROCESSING_UNIT_80_CIRCUIT_EXPORT: selected planned-belt-slack -> planned-belt-slack-per-hand, wake-ups 5,628.75 -> 3,502.5 a minute, stable, period 24; the iron and cable takers into the circuit machines open for a tick at each of their three swings
- variants-PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP: selected planned-belt-slack -> planned-belt-slack-per-hand, wake-ups 5,280 -> 3,444.375 a minute, stable; the same windows on backed-up belts
- config-ACCUMULATOR_640, config-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK, config-LDS_240, config-MILITARY_SCIENCE_120, config-UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN, variants-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK_BACKED_UP: a new per-hand alternative after a grouped hands clock with guarded takers, stable, not selected; the selection is unchanged

## Batched swings' windows by arithmetic and the stock walk (#661)
- config-LOGISTIC_SCIENCE_240: selected planned-belt-slack -> swings-2, wake-ups 61.714 -> 41.379 a minute, period 176 -> 88; the windows by arithmetic open the belt pickup for its hands only (game: 100% on the 22-copy scaffold)
- config-ELECTROMAGNETIC_SCIENCE_330: selected fractional -> swings-2, wake-ups 158.748 -> 138.265 a minute, period 704; swings-2 by arithmetic 163.869 -> 138.265 (game: 100% on both scaffolds)
- front-front-exit-turbo-mirrored-moving-config-different-items, front-front-exit-turbo-unmirrored-moving-config-different-items, pickup-electromagnetic-turbo-straight-belt-moving, pickup-electromagnetic-turbo-underground-entrance-moving, pickup-electromagnetic-turbo-underground-exit-moving: selected planned-belt-slack -> swings-1, wake-ups 197.915 (218.389 on the straight belt) -> 112.821 a minute, period 1056 -> 352; swings-1 by arithmetic (game: 100% with recovery; the six cold starts recorded again on the new clock)
- pickup-same-item-turbo-straight-belt-moving, pickup-same-item-turbo-underground-entrance-moving, pickup-same-item-turbo-underground-exit-moving: selected derived -> planned-belt-slack, wake-ups 45.283 -> 22.642 a minute, period 160; planned-belt-slack by arithmetic (game: 100% with recovery)
- blocked-blocked-output-turbo-stack-1: selected even-hands -> planned-belt-slack, tied at 18.848 wake-ups a minute, period 192; planned-belt-slack by arithmetic 37.696 -> 18.848 (game: 100% with recovery)
- config-AUTOMATION_SCIENCE_240: swings-1, not selected, stays no recovery, wake-ups 277.071 -> 123.448 a minute; the selection is unchanged
- config-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK: unchanged; its copies take 160 ore a second of 240 from each ore belt, and the windows by arithmetic (6 ticks) left the third copy of the 3-copy build at 3,600 of 4,800 in the game, so the planning run's windows stay (#660)

## Fractional swings back off to a count the machine takes (#655)
- config-ELECTROMAGNETIC_SCIENCE_330: selected swings-2 -> fractional, wake-ups 163.869 -> 158.748 a minute, period 704; fractional swings were refused at 11/2 (the machine's own swings), 5, 4 and 3 output swings a cycle and are now planned at 2 (game: 100% on both scaffolds)
- config-LITHIUM_PLATE_80_SILO_CHEST, config-UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT: a new fractional alternative, stable (620 and 118.209 wake-ups a minute), not selected; it was refused before
- front-front-exit-turbo-mirrored-backed-different-items, front-front-exit-turbo-mirrored-moving-config-different-items, front-front-exit-turbo-unmirrored-backed-different-items, front-front-exit-turbo-unmirrored-moving-config-different-items, pickup-electromagnetic-turbo-straight-belt-backed, pickup-electromagnetic-turbo-straight-belt-moving, pickup-electromagnetic-turbo-underground-entrance-backed, pickup-electromagnetic-turbo-underground-entrance-moving, pickup-electromagnetic-turbo-underground-exit-backed, pickup-electromagnetic-turbo-underground-exit-moving: a new fractional alternative, stable (573.542 to 625.641 wake-ups a minute), not selected; it was refused before
- config-AUTOMATION_SCIENCE_240, blocked-blocked-output-turbo-stack-3: a new fractional alternative, no recovery and unstable, not selected; it was refused before

## The surplus guard per taker (#654)
- config-PROCESSING_UNIT_80_CIRCUIT_EXPORT: planned-belt-slack stays stable, wake-ups 7,393.125 -> 5,628.75 a minute; the iron and cable takers into the circuit machines get windows of their three hands, and the circuits into the processing unit machines stay enabled
- variants-PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP: planned-belt-slack stays stable, wake-ups 7,331.25 -> 5,280 a minute; the same windows on backed-up belts

## Pinned variants become jobs (#600)
- variants-AGRICULTURAL_SCIENCE_250_BACKED_UP, variants-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK_BACKED_UP, variants-PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP, variants-STEEL_PLATE_26_WAGON_CHEST_IRON_ORE_OUT_OF_PERIOD: new jobs, the builds four game recordings are tied to (a sample with its belts backed up, or with iron ore left out of the period)
- variants-ADVANCED_CIRCUIT_240_BACKED_UP, variants-AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING, variants-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY_BACKED_UP, variants-LOGISTIC_SCIENCE_240_DIRECT_INSERT_TWO_OUTPUT_SWINGS, variants-PRODUCTION_SCIENCE_120_TWO_BELTS_SHARED_PICKUP, variants-ROCKET_FUEL_60_JELLY_HANDS_15_BACKED_UP, variants-STEEL_HUB_26_CONTAINER_OUTPUT: new jobs, the builds generation tests pinned and the record now holds
- No existing job moved.

## Entry format

```
## <title> (#<number>)
- config-NAME: selected even-hands -> cut-hands, wake-ups 889 -> 640 a minute; the new hands cost fewer wake-ups
- pickup-A, pickup-B: period 972 -> 1944; the window now waits for the second hand
```

## The first record (#600)

- All 75 jobs: written for the first time from the blast of master `da6818f0`; no job moved.
