# The maker log

An optional log of a blast. It says what each maker made, which clocks the generator listed, and why other clocks were dropped.
It is off by default.

```bash
bash scripts/blast/blast.sh run .. <out> --log            # writes <out>/maker-log/<job>.jsonl, one file a job
bash scripts/blast/blast.sh run .. <out> --repeat-check   # the log, with the repeat check of each listed clock
```

- The switch is `BLAST_LOG=1`, which `--log` sets. It turns selection off, so every job is generated and has a log.
- A log has one JSON line for each event. The first key of a line is `job`, the blast's job key.
- The log is not in the record. It changes no job file, and the key of the run does not hold it. `record check` gives the same result with it on.
- A file is written whole when its job ends. A job that failed to generate has no log.
- A generation is given a log by `maker_log` in `GenerateClockOptions`. With none, no event is built and nothing is timed.
- The log reads what the generation computed. It asks for no check the generation did not run.
- The repeat check is not like that. It runs each listed clock that holds on one copy again (event `repeat_check`).
  Its switch is `BLAST_REPEAT_CHECK=1`, which `--repeat-check` sets with `BLAST_LOG=1`.
  A generation asks for it with `maker_log_repeat_check`. It is not on in CI or in a record write. It changes no job file.

Words: a **maker** is one of the generator's slots that makes a clock (`ClockAlternative.maker`). A **listed** clock is a clock in the result.
A **part** is a clock, or a way of the grouped hands rule, that Coordinated Sources can take windows from. A **composition** is a clock
Coordinated Sources makes by taking each source's windows from one part. A **reason** is a code with numbers, never a sentence.

## Format `maker-log-4`

A field's name and meaning do not change. A new field, a field less or a changed meaning is a new format number.
`maker-log-4` adds the event `shadow`. The events of `maker-log-3` are as they were.
`maker-log-3` added the event `ticks` and one key of `seconds.makers`, `primary-planning`. The planning of the primary clock was
made before every maker, so no seconds were counted to it. The events of `maker-log-2` are as they were.
`maker-log-2` added the events of the lanes the copies share (`job_lanes`, `lane_facts` and `missed_swings`), the `timetable` and the
`ledger` of each listed clock, the `repeat_check`, and two fields of `seconds`. The events of `maker-log-1` are as they were.
Field names are those of the record (`id`, `maker`, `verdict`, `holds`, `window_cycle_ticks`, `wake_ups`) where the record has them, so that a log joins the record on `job` and `id`.
`holds` is one copy alone, as in the record.
The lines of a file are in the order of the kinds below. Within a kind they are in the order the events were made.
Only `seconds` changes from one run to the next: without that line, two logs of one job are the same. It is the last line.

### `job`: one a job

The job and its copies. `shared_lanes`: the lanes the check of the shared lanes runs with the takers of the copies together. `unknown_end_lanes`: lanes of unknown end that the check runs as one copy alone.

