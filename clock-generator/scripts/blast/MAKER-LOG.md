# The maker log

An optional log of a blast. It says what each maker made, which clocks the generator listed, and why other clocks were dropped.
It is off by default.

```bash
bash scripts/blast/blast.sh run .. <out> --log      # writes <out>/maker-log/<job>.jsonl, one file a job
```

- The switch is `BLAST_LOG=1`, which `--log` sets. It turns selection off, so every job is generated and has a log.
- A log has one JSON line for each event. The first key of a line is `job`, the blast's job key.
- The log is not in the record. It changes no job file, and the key of the run does not hold it. `record check` gives the same result with it on.
- A file is written whole when its job ends. A job that failed to generate has no log.
- A generation is given a log by `maker_log` in `GenerateClockOptions`. With none, no event is built and nothing is timed.
- The log reads what the generation computed. It asks for no check the generation did not run.

Words: a **maker** is one of the generator's slots that makes a clock (`ClockAlternative.maker`). A **listed** clock is a clock in the result.
A **part** is a clock, or a way of the grouped hands rule, that Coordinated Sources can take windows from. A **composition** is a clock
Coordinated Sources makes by taking each source's windows from one part. A **reason** is a code with numbers, never a sentence.

## Format `maker-log-1`

A field's name and meaning do not change. A new field, a field less or a changed meaning is a new format number.
Field names are those of the record (`id`, `maker`, `verdict`, `holds`, `window_cycle_ticks`, `wake_ups`) where the record has them, so that a log joins the record on `job` and `id`.
`holds` is one copy alone, as in the record.
The lines of a file are in the order of the kinds below. Within a kind they are in the order the events were made.
Only `seconds` changes from one run to the next: without that line, two logs of one job are the same.

### `job`: one a job

The job and its copies. `shared_lanes`: the lanes the check of the shared lanes runs with the takers of the copies together. `unknown_end_lanes`: lanes of unknown end that the check runs as one copy alone.

```json
{"job":"config-FLYING_ROBOT_FRAME_80","group":"config","name":"FLYING_ROBOT_FRAME_80","event":"job","format":"maker-log-1","recipe":"flying-robot-frame","copies":12,"copy_offset":{"x":6,"y":0},"shared_lanes":[{"belt_id":5,"lane":1,"item":"electronic-circuit"}],"unknown_end_lanes":[]}
```

### `clock`: one for each listed clock

| Field | Meaning |
| --- | --- |
| `id`, `maker`, `verdict`, `holds`, `window_cycle_ticks` | as in the record |
| `listed_index`, `selected` | the place in the result, and whether it is the selected clock |
| `meets_target_rate` | the ranking's goal 1 figure |
| `wake_ups` | the record's wakeups a minute; null where the clock has none |
| `ranked_wake_ups` | the figure the selection ranks by (`ranking.wake_ups_per_minute`) |
| `shared_lane_losses` | one row for each lane where a taker of a copy loses swings: `belt_id`, `lane`, `item`, `copies` (the copies that lose), `takers_losing`, `swings_lost` (the sum of the swings lost, against one copy alone). Empty where none |
| `shared_lanes_not_checked` | true where the check of the shared lanes could not run |
| `loss_trials.one_copy` | null where the trials were not run. Else `survives`, `failed` (the losses it does not recover from) and `not_tried` (the count of losses left out after the first that failed) |
| `loss_trials.copies` | null where the trials on the copies were not made. Else `survives`, `failed`, `copies_short` (the copies not back) and `tried` |
| `loss_trials.one_copy_not_tried` | true where the clock holds and its trials could not be run |

A row of `failed` is a loss: `loss` (`supply`, `output` or `excess`), `items`, `trials_planned`, `trials_run`, `trials_recovered`, `cut_at` and `loss_ticks` of the first trial it does not recover from.

