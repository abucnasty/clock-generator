# Moves

A pull request that changes a record file (a file in this folder) adds an entry at the top of this file, newest first: its title and the pull
request number, then one line for each moved job (the job key as in the file name) with what moved and why. A job whose clock got worse (the verdict
lower, a lost hold, a lower rate, more wake-ups a minute; CONTRIBUTING.md, "The record of the blast jobs") must be named here, and says why it is accepted. Many jobs that move for one reason may share
a line that names the reason and lists the jobs. A pull request that moves no record needs no entry.

CI checks this file: the "Record check" fails when a selected clock got worse than in the base and its job key is not in the lines the pull
request adds to this file.

## Fractional swings back off to a count the machine takes (#655)
- config-ELECTROMAGNETIC_SCIENCE_330: selected swings-2 -> fractional, wake-ups 163.869 -> 158.748 a minute, period 704; fractional swings were refused at 16/3, 5, 4 and 3 output swings a cycle and are now planned at 2 (game: 100% on both scaffolds)
- config-LITHIUM_PLATE_80_SILO_CHEST, config-UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT: a new fractional alternative, stable (620 and 118.209 wake-ups a minute), not selected; it was refused before
- front-front-exit-turbo-mirrored-backed-different-items, front-front-exit-turbo-mirrored-moving-config-different-items, front-front-exit-turbo-unmirrored-backed-different-items, front-front-exit-turbo-unmirrored-moving-config-different-items, pickup-electromagnetic-turbo-straight-belt-backed, pickup-electromagnetic-turbo-straight-belt-moving, pickup-electromagnetic-turbo-underground-entrance-backed, pickup-electromagnetic-turbo-underground-entrance-moving, pickup-electromagnetic-turbo-underground-exit-backed, pickup-electromagnetic-turbo-underground-exit-moving: a new fractional alternative, stable (573.542 to 625.641 wake-ups a minute), not selected; it was refused before
- config-AUTOMATION_SCIENCE_240, blocked-blocked-output-turbo-stack-3: a new fractional alternative, no recovery and unstable, not selected; it was refused before

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