```json
{"job":"config-FLYING_ROBOT_FRAME_80","group":"config","name":"FLYING_ROBOT_FRAME_80","event":"job","format":"maker-log-4","recipe":"flying-robot-frame","copies":12,"copy_offset":{"x":6,"y":0},"shared_lanes":[{"belt_id":5,"lane":1,"item":"electronic-circuit"}],"unknown_end_lanes":[]}
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

### `timetable`: one for each listed clock

What each inserter's windows were needed for. `one_copy` is read from the long run of the clock-only check: the record's wakeups are
from that run. It is read over the ticks the wakeups are counted on. `copies` has one line for each run of the copies that the check
of the shared lanes judged by, over its judged span. `run` is the place of that run in the `runs` of `lane_facts`. A line is made only
on a window cycle of whole ticks.

`reason` is null, or `no_run_of_one_copy` with its `cause`: `no_long_run` (the clock-only check made no long run: the clock does not
hold), `not_noted` or `not_read` (`errors` says why). Then `one_copy` is null. `windows_hash` joins it to the `windows` event.

A line has `from_tick` and `to_tick` (ticks of the run), its `rows`, `no_window` (the inserters with no window of the clock) and
`errors`. `one_copy` also has `ticks_before_stock`: the run's ticks before the first tick the record's wakeups are counted from.
Each row is an inserter: the `copies` read (1 is the config's own), its `windows` and `unmapped_open_ticks`.
`unmapped_open_ticks` are open ticks at a position that no window has. They are 0 where the record lines up with the clock. Each window:

| Field | Meaning |
| --- | --- |
| `start`, `ticks` | the window as the clock gives it: its first tick of the window cycle and its length. Ranges that meet are one window. The range at the end of the window cycle and the range at its start are one window too |
| `openings`, `open_ticks` | its openings and open ticks in the span, over all the copies read |
| `needed`, `needed_ticks` | the first and the last needed tick, counted from `start` (null where none), and the count. In a needed tick the inserter's phase rule read its enable condition and the read let it go on. After the update its hand is at its pickup |
| `needed_by` | the needed ticks by kind: `start` (a hand starts), `fill` (a hand fills on), `wait` (a part hand waits for its machine) |
| `open_without_pickup` | open ticks that were not needed. An inserter in sleep on a list makes no read, so its ticks in sleep count here |
| `cut_hands`, `cut_empty` | hands the close of the window cut at their pickup, and of them the empty hands |
| `ticks_to_swing`, `not_swung` | the cut hands by their open ticks to the swing: from the next opening to the tick the hand leaves for the sink. `not_swung`: the cut hands that do not leave in the record |
| `starts_by_last` | `copies` only, for a taker of a belt: its hand starts by their last condition (as `missed_swings`) |
| `needed_from_start` | `one_copy` only: `needed` over the whole run from its first tick, the warm-up included. The repeat check narrows to it |

```json
{"job":"config-AUTOMATION_SCIENCE_240","event":"timetable","id":"pitch_pickups","window_cycle_ticks":72,"windows_hash":"4f29c18f","reason":null,"one_copy":{"from_tick":433,"to_tick":721,"rows":[{"inserter_id":"inserter:1","copies":[1],"windows":[{"start":1,"ticks":24,"openings":4,"open_ticks":96,"needed":[0,23],"needed_ticks":33,"needed_by":{"start":9,"fill":23,"wait":1},"open_without_pickup":63,"cut_hands":0,"cut_empty":0,"ticks_to_swing":{},"not_swung":0,"needed_from_start":[0,23]}],"unmapped_open_ticks":0}],"no_window":[],"errors":[],"ticks_before_stock":433},"copies":[{"run":0,"reading":0,"from_tick":4680,"to_tick":9360,"rows":[{"inserter_id":"inserter:1","copies":[1,2,3,4,5,6,7,8,9],"windows":[{"start":1,"ticks":24,"openings":585,"open_ticks":14040,"needed":[0,23],"needed_ticks":4921,"needed_by":{"start":1314,"fill":3463,"wait":144},"open_without_pickup":9119,"cut_hands":0,"cut_empty":0,"ticks_to_swing":{},"not_swung":0,"starts_by_last":{"window_open":441,"hand_at_source":729}}],"unmapped_open_ticks":0}],"no_window":[],"errors":[]}],"errors":[]}
```

The example is shortened: one inserter, one window, one run of the copies.

### `ledger`: one for each listed clock

The wakeups of the run of one copy that the record's wakeups are from. They are counted over the same ticks, as the record counts them.
`reason` is as in `timetable`; then `ledger` is null. `record` is the record's: `wake_ups` (the count), `ticks` and `wake_ups_per_minute`.
`adds_up` is true where the ledger has the same count over the same ticks. The value a minute must be the same too. It is null where one is missing.

`ledger` has `from_tick` and `to_tick` (ticks of the stock the wakeups are counted on), `ticks`, `wake_ups`, `wake_ups_per_minute` and
a row for each inserter:

| Field | Meaning |
| --- | --- |
| `input` | wakeups from the list of the machine it puts into: by the `machine` (a craft start, or a fuel item its burner took), by an `inserter` (a take from the machine's output) |
| `output` | wakeups from the list of the machine it takes from: by the `machine` (a result), by an `inserter` (fuel put in) |
| `ghost` | of those, by list, the ghost wakeups: the clock switched the inserter off while it was in sleep on the list |
| `empty_hand_enabled_ticks` | ticks it was enabled with an empty hand and its arm not away: at its `pickup`, or at `rest` |

```json
{"job":"config-AUTOMATION_SCIENCE_240","event":"ledger","id":"pitch_pickups","reason":null,"record":{"wake_ups":4,"ticks":287,"wake_ups_per_minute":50.174216027874564},"adds_up":true,"ledger":{"from_tick":1,"to_tick":288,"ticks":287,"wake_ups":4,"wake_ups_per_minute":50.174216027874564,"rows":[{"inserter_id":"inserter:1","input":{"machine":4,"inserter":0},"output":{"machine":0,"inserter":0},"ghost":{"input":3,"output":0},"empty_hand_enabled_ticks":{"pickup":0,"rest":7}}]}}
```

The example is shortened: one inserter.

### `repeat_check`: one for each listed clock, only with `--repeat-check`

The clock runs from the cold start as its long run is made, for all the window cycles of the long run. Each window is narrowed to its
`needed_from_start` in that run, with no margin. A window with no needed tick stays as it is. A window that its needed ticks fill
stays as it is too. The narrowed clock runs again from the same start. Each hand of each inserter is compared tick for tick with the
first run. Where a hand is not the same, each narrowed window opens 1, 2 or more ticks earlier, until the run repeats. A window never
opens before its own opening. Nothing the check makes is listed, ranked or kept.

`reason` is null, or `not_repeat_checked` with its `cause`: `does_not_hold_one_copy`, `window_cycle_not_whole`, `not_noted`, or
`error` (then `error` gives it). Then `check` is null.

| Field | Meaning |
| --- | --- |
| `ticks` | the ticks of the first run compared |
| `windows` | the windows `narrowed`, those `not_needed` (no needed tick), and `all` |
| `same_needed_as_timetable` | true where the first run has the needed ticks of the clock's `timetable` (`needed_from_start`); null where the clock has no timetable |
| `control_repeats` | the clock run again on its own windows repeats the first run. Where it does not, nothing else can be read |
| `earlier_by` | the ticks the narrowed windows open before their first needed tick in the run that repeats; null where none repeats |
| `earlier_by_most` | the most `earlier_by` can be: there every narrowed window opens where it did |
| `runs` | the runs made, the first and the control run included |
| `first_difference`, `last_difference` | the first hand that is not the same, in the run with no earlier opening and in the last run: `tick`, `inserter_id`, and the items `held` in the first run and `held_again` |
| `shared_sources` | `machine_with_takers`: a machine two or more inserters take from. `taken_in_one_tick`: a source of one item that two takers can take from in one tick, by their windows. An inserter with no window is always enabled |

```json
{"job":"config-AUTOMATION_SCIENCE_240","event":"repeat_check","id":"pitch_pickups","reason":null,"check":{"ticks":9576,"windows":{"narrowed":2,"not_needed":0,"all":3},"same_needed_as_timetable":true,"earlier_by_most":0,"shared_sources":{"machine_with_takers":false,"taken_in_one_tick":false},"control_repeats":true,"earlier_by":0,"runs":3,"first_difference":null,"last_difference":null}}
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