```json
{"job":"config-FLYING_ROBOT_FRAME_80","event":"clock","id":"takt_batches_observed","maker":"planned-belt-slack","listed_index":0,"selected":false,"verdict":"unstable","holds":true,"meets_target_rate":false,"window_cycle_ticks":288,"wake_ups":62.717770034843205,"ranked_wake_ups":62.717770034843205,"shared_lane_losses":[{"belt_id":5,"lane":1,"item":"electronic-circuit","copies":[4,5,6],"takers_losing":3,"swings_lost":186}],"shared_lanes_not_checked":false,"loss_trials":{"one_copy":{"survives":true,"failed":[],"not_tried":0},"copies":null,"one_copy_not_tried":false}}
```

### `windows`: one for each listed clock

The enable windows of each inserter and drill, as `[opening edge, closing edge]` in ticks of the window cycle.
For a Coordinated Sources clock, `source_clocks` gives, for each source, the part its windows were taken from.

```json
{"job":"config-ACCUMULATOR_320","event":"windows","id":"coordinated_sources","window_cycle_ticks":972,"windows":{"inserter:1":[[0,0],[54,54]],"inserter:10":[[0,6],[49,55]]},"source_clocks":{"machine:1":"round_robin_polling","machine:3":"time_division_windows"}}
```

### `composition`: the compositions Coordinated Sources judged, made or dropped

| Field | Meaning |
| --- | --- |
| `outcome` | `taken` (the local choice took it), `untried` (it holds, and its loss trial on one copy could not be run), `dropped`, or `listed` |
| `final` | true for the clock the maker made at the end, and for the last composition the margin check refused |
| `parts` | for each source, the part its windows are from; null for a clock the maker made again |
| `window_cycle_ticks`, `wake_ups` | the shared window cycle, and the wakeups a minute on one copy (null where the composition did not hold to the long run) |
| `reason` | null, or the code it was dropped for |
| `verdict`, `holds`, `shared_lane_losses`, `loss_trials`, and so on | on the `final` event only: what the checks found of the clock, as a `clock` event has it. A final composition with the reason `not_stable` is the clock the copies drop |

```json
{"job":"config-ACCUMULATOR_320","event":"composition","outcome":"dropped","final":false,"window_cycle_ticks":972,"wake_ups":674.2128009878576,"parts":{"machine:1":"round_robin_polling","machine:4":"staged"},"reason":{"code":"margin_check","check":"shifted","shift_ticks":-1,"group_size":2}}
```

### `part`: the parts offered, left out or refused

`kind` is `clock` or `way`. `outcome`:

| Outcome | Meaning | Fields |
| --- | --- | --- |
| `recommended` | the clock the windows are composed around | none more |
| `admitted` | the maker takes windows from it | `sources`: the sources it gives windows to alone, empty where it gives all |
| `no_new_windows` | it gives no window that another part does not | `sources` |
| `refused` | the maker takes no window from it, or only those of `sources` | `reasons`, `sources` |
| `excluded` | it was left out before the maker saw it: a listed clock that does not hold on one copy | `reasons` |
| `dropped` | a way of the grouped hands rule that was offered, and its loss trial on one copy failed | `reasons` |

A way that failed its margin check before it was offered is a `refused` part of the kind `way`. A way has no `verdict` or `wake_ups`.

```json
{"job":"config-ACCUMULATOR_320","event":"part","part":"takt_batches_observed_swings_2","kind":"clock","window_cycle_ticks":972,"wake_ups":null,"verdict":"unstable","outcome":"excluded","reasons":[{"code":"not_stable","verdict":"unstable"}]}
```

### `not_made`: a strategy that made no clock

```json
{"job":"config-ACCUMULATOR_320","event":"not_made","id":"shifted-swings","reason":{"code":"no_search_pick","search":"phase_shifted_batch"}}
```

### `seconds`: the seconds of the job

