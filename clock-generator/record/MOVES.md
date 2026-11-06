# Moves

A pull request that changes a record file (a file in this folder) adds an entry at the top of this file, newest first: its title and the pull
request number, then one line for each moved job (the job key as in the file name) with what moved and why. A job whose clock got worse (the verdict
lower, a lost hold, a lower rate, more wake-ups a minute; CONTRIBUTING.md, "The record of the blast jobs") must be named here, and says why it is accepted. Many jobs that move for one reason may share
a line that names the reason and lists the jobs. A pull request that moves no record needs no entry.

CI checks this file: the "Record check" fails when a selected clock got worse than in the base and its job key is not in the lines the pull
request adds to this file.

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