### `ticks`: one a job

The ticks the generation simulated, by `maker`, `purpose` and `stage`. A row is made only for a loop that was run. There is no line for a tick or for a run.
The ticks of all the rows add up to every tick the generation simulated. The rows are in the order of `maker` (null first, then by name), `purpose` and `loop`.

| Field | Meaning |
| --- | --- |
| `maker` | the key of `seconds.makers` of the maker that asked for the run; null where no maker did (the repeat check is one) |
| `purpose` | why the run was made: `planning`, `first_span`, `long_run`, `taker_order`, `start_phase`, `quick_trial`, `trial_one_copy`, `trial_copies`, `shared_lane_check`, `fewer_copies`, `repeat_check`, `start_dependence`, `wakeups_from_starts`, `margin_check`, `window_derivation`, `pitch_pickups`, `fuel_view`, `config_check`. `no_purpose` is a fault of the log. The blast has none. A check with more than one kind of run (`quick_trial`, `trial_copies`) has all its runs in its own row |
| `stage` | `prepare`, `warm_up` or `judged`: where in the run the ticks fell |
| `loop` | the tick loop that made them: `prepare_step`, `warmup_step`, `simulate_step`, `loss_trials` or `phase_proof`. The `stage` follows from the `loop`. `judged` also holds `loss_trials` and `phase_proof`. For the ticks of the recorded run alone, take `simulate_step` |
| `runs`, `ticks` | the loops that were run, and their ticks. A warm-up that stops at its repeat counts the ticks it made, not the ticks asked for |

