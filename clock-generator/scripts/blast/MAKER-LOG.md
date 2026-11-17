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

## Format `maker-log-2`

A field's name and meaning do not change. A new field, a field less or a changed meaning is a new format number.
`maker-log-2` adds the events of the lanes the copies share: `job_lanes`, `lane_facts` and `missed_swings`. The events of `maker-log-1` are as they were.
Field names are those of the record (`id`, `maker`, `verdict`, `holds`, `window_cycle_ticks`, `wake_ups`) where the record has them, so that a log joins the record on `job` and `id`.
`holds` is one copy alone, as in the record.
The lines of a file are in the order of the kinds below. Within a kind they are in the order the events were made.
Only `seconds` changes from one run to the next: without that line, two logs of one job are the same.

### `job`: one a job

The job and its copies. `shared_lanes`: the lanes the check of the shared lanes runs with the takers of the copies together. `unknown_end_lanes`: lanes of unknown end that the check runs as one copy alone.

```json
{"job":"config-FLYING_ROBOT_FRAME_80","group":"config","name":"FLYING_ROBOT_FRAME_80","event":"job","format":"maker-log-2","recipe":"flying-robot-frame","copies":12,"copy_offset":{"x":6,"y":0},"shared_lanes":[{"belt_id":5,"lane":1,"item":"electronic-circuit"}],"unknown_end_lanes":[]}
```

### `job_lanes`: one a job whose copies share a lane

What the config states of its lanes and its copies, from the config alone. `output_belt_stated` and `copy_offset_stated`: whether the config states them.
`lane_loads`: for each take of the config's inserters from a belt (`laneLoads`), the lane load: `copies` times `items_per_second` (what one copy takes at the setpoint), over `supply_per_second` (what the lanes get for every copy).
`against_one` is `below`, `exactly` or `above` 1, compared exactly. `per_copy` is true where each copy has a lane of its own. `lane_loads` is null where the planner cannot plan the config.

