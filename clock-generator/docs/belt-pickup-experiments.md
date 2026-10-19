# Belt pickup experiment record

This is the consolidated record of the belt-pickup investigation, including the splitter research that was
shelved before integration. The [simulator rules](simulator.md#picking-up-from-moving-belts-and-underground-endpoints)
describe supported behavior; the [mechanics index](../tests/game/mechanics/belt-pickup/README.md) links runnable
fixtures and commands. This report preserves the measurements, counterexamples and limits behind those rules.

**Release status:** the accepted engine/UI changes are reserved for **0.19.0**, and Sidecar changes for
**0.11.0**. They are unreleased. Publishing remains on hold under `RELEASE_HOLD=true`.
**Splitter implementation is out of scope:** Sidecar warns and generation refuses unsupported captures.
The finite routing experiments below do not enable splitter configurations or generated splitter clocks.

## Reading the evidence

Measurements used Factorio **2.1.21**, primarily legendary stack inserters, four-item belt stacks and turbo
belts. A stack means a belt stack, rather than an entire inserter hand. Timing lists are offsets from the
first grab unless explicitly called capture ticks. They do not independently calibrate arm arrival or wake-up.

Different experiments answer different questions:

- Natural captures preserve feeder operation and routing. Some isolate pickup by clearing destination
  inventories **after** observation; those captures cannot establish an operating machine's throughput.
- Position replays seed observed stock once and compare subsequent stacks, IDs, items, counts and positions.
  Measured boundary arrivals, withdrawals or arm timing remain explicit inputs where used. Matching a hand
  count alone is insufficient evidence for matching replenishment.
- Seeded cutoff controls disable consumers and place stock at asserted initial positions. They test local
  boundaries, rather than natural feeding or clock stability.
- Generated-clock checks independently measure complete periods and recovery after supply/output cuts.
- Sidecar classification checks establish exported metadata. Rotation checks of the classifier do not mean
  actual grabs were measured in every orientation.

Full recordings belong in ignored `work/` directories. Committed fixtures, compact regression data and
screenshots provide the portable record. Local recording paths below identify historical evidence; they are
not guaranteed to exist in another checkout. Existing scaffold images are JPEGs captured through the shared
[screenshot script](../tests/game/helpers/scaffold-screenshot.js), which converts Factorio's native PNG output.

## General findings used by the simulator

1. Choose an ingredient the destination accepts. Prefer the configured physical lane when eligible; a more
   depleted ingredient on the other lane does not automatically win. Keep collecting the held ingredient,
   subject to filters and destination eligibility.
2. Take at most one reachable stack total per tick. Try the preferred lane, then the other lane for the same
   ingredient. Choose the upstream-most reachable matching stack. Switching lanes adds no fixed delay.
3. Straight tiles expose one tile per lane; underground endpoints expose half a tile. Moving stock, holes,
   partial stacks and lane phase persist across hands and circuit windows. There is no underground tick surcharge.
4. Geometry and supply motion are separate. Omitted `pickup_length` defaults to **1** in both config loading
   and direct engine construction. Explicit underground reach is **0.5**. Moving is the default; explicit
   backed-up supply uses the measured one-stack-per-tick availability rule.
5. Supply topology decides what reaches that space. Single-stream side entries and the calibrated turbo
   two-stream merge need supply profiles; a full incoming belt does not guarantee a full pickup tile.
6. Unsupported captured topology must remain unsupported after save/reload and engine updates. Only explicit,
   versioned supported capture metadata enables generation. See the [capture boundary](pickup-capture.md).

These are scoped findings, not a complete model of Factorio transport networks. In particular, a closed final
outlet does not prove permanent local saturation when another consumer can reopen a route.

## Straight belts and side pickups at underground endpoints

### Different ingredients and the original unstable clock

The [electromagnetic fixtures](../tests/game/mechanics/belt-pickup/fixtures/different-items/README.md) compare
straight, underground-entrance and underground-exit pickups with accumulators on lane 1 and supercapacitors
on lane 2. Collecting one ingredient prevents the other lane from hiding gaps in its supply.

The former always-full assumption selected **528 packs / 1,056 ticks**. In native checks, each underground
missed its target in **30 of 35 periods**, producing 480–528 packs. Modeling reachable moving stacks instead
selected **352 packs / 704 ticks**, or **30 packs/s**, with two output swings. Initial verification held all
52 measured periods per geometry. Current generated-clock regressions cover at least 60 complete periods,
ingredient cuts and output-disposal blockage on all three geometries, with moving and backed-up supply.

Six backed-up mechanic controls isolate both ingredients on all three geometries. Removing only the ingredient
drain produces grabs at `0,1,2,3`; the unselected lane stays stationary. Explicit filters and observed held
items establish the ingredient tested. Early local probes labeled “supercapacitor” had disabled filters;
their labels were not evidence of far-lane pickup. The corrected controls supersede that interpretation.

**Impact:** replace the legacy full-reach assumption, retain geometry under backed-up supply, default omitted
straight geometry in the engine, and add simulator plus generated-clock throughput/recovery regressions.

### Near-lane preference versus ingredient demand

Three manual controls used an operating electromagnetic plant, a backed-up straight belt, four-item stacks,
a 16-item hand and a measured insertion limit of 14 per ingredient. Machine inventory was staged once and
was not cleared every tick. The inserter was unfiltered and lane 1 was nearer.

| Near ingredient / initial count | Far ingredient / initial count | First native and simulator grab |
| --- | --- | --- |
| Accumulator / 13 | Supercapacitor / 0 | Four accumulators |
| Supercapacitor / 13 | Accumulator / 0 | Four supercapacitors |
| Supercapacitor / 14 | Accumulator / 0 | Four accumulators |

The missing far ingredient did not override eligible near stock. Swapping ingredients separated physical
preference from recipe order; reaching the near ingredient's insertion limit made the far ingredient eligible
for selection. Native first grabs occurred at capture tick 2; the comparison concerned item and amount,
not absolute arrival timing. These are documented manual controls, not automated regressions. The ignored
captures were `work/belt-pickup/mixed-demand-02/`, `mixed-demand-swapped-01/` and `mixed-demand-limit-01/`.
The inventory-clearing backed-up probe cannot reproduce this staged-demand question.

**Impact:** existing destination eligibility and lane preference agree; no new demand-priority rule.

### Same ingredient on both lanes

The [same-item fixtures](../tests/game/mechanics/belt-pickup/fixtures/same-item/README.md) use iron on both
lanes and a gear assembler, covering the three geometries, turbo/express speeds and pickup from either side.
Twelve mechanic regressions compare later grabs and lane contents after seeding the observed first grab and
remaining stock. An expanded investigation covered **78 captures and 5,268 uninterrupted hands**, including
hand sizes 8/12/16, interrupted windows and staggered turbo lanes. A single-lane-only model missed 1,078 hands.

The fallback rule filled the measured 16-item hands at `0,1,2,3` on all three geometries. One lane can provide
the missing grab when the preferred lane has a hole. Six default-clock throughput/recovery checks held
**16 gears / 160 ticks = 6/s** over at least 60 baseline periods and recovery controls. Their input window is
26 ticks; the previous underground calculation required 28.

**Impact:** persist both lanes' stock and allow same-item fallback without a lane-switch penalty. Arbitrary
initial phase, sparse supply and unmeasured belt speeds remain outside this evidence.

## Front-facing underground pickups

Neither lane is physically nearer in these centered layouts. Inserter mirroring determines the preferred lane.

| Fixture and supply | Unmirrored preference | Mirrored preference | First-hand offsets |
| --- | --- | --- | --- |
| Northbound exit, backed up | Lane 1 | Lane 2 | `0,1,2,3` |
| Eastbound entrance, moving, different ingredients | Lane 1 | Lane 2 | `0,1,2,4` |
| Eastbound entrance, backed up, different ingredients | Lane 1 | Lane 2 | `0,1,2,3` |
| Entrance, moving, same ingredient | `1,1,1,2` grab sequence | `2,2,2,1` grab sequence | `0,1,2,3` |
| Entrance, backed up, same ingredient | `1,1,1,1` grab sequence | `2,2,2,2` grab sequence | `0,1,2,3` |
| Exit, backed up, same ingredient | `1,1,1,1` grab sequence | `2,2,2,2` grab sequence | `0,1,2,3` |

The [exit controls](../tests/game/mechanics/belt-pickup/fixtures/front-underground-exit/README.md) first
selected lane 2 supercapacitors, then lane 2 accumulators after swapping ingredients. Flipping mirroring with
the swap retained selected lane 1 supercapacitors. This isolates lane preference from ingredient order.
The front inserter physically blocks continuation: changing a config setting would not create a freely moving
front-exit experiment. Actual moving front-exit grabs remain unmeasured.

The [entrance controls](../tests/game/mechanics/belt-pickup/fixtures/front-underground-entrance/README.md)
retain the ingredient drain for moving supply and remove only that loader for backed-up supply. Both
mirroring states were measured under both conditions. Existing half-tile reach explains the different-item
timings, allowing the two stream phases in the moving comparison. Same-item controls demonstrate fallback
only when the preferred moving lane lacks a reachable stack; backed-up controls leave the other lane untouched.

**Impact:** Sidecar captures mirroring-selected `near_lane` and half-tile reach for exits (introduced in
0.10.0) and entrances (reserved 0.11.0). The simulator's explicit lane/reach rules already explain the grabs.
Classifier rotations are tested; actual grabs in all other cardinal orientations, arbitrary arrival phases
and repeated front-pickup hands have not been established by this series.

## Side-loading onto a straight pickup tile

The [side-entry report](../tests/game/mechanics/belt-pickup/fixtures/side-loaded-straight/README.md) contains
the layouts, images, detailed timelines and reproduction commands. Distances below use **1/256 tile** units.

### Single incoming stream

For an eastbound receiver fed from the south, both incoming lanes feed receiving lane 2. Incoming lane 2 is
the inner stream and lane 1 the outer stream; reflecting the layout swaps those physical lane numbers.
Measured entries are **67** for the inner stream and **188** for the outer stream. A crossing preserves
residual movement: `new_position = entry - (speed - previous_incoming_position)`.

| Belt speed, gate release 16 | Outer-only offsets | Inner-only offsets | Both-stream first hand |
| --- | --- | --- | --- |
| Turbo | `0,1,2,4` | `0,2,4,6` | `0,1,2,3` |
| Express | `0,1,2,4` | `0,1,4,6` | `0,1,2,3` |
| Fast | `0,1,2,4` | `0,4,8,12` | `0,1,2,3` |
| Transport | `0,1,2,4` | `0,4,12,20` | `0,1,2,3` |

At turbo release 17, both single-stream first hands change to `0,1,3,5`; the two-stream hand remains consecutive.
Turbo reflection and the other three cardinal rotations of the inner stream agree with the corresponding
rule. Fifteen single-lane moving first-hand replays match, with phase aligned from pre-pickup observations.
Removing only the drain gives `0,1,2,3` in the three initial backed-up controls. The inner stream accumulates
only three stacks within its reachable span; that first-hand result does not establish infinite repeated supply.

**Impact:** `pickup_supply` separates `through`, `side-inner` and `side-outer` from physical reach. Supported
single-stream profiles require continuously saturated, same-speed supply and one-tile straight geometry.
Backed-up availability remains a separate choice. The expanded side-entry matrix contains 42 controls,
including the later repeated and boundary experiments; these counts overlap rather than add.

### Repeated turbo two-stream merge and falsified candidates

Both full incoming lanes merge into one receiving lane. Four-item stacks, a 16-item hand, a clear other
receiving lane and a single consumer define the supported topology. Destination inventories are cleared after
observation in the repeated routing probes, so those probes isolate supply and pickup rather than crafting.

| Independent repeated control | Measured result and significance |
| --- | --- |
| Gate release 16 | 512 samples, 45 complete hands, 180 grabs; all hands `0,1,2,3`. Observed grabs: 135 outer, 45 inner. |
| Gate release 17 | Same hand totals and 3:1 split; admits an entry shift of 89, falsifying the original maximum-64 candidate. |
| Pause after tick 124, resume after 156 | Disabled ticks 125–156; next grabs 158–161. Finite stock persists through the pause. |
| Remove outlet after 124, restore after 188 | Three downstream tiles fill with 12 stacks; backpressure and later release require shared receiving/downstream stock. |
| North/south reflection | Physical lane/stream roles swap; the same entry constants and queue rule match. |
| Outer iron / inner cable | 41 complete and three partial hands, 167 grabs, all outer; complete hands `0,1,2,4`. |
| Outer cable / inner iron | Same physical stream wins after ingredient swap, excluding fixed recipe order. |

Each of these seven comparisons checks **all 511 consecutive transitions**, including incoming, receiving and
downstream IDs, positions, items and counts, using the production supply and pickup logic. Observed external
refill events and arm start/drop timing isolate supply behavior; they do not independently predict feeder/arm
timing. The 3:1 ratio is a result of these same-item controls, not a universal stream-priority ratio.

The release-17 counterexample narrowed the entry boundary. Ten independent seeded native controls establish
that integer shifts **89–95 are accepted and 96 is rejected**, including outer-absent boundary controls.
Temporary compressed gaps are real: followers wait or move less until spacing opens, never move upstream.
Sub-unit boundaries were not calibrated.

**Impact:** `pickup_merge` uses two incoming queues and finite shared receiving/downstream stock, with
spacing, outlet state and backpressure. Entry positions remain 188/67, turbo movement is 32, normal spacing
64, and accepted entry shifts are strictly below 96 within the receiving tile. Existing item selection still
applies after routing. A separate generated gear clock held **60/60 periods**.

An operating mixed-ingredient control, without inventory clearing, finished 1,200 ticks with **16 iron plates,
zero cable and zero products**. Once outer iron is no longer accepted, pickup stops opening inner-stream gaps.
Preparation now detects that repeating stalled state. An earlier run whose gate stayed closed is excluded
from this evidence. Supported capture describes routing; it cannot guarantee that a mixed merge supplies a recipe.

Sidecar's supported turbo merge requires the bounded straight topology, one pickup and four-item stacks.
An outlet is a closed physical end or a loader into an unfiltered disposal chest. Extra/rear streams, unequal
speeds, other stack sizes, downstream junctions and competing pickups remain unsupported. `pickup_supply`
and `pickup_merge` are alternatives, not simultaneous assumptions.

### Express counterexample and deferred speeds

At express speed, all 45 hands still fill consecutively, but matching hand counts conceals different routing.
At tick 19 an inner entry needs a shift of 72, contradicting the earlier 64 cap. At tick 27 the candidate
admits a stack the game holds because of a nearby upstream follower: increasing the cap alone is insufficient.
Native totals are **119 outer / 61 inner**, rather than turbo's 135/45. The first source sequence is
`1,1,2,2`, rather than the candidate's `1,1,2,1`.

**Impact:** express merge support was deferred. Subsequent investigation intentionally focused on turbo;
other speeds can be backfilled later. Single-stream speed checks do not validate two-stream arbitration.

## Natural splitter controls retained on master

Direct splitter pickups remain warning-only. The following tests document why neither straight-belt reach,
a fixed delay nor a global “backed up” switch is a substitute for local routing.

### One splitter: ingredients, mirroring and priority

The [single-splitter fixture](../tests/game/mechanics/belt-pickup/fixtures/splitter/README.md) is an eastbound
turbo splitter with right output priority, north input, a draining north output and a locally blocked south
pickup port. After 1,200 ticks of natural warm-up, captures run for 60 ticks with an operating machine.
There is no belt seeding, held-item editing or destination clearing.

- Original first-hand iron grabs occur at capture ticks `2,3,4,5`; the next four hands fill at offsets
  `0,1,2,4`. Ordinary saturated pickup would incorrectly predict a consecutive second hand.
- Swapping only ingredients selects cable on physical line 7 with unchanged timing. Mirroring with the swap
  retained switches to iron on line 8. At this south port, preference is line 7 unmirrored, line 8 mirrored.
- Removing only the drain yields six consecutive four-grab hands, starting every 11 ticks.
- Unsetting output priority with the drain retained gives first-hand ticks `2,3,4,7`. An identified stack is
  on input line 1 at position 19 on tick 4, then north output line 5 at one-quarter tile on tick 5, while the
  south pickup is empty. The delay is caused by diversion, not an extra pickup tick charge.
- Unsetting priority with the drain removed retains the six consecutive hands in this one-consumer control.
  That result does not generalize to serial consumers.

Six additional [routing controls](../tests/game/mechanics/belt-pickup/fixtures/splitter/routing-controls.md)
cover the following independent changes:

| Change from the routing baseline | First hand / observed origin lines |
| --- | --- |
| Left output priority toward the drain | No grabs in 60 ticks |
| Cable filter | Cable at `2,3,4,5`; origins `8,2,8,2` |
| Iron filter | Iron at `2,3,4,5`; origins `7,1,7,1` |
| Feed the south input instead | Iron at `2,3,4,5`; origins `7,3,7,3` |
| Reflect pickup to north output, unmirrored | Cable at `2,3,4,5`; origins `5,3,5,3` |
| Mirror only that north pickup | Iron at `2,3,4,5`; origins `6,4,6,4` |

An ID last seen on an input can route and be consumed in the same tick; its last observed line is not proof
that an inserter reaches the splitter input. Filtered supply also does not override machine eligibility:
the iron-only control stops after one hand with 16 iron, while cable supply permits three hands and 48 cable.
These six controls plus the six baseline/priority controls remain native regressions on master.

### Two serial splitters and two consumers

The [two-inserter fixture](../tests/game/mechanics/belt-pickup/fixtures/splitter-two-inserters/README.md)
contains **two serial splitters**, not two pickups on one splitter. Both south pickup ports are blocked;
the first north output feeds the second north input, and both consumers feed one machine. Each independent
control uses a fresh save, 1,200-tick warm-up and 120-tick capture without inventory/held-item interventions.

| Independent control | Upstream first hand | Downstream first hand |
| --- | --- | --- |
| Both right priority, original ingredients | Iron, `2,3,4,5` | Cable, `2,3,4,5` |
| Both right priority, swapped ingredients | Cable, `2,3,4,5` | Iron, `2,3,4,5` |
| Swap retained, upstream mirroring flipped | Iron, `2,3,4,5` | Iron, `2,3,4,5` |
| Swap retained, downstream mirroring flipped | Cable, `2,3,4,5` | Cable, `2,3,4,5` |
| Both priorities unset, original ingredients | Iron, `2,3,4,7` | Cable, `2,3,4,7` |
| Only upstream priority unset | Iron, `2,3,4,7` | Cable, `2,3,4,5` |
| Only downstream priority unset | Iron, `2,3,4,5` | Cable, `2,3,4,7` |
| Both unset, final drain removed | Iron, `2,3,4,5` | Cable, `2,3,4,5` |

Each mirroring flip independently confirms line 7 unmirrored versus line 8 mirrored for the tested approaches.
Priority isolation locates the first-hand delay at the changed splitter; identified stock diverts through its
north output while machine inputs remain eligible. Ingredients, gate timing and mirroring stay fixed for
the priority comparisons.

Removing the final drain restores both first hands, but the upstream second cable hand then grabs at
`13,14,15,18`, while downstream grabs at `13,14,15,16`. Downstream withdrawals reopen the through route: at
tick 16 a cable stack routes north while the upstream hand remains at 12 items. A closed final outlet thus
does not imply permanent local saturation. Another long wait, cable at `58,59,60,88`, is explained by the
shared machine's insertion limit of 39, rather than absent belt stock. These are bounded captures, not
steady-state throughput measurements.

**Impact:** preserve unsupported-splitter classification. Keep ingredient eligibility separate from finite
routing; neither these controls nor the following calibrations authorize splitter generator support.

## Shelved splitter calibrations

### Archive and scope

The later work is preserved at commit
[`7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a`](https://github.com/abucnasty/clock-generator/commit/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a)
on `feature/turbo-splitter-support`. Sub-PRs
[#239](https://github.com/abucnasty/clock-generator/pull/239),
[#241](https://github.com/abucnasty/clock-generator/pull/241) and
[#242](https://github.com/abucnasty/clock-generator/pull/242) merged into that feature branch only.
The integration proposal [#240](https://github.com/abucnasty/clock-generator/pull/240) was closed after the
scope decision to warn on splitters. The archived implementation, probe and calibration tests are **absent
from master**. Links in this section use the frozen commit so they remain useful without implying support.

The first experimental replay matched all eight lines of a naturally fed right-priority baseline through
**60 consecutive transitions**, including native IDs, positions, items and counts. It seeds stock once;
feeder arrivals come from the preceding upstream observation and consumer withdrawals from measured grabs.
Four compact transition cuts were retained for offline regression. Baseline landings at 64 units were an
observation at that phase, not a universal entry constant.

Independent calibration then disabled all inserters, cleared transport stock and seeded exact positions.
Initial positions were asserted: in this setup, native insertion materializes a pending 32-unit movement,
requiring insertion-coordinate compensation. Early incorrect seed placements are not boundary evidence.
Each control starts a fresh native session; captures run four ticks, or ten for follower/upstream cases.
No held items are edited. These artificial stock arrangements isolate routing, not clock throughput.

### Measured local routing rule

For the calibrated north-input, right-priority turbo layout, distances use 1/256 tile units: input length
**179**, output length **128**, normal stack spacing **64**, movement **32** per tick. The experimental kernel
fits the following order:

1. Advance existing output stock, respecting spacing and the blocked south end; drain stock leaving north.
2. An input head at `p < 32` can enter the preferred south output at free position `p + 45`. Shift behind
   existing output stock if necessary; the final landing must be **strictly below 128**.
3. If that output cannot accept it, overflow in these controls requires an input follower at `q < 96`.
   The alternate free landing is `q - 19`, also constrained by output stock and bounds. An isolated head waits.
4. Advance remaining input stock with spacing and an end stop at zero.
5. An ordinary upstream head at `u < 32` proposes input entry at `179 + u - 32`, shifted behind the input
   tail by at least 64. Accept only a final position **strictly below 179**; otherwise it stays upstream.
6. Apply the externally measured consumer withdrawals after routing in the natural-baseline comparison.

This is a calibrated candidate for that layout. It is not a supported public simulator contract or a rule
for all splitter priorities, filters, ports, stack sizes, serial networks or speeds. The follower dependence
fits without additional remembered-choice state; it does not prove that every splitter behavior is memoryless.
Recorded transport-line connectivity identifies possible paths, not the chosen route of a particular stack.

### All 30 independent controls

`p` is the initial input head, `q` its first follower, and output positions describe preferred line 7 before
movement. Unspecified outputs are empty. Every listed stack is four iron plates unless noted. “Wait” means
no immediate transfer; it is not a claim of infinite deadlock. Full trajectories, not only these summaries,
were compared across all eight lines.

| ID | Initial arrangement / independent change | Observation |
| --- | --- | --- |
| S01 | `p=0`, preferred empty | Landing 45 |
| S02 | `p=19`, preferred empty | Landing 64 |
| S03 | `p=31`, preferred empty | Landing 76 |
| S04 | `p=32`, preferred empty | First move to zero; next tick land at 45 |
| S05 | `p=0`, output `[0]` | Landing shifts from 45 to 64 |
| S06 | `p=19`, output `[32]` | Output advances to zero; landing 64 |
| S07 | `p=19`, output `[33]` | Existing stock at 1; landing 65 |
| S08 | `p=19`, output `[44]` | Existing stock at 12; landing 76 |
| S09 | `p=19`, output `[45]` | Existing stock at 13; landing 77 |
| S10 | `p=19`, output `[95]` | Existing stock at 63; landing 127 accepted |
| S11 | `p=19`, output `[96]` | Proposed 128 rejected; next tick landing 96 |
| S12 | `p=19`, output `[0,96]` | Isolated head waits through capture; output compresses to `[0,64]` |
| S13 | `p=19`, output `[32,96]` | Same isolated-head wait after output advances |
| S14 | `p=0`, output `[0,64]` | Isolated head waits |
| S15 | S14, seed input last | Same wait; insertion order does not explain it |
| S16 | S14, line 8 also full of cable at `[0,64]` | Same wait |
| S17 | S14's head supplied through ordinary upstream belt instead | Enters input at 160, reaches zero on tick 6, still waits through tick 10 |
| S18 | `p=0, q=64`, output `[0,64]` | Head diverts north at 45; final isolated follower waits |
| S19 | Input `[0,64,128]`, output `[0,64]` | Successive heads divert; final isolated stack waits |
| S20 | `p=0, q=65`, output `[0,64]` | Alternate landing 46 |
| S21 | `p=0, q=128`, output `[0,64]` | Waits until follower advances inside the overflow window |
| S22 | `p=0, q=146`, output `[0,64]` | Initially waits; later diverts as follower advances |
| S23 | `p=0, q=147`, output `[0,64]` | Initially waits; later diverts as follower advances |
| S24 | `p=0, q=65`, preferred empty | Preferred landing 45, rather than alternate landing 46 |
| S25 | `p=0, q=95`, output `[0,64]` | Alternate landing 76 accepted immediately |
| S26 | `p=0, q=96`, output `[0,64]` | First waits; next tick alternate landing 45 |
| S27 | `p=19, q=83`, output `[0,96]` | Alternate landing 64 even while the output follower is moving |
| S28 | Input `[0,64,128]`, output `[0,64]`, upstream `u=0` | After routing, incoming stack shifts to input position 160 |
| S29 | Input `[18,82,146]`, output `[0,64]`, upstream `u=0` | Incoming stack shifts to 178 and is accepted |
| S30 | Input `[19,83,147]`, output `[0,64]`, upstream `u=0` | Proposed 179 rejected; stack remains upstream |

### Hypotheses these controls rejected

| Hypothesis | Counterexample |
| --- | --- |
| A fixed splitter delay or ordinary backed-up belt covers replenishment | Natural priority isolation and serial-consumer controls change local routing and later availability. |
| Output entry is always 64 | S01–S04 vary input phase and yield 45, 64 and 76. |
| A free landing must fit without shifting | S05 shifts the landing from 45 to 64. |
| Entry stops below 77 | S09 accepts 77; S10 accepts 127, while S11 rejects 128. |
| A blocked preferred output always causes diversion | S12–S17 leave isolated heads waiting. |
| The wait is solely a direct-seeding artifact | S15 changes insertion order; S17 reproduces waiting after ordinary upstream admission. |
| Any input follower enables immediate overflow | S21–S23 wait; S25 accepts follower position 95 and S26 waits at 96. |
| Overflow requires already-stationary output stock | S27 diverts while the existing output follower still advances. |
| Upstream admission can ignore input-tail spacing | S28–S30 require shifted positions 160/178 and reject 179. |

The final experimental kernel matched all **30 independent native controls** and the naturally supplied
60-transition baseline. Eleven replay tests and five kernel tests covered compact native cuts, finite
withdrawals, conservation, snapshots, repeat keys, validation and upstream admission. Those are archived
research checks. No generated splitter clock was verified; generation jobs were skipped on the feature-base
sub-PRs, even though their engine/UI checks passed. The work was shelved before shared-supply integration,
capture support or public configuration support.

### Archived artifacts and reproduction boundary

The frozen sources preserve enough detail to inspect or deliberately resume the research:

- [Calibration test and complete variant matrix](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/tests/game/mechanics/belt-pickup/splitter-entry-window.game.test.ts)
- [Seeded native probe](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/tests/game/mechanics/belt-pickup/fixtures/splitter/entry-window-probe.lua)
- [Finite routing kernel](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/src/state/turbo-splitter-supply.ts)
- [Kernel regressions](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/src/state/turbo-splitter-supply.test.ts)
- [Replay regressions](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/tests/game/mechanics/belt-pickup/splitter-replay.test.ts)
- [Compact native baseline cuts](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/tests/game/mechanics/belt-pickup/fixtures/splitter/right-priority-transitions.json)

For read-only inspection from a checkout containing the archived commit:

```bash
git show 7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a:clock-generator/tests/game/mechanics/belt-pickup/splitter-entry-window.game.test.ts
```

Do not run that absent test path on master. Reproduction requires a separate checkout of the archived commit,
its dependencies and the configured Factorio harness from the [game guide](../tests/game/README.md).
The archived test accepts a fresh `SPLITTER_ENTRY_CAPTURE_DIR`; each variant creates its own session.
The archived future-integration plan is historical, not an approved current roadmap.

Historical ignored evidence directories include `work/splitter-support/replay-01/original/`,
`entry-final-02/`, `kernel-entry-final-01/`, `kernel-baseline-final-01/original/` and `kernel-format-01/`
under the same `work/splitter-support/` root. The final kernel entry run contains all 30 controls; the
earlier entry run contains 27. No fresh native runs were needed to consolidate this record.

## Related queued experiment: turbo belt drops at stack sizes 1–4

The [drop calibration](../tests/game/mechanics/belt-drop/fixtures/turbo-stacks/README.md) uses a finite
32-iron chest, legendary stack inserter and three turbo tiles draining into a receiving chest. After a
120-tick empty-source warm-up, 32 items are added once. Only `force.belt_stack_size_bonus` changes; the probe
asserts researched technologies are unchanged. No hand or belt stock is seeded.

| Belt stack size | Effective full hand | First native deposit ticks | Next hand's first deposit |
| --- | --- | --- | --- |
| 1 | 16 | `6,7,8,10,12,…,34` | 42 |
| 2 | 16 | `6,7,8,10,12,14,16,18` | 26 |
| 3 | 15 | `6,7,8,10,12` | 20 |
| 4 | 16 | `6,7,8,10` | 18 |

Every deposit and intervening empty tick agrees with `Belt::amountToDropAtTick`. Size 3 deposits 30 total,
leaving two items held at tick 120 while waiting for a full effective hand. Source, held stock, belts/loader
and receiving chest conserve all 32 items throughout every capture.

**Impact:** add size-2/3 offline expectations and four native regressions; no production timing change was
needed. Other belt speeds remain deferred.

## Coverage and release boundary

### Capture compatibility findings

Warnings alone were insufficient: saving a build could discard its warning and later make an unsupported
pickup look like an ordinary belt. The [capture/config boundary](pickup-capture.md) now persists
`source.pickup_capture` through import, editing, saved results and worker/direct-engine entry points.
Supported declarations currently name `belt` or `turbo-two-stream`, with `model_version: 1` and matching
geometry, lane and supply inputs. Unsupported captures retain native type/name, reason and exporting version.
Recognizable legacy Sidecar exports without a positive declaration become unclassified; existing warnings
become persistent unsupported status. Unknown model names or versions are refused.

Updating either program does not promote an old unsupported capture: the user must recapture with a Sidecar
that supplies the newly supported model's inputs. A mod version alone is not a support declaration. Manual
configs keep their straight-belt default; old saved files that already lost provenance cannot reliably be
distinguished from manual configs. Regression coverage includes saved/reloaded configurations, editor/form
round trips, worker/direct simulation refusal and actual straight, underground, splitter and merge exports.

### Accepted scope

The accepted scope includes ordinary straight/underground pickup, same-item fallback, explicit geometry and
backed-up supply, front-underground mirroring capture, supported single-stream side profiles, the bounded
turbo two-stream merge, mixed-merge stall detection and persistent capture provenance. Fixture reports retain
their detailed commands, screenshots and limitations; the mechanics index links the runnable master tests.

Splitter routing remains explicitly out of scope. The archive does not justify accepting unsupported captures,
adding a fixed delay or treating splitter stock as infinitely backed up. Express and other uncalibrated merges,
sparse/arbitrary-phase supply, other stack sizes, broader orientations and competing-consumer networks must
not be inferred from the scoped successes above.

This documentation consolidation adds no simulator or Sidecar implementation and performs no publication.
Keep the existing unreleased changelog entries and publishing hold until release is explicitly authorized.