`memo_hits`: one row for each `maker` and `purpose`, with `hits`: runs the generation used again. Such a run makes no tick.

```json
{"job":"config-ACCUMULATOR_320","event":"ticks","rows":[{"maker":null,"purpose":"repeat_check","stage":"warm_up","loop":"warmup_step","runs":21,"ticks":72206},{"maker":"derived","purpose":"planning","stage":"prepare","loop":"prepare_step","runs":1,"ticks":350},{"maker":"derived","purpose":"planning","stage":"warm_up","loop":"warmup_step","runs":1,"ticks":9720},{"maker":"derived","purpose":"planning","stage":"judged","loop":"simulate_step","runs":1,"ticks":972},{"maker":"primary-planning","purpose":"trial_one_copy","stage":"judged","loop":"loss_trials","runs":2,"ticks":39098}],"memo_hits":[]}
```

The example is shortened: five rows.

### `shadow`: one a job

Each run warms up before the cycle that is judged. The shadow reads that warm-up against the judged cycle: the first window cycle of the recorded run.
For each window cycle of the warm-up, and for the judged cycle, it counts the items that each output inserter dropped in it. The two are equal when every output gave the same count.
The warm-up is not changed, and no window cycle of it is skipped. The shadow gives the window cycle in which the warm-up first gave the judged cycle's output.
A row is a count of warm-up runs, not a line for a run. The rows are in the order of `maker` (null first, then by name), `purpose`, `outcome` and `cycle`.
The runs of the rows of one `maker` and `purpose` add up to the `runs` of its `warmup_step` rows in `ticks`.

| Field | Meaning |
| --- | --- |
| `maker`, `purpose` | as in `ticks` |
| `outcome` | `found`: a window cycle of the warm-up gave the judged cycle's output. `none`: no window cycle the warm-up ran did. `no_warm_up`: the warm-up was asked for no whole window cycle. `not_judged`: the run gave no judged cycle (it was shorter than a window cycle, or an error ended it). `not_whole`: the window cycle is not a whole number of ticks. `no_output`: the build has no output inserter |
| `cycle` | the first window cycle of the warm-up that gave the judged cycle's output, counted from 1; null unless `outcome` is `found` |
| `stays` | true when every later window cycle that the warm-up ran gave that output too; false unless `outcome` is `found` |
| `ran` | the whole window cycles the warm-up ran. A warm-up that stops at its repeat runs fewer than it was asked for |
| `asked` | the whole window cycles the warm-up was asked for |
| `runs` | the warm-up runs with these values |