```json
{"job":"config-FLYING_ROBOT_FRAME_80","event":"job_lanes","output_belt_stated":false,"copy_offset_stated":true,"lane_loads":[{"belt_id":5,"lanes":[1],"items":["electronic-circuit"],"per_copy":false,"copies":12,"items_per_second":10,"supply_per_second":120,"load":1,"against_one":"exactly"}]}
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

### `lane_facts`: one for each listed clock of a job whose copies share a lane

The facts of the lanes, read from the runs the check of the shared lanes made for the clock. The log asks for no other run.
`window_cycle_ticks` and `windows_hash` (FNV-1a of the `windows` of the clock's `windows` event, as JSON) join it to that event.
`reason` is null, or `not_run_with_copies` with its `cause`: `does_not_hold_one_copy` (the check runs only a clock that holds on one copy), `lanes_not_checked` (the check stopped with an error), `no_lane_run` or `not_noted`. Then `readings` and `runs` are empty.

| Field | Meaning |
| --- | --- |
| `readings` | for each reading of the lanes of unknown end (`reading` 0: a dead end, 1: an infinite end), from the run of one copy alone, for each item of each belt: |
| `readings[].lane_load` | the lane load of the clock: `copies` times `items_per_window_cycle` (what one copy took in a window cycle, over `window_cycles` of the judged span), over `supply_per_window_cycle`, and `against_one` |
| `readings[].fill` | for each window of the takers (`opens`, `gap_ticks` to the next window opening): its `openings` with a take, the `longest_fill_ticks` the supply takes to bring back what every copy took in one, and the `openings_not_filled` before the next. `fills_in_time` is the check's refill arithmetic |
| `errors` | the errors of the parts of the facts that could not be read, which are left out; empty where none. The check's verdict never depends on them |
| `runs` | each run of the copies the check judged by: its `reading`, the `flow` of its first row, its `window_cycles`, its judged span from `first_cycle` up to `end_cycle`, and its `losses` |
| `runs[].claimed_stacks` | for each lane more than one copy takes from: how the copies stand (`spacing`: `copy_offset`, `copy_length` from the positions, or `copy_width`), the `stack_ticks` a stack takes to pass a point, the takers with no window, and for each copy: `travel_ticks` from copy 1, its `pickups` (ticks of the window cycle on which one copy alone takes the item), the `claimed` ones (within `stack_ticks` of an earlier copy's pickup moved on by the travel between them), and the `open_ticks` of its windows and the `moved_ticks` among them in which the lane moved at its reach |

```json
{"job":"config-FLYING_ROBOT_FRAME_80","event":"lane_facts","id":"takt_batches_observed","window_cycle_ticks":288,"windows_hash":"7a202363","reason":null,"readings":[{"reading":0,"lane_load":[{"belt_id":5,"item":"electronic-circuit","lanes":[1],"copies":12,"items_per_window_cycle":48,"supply_per_window_cycle":576,"load":1,"window_cycles":61,"against_one":"exactly"}],"fill":[{"belt_id":5,"item":"electronic-circuit","lanes":[1],"fills_in_time":false,"windows":[{"opens":13,"gap_ticks":144,"openings":61,"longest_fill_ticks":192,"openings_not_filled":61}]}]}],"errors":[],"runs":[{"reading":0,"flow":[1,0],"window_cycles":120,"first_cycle":62,"end_cycle":123,"losses":12,"claimed_stacks":[{"belt_id":5,"lane":1,"item":"electronic-circuit","spacing":"copy_offset","stack_ticks":2,"takers_without_windows":[],"copies":[{"copy":7,"travel_ticks":288,"pickups":12,"claimed":12,"open_ticks":3233,"moved_ticks":2684}]}]}]}
```

The example is shortened: one item, one window, one copy.

### `missed_swings`: one for each taker of a copy that loses swings on a lane the copies share

`id` is the clock's, `loss` the place of the loss in the clock's losses, `run` the place of its run in the `runs` of the clock's `lane_facts`.
`copy` (1 is the config's own), `inserter_id`, `belt_id`, `lanes` and `item` are the loss's. `cause` is `lane`, or `join_full` where the loss is put down to the copy's side belt full at its join onto the output belt.

| Field | Meaning |
| --- | --- |
| `pickups` | each tick the taker's hand took items in the judged span: `[window cycle of the span from 1, tick of the window cycle, lane]`; the lane is 0 where the run does not say it |
| `baseline` | what a window cycle with a missed swing is held against: `waits`, the open ticks of a window cycle by what the hand waited for, on average over the taker's own window cycles of the span with no missed swing (`of`: `own`), else over the same taker of the first copy (`first_copy`), else none |
| `window_cycles` | each window cycle with fewer swings than one copy alone: `missed`; `waits`, its open ticks by what the hand waited for; `condition`, the condition with the most open ticks over the baseline, else `window_open` where an opening of it closed on a hand that was taking, else `left_over`; `at_close`, what the hand waited for at the last open tick of each opening that opens in it; and `stop_class`, the class the result's rows give it |
| `by_condition` | missed swings by `condition` |
| `starts_by_last` | the taker's hand starts in the span by their last condition |

The four conditions are read in each tick after the inserters' update (`src/crafting/hand-conditions.ts`): `window_open`, `hand_at_source`, `room_at_sink` (the sink takes what the hand brings, read from the sink), `item_there` (a reach holds a stack the hand can take).
A hand start is the first take of an empty hand. Its last condition is the one that came last before it, ties in that order.
In each open tick the hand waits for one thing: `on_its_way` (it holds a hand it swings), else the first condition that does not hold, in the order `hand_at_source`, `room_at_sink`, `item_there`; `window_open` where it took items, and `left_over` where all four held and it took nothing.

```json
{"job":"config-FLYING_ROBOT_FRAME_80","event":"missed_swings","id":"takt_batches_observed","loss":0,"run":0,"copy":4,"inserter_id":3,"belt_id":5,"lanes":[1],"item":"electronic-circuit","pickups":[[1,15,2],[1,16,2]],"baseline":{"of":"first_copy","window_cycles":61,"waits":{"left_over":2,"window_open":15,"on_its_way":20,"hand_at_source":16}},"window_cycles":[{"window_cycle":1,"missed":2,"condition":"room_at_sink","waits":{"window_open":9,"on_its_way":12,"hand_at_source":11,"room_at_sink":21},"at_close":["room_at_sink","hand_at_source"],"stop_class":"neither"}],"by_condition":{"room_at_sink":82,"item_there":20},"starts_by_last":{"window_open":122,"hand_at_source":81},"cause":"lane"}
```

The example is shortened: two pickups, one window cycle.

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
| `not_run_with_copies` | `cause` | `lane_facts`: the clock has no facts of the lanes (see `lane_facts`) |
| `other` | none | a reason no site gave a code. This is a fault of the log. The blast has none |

## What the log does not hold

- Clocks that a maker drops inside its own search, such as the grouped hands rule's ways that fail the loss trial in `generate-clock.ts`, are not logged. The log has the ways of the grouped hands rule that the margin check and the loss trial drop (`part`).
- A `not_made` reason that a maker raises without a code is `other`. The makers of the grouped hands rule give many such reasons. The 86 jobs of the record have none.