`makers`: the seconds each maker took (the key is `maker`). The other fields are the seconds of the checks: with the copies (`shared_lane_check_seconds`, `copies_trial_seconds`, `fewer_copies_seconds`) and the loss trials on one copy (`loss_trials_one_copy_seconds`). The seconds of a check a maker asked for are also in the maker's seconds.
A check that makers share is counted where it was first made. The figures are wall-clock seconds, and they change from run to run.

```json
{"job":"config-FLYING_ROBOT_FRAME_80","event":"seconds","makers":{"planned-belt-slack":0.863,"per-branch":0.028},"shared_lane_check_seconds":1.197,"copies_trial_seconds":2.837,"fewer_copies_seconds":1.829,"loss_trials_one_copy_seconds":0.185}
```

## Reasons

A reason is `{"code": ..., <numbers>}`. The fields of a code are the same every time.
The list is `MAKER_REASON_CODES` in `src/crafting/maker-log.ts`. A test checks that a log has no code that the list does not have.

| Code | Fields | Where it is given |
| --- | --- | --- |
| `takes_from_belt` | `inserter`, `source_kind` | `not_made`: Time-Division Windows need every inserter to take from a machine or a chest |
| `has_drills` | none | `not_made`: Time-Division Windows are not made for a build with drills |
| `no_search_pick` | `search` | `not_made`: the search for a moved output swing (`moved_output_swing`) or a shifted cycle (`phase_shifted_batch`) found none that passes the clock-only check |
| `fractional_swings_over_limit` | `sub_cycle` (null where the swings divide evenly), `swings_required`, `swings_max`, `total_swings`, `cycle_multiplier` | `not_made`: the insertion limits do not allow the fractional swings |
| `window_cycle_not_whole`, `recommended_not_a_part`, `plans_on_other_window_cycle`, `no_source_has_choice`, `keeps_recommended_clock` | `window_cycle_ticks`; none; `planned_ticks`, `recommended_ticks`; none; none | `not_made`: Coordinated Sources had nothing to compose |
| `same_as_listed_clock` | none | `not_made`, `composition`: the clock made is one that is listed already |
| `not_stable` | `verdict` | `part`: a clock that is not stable and does not hold on one copy gives no windows. `composition`, `not_made`: the clock made is not stable |
| `margin_check` | `check` (`as_placed`, or `shifted` for a group moved a tick), `shift_ticks`, `group_size` (the inserters in the group) | `composition`, `part`: the windows do not hold with their margin |
| `does_not_hold` | `stage` (`long_run`, or `whole_check`) | `composition`: the clock does not hold |
| `loss_trial_one_copy` | `tried` (false where the trials could not be run) | `composition`, `part`: the clock does not recover from a loss on one copy |
| `does_not_hold_with_copies` | `check` (`shared_lanes` where a taker of a copy loses swings on a shared lane, else `loss_trials` where a copy is not back after a trial on the copies) | `composition`: Coordinated Sources does not take the composition, or ends no local choice on it, because it does not hold with the copies. Where the local choice on one copy ends on such a composition, that composition is logged with this reason too. Then the local choice runs again with the copies |
| `cycle_does_not_divide` | `part_window_cycle_ticks`, `shared_window_cycle_ticks` | `part`: its window cycle does not divide the shared one |
| `not_counted` | none | `part`: the long run of its own clock was not counted |
| `does_not_hold_alone` | `source` (null for its own clock), `check` (`first_window_cycle`, `pickup_phase`, `long_run`, `not_checked`), `items`, `expected_items` | `part`: its clock, or the recommended clock with its windows for one source, does not hold |
| `same_windows_as_part` | `part` | `part`: another part has the same windows |
| `other` | none | a reason no site gave a code. This is a fault of the log. The blast has none |

## What the log does not hold

- Clocks that a maker drops inside its own search, such as the grouped hands rule's ways that fail the loss trial in `generate-clock.ts`, are not logged. The log has the ways of the grouped hands rule that the margin check and the loss trial drop (`part`).
- A `not_made` reason that a maker raises without a code is `other`. The makers of the grouped hands rule give many such reasons. The 86 jobs of the record have none.