```json
{"job":"config-ACCUMULATOR_320","event":"shadow","rows":[{"maker":"derived","purpose":"planning","outcome":"found","cycle":3,"stays":false,"ran":10,"asked":10,"runs":1},{"maker":"derived","purpose":"first_span","outcome":"found","cycle":5,"stays":false,"ran":7,"asked":10,"runs":1},{"maker":"derived","purpose":"taker_order","outcome":"found","cycle":6,"stays":true,"ran":10,"asked":10,"runs":14},{"maker":"fractional","purpose":"planning","outcome":"none","cycle":null,"stays":false,"ran":10,"asked":10,"runs":2}]}
```

The example is shortened: four rows.

### `seconds`: the seconds of the job

`makers`: the seconds each maker took (the key is `maker`). `primary-planning`: the planning of the primary clock and its checks, which is made before every maker. It is no clock's `maker`. The key of the primary clock holds its own run, as before. The other fields are the seconds of the checks: with the copies (`shared_lane_check_seconds`, `copies_trial_seconds`, `fewer_copies_seconds`) and the loss trials on one copy (`loss_trials_one_copy_seconds`). The seconds of a check a maker asked for are also in the maker's seconds.
`timetable_seconds`: the reading of the timetable and the ledger of each run of one copy, after the run. The record of a run is made while it runs. Its seconds are in the seconds of the check that runs it. `repeat_check_seconds`: the repeat checks, 0 without the switch.
A check that makers share is counted where it was first made. The figures are wall-clock seconds, and they change from run to run.

```json
{"job":"config-ACCUMULATOR_320","event":"seconds","makers":{"primary-planning":0.691,"planned-belt-slack":0.639,"fractional":0.666,"even-hands":0.809,"swings-2":0.179,"swings-3":0.036,"swings-4":0.098,"derived":3.779,"shifted-swings":1.082,"per-branch":6.25},"shared_lane_check_seconds":0,"copies_trial_seconds":0,"fewer_copies_seconds":0,"loss_trials_one_copy_seconds":0.83,"timetable_seconds":0.202,"repeat_check_seconds":0.711}
```

The example is of a run with the repeat check.

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
| `no_metered_takers` | `target_machines` (the machines that make the target) | `not_made`: Round-Robin Polling with metered takers needs a machine that hands an ingredient to two or more of the machines that make the target |
| `metered_window_unproved` | `inserter`, `cause` (control, hand, shared_route, rotation, return, cycle_edge or overlap) | `not_made`: the metered enable window cannot be bounded for this route or turn placement |
| `metered_plan_override` | `terminal_swing_count` (null for AUTO), `lcm` | `not_made`: an explicit planning setting lies outside the metered maker’s supported count or LCM |
| `no_count_holds` | `swings_max` (the most output swings tried), `whole_counts` (the counts on which every taker moves whole hands and crafts), `as_built_refusals`, `margin_refusals` (the counts whose windows failed the as-built check, or the margin of a tick) | `not_made`: Round-Robin Polling with metered takers found no output swing count whose windows hold |
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
| `no_run_of_one_copy` | `cause` | `timetable`, `ledger`: the run of one copy was not read (see `timetable`) |
| `not_repeat_checked` | `cause` | `repeat_check`: the clock was not run again (see `repeat_check`) |
| `other` | none | a reason no site gave a code. This is a fault of the log. The blast has none |

## What the log does not hold

- Clocks that a maker drops inside its own search, such as the grouped hands rule's ways that fail the loss trial in `generate-clock.ts`, are not logged. The log has the ways of the grouped hands rule that the margin check and the loss trial drop (`part`).
- Coordinated Sources is made on the window cycles of two clocks, each around its own clock (`recommended` names it). The log
  has every event of the window cycle whose clock is listed, or of the recommended clock's where none is. Of the other window cycles
  it has only the compositions judged before the end (`final` false), each with its own `window_cycle_ticks`; their parts, their
  `final` compositions and their `not_made` are not logged.
- A `not_made` reason that a maker raises without a code is `other`. The makers of the grouped hands rule give many such reasons. The 86 jobs of the record have none.
