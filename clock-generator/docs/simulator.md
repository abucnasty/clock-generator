# Simulator goals

This page was split out of GOALS.md on 2026-10-15; GOALS.md holds the goals.

## Simulator Goals

This project actively runs a simulation of the machines, inserters and mining drills that are in the configuration file. It simulates all their crafts and transfers every tick. Infinity chests and input belts are endless supplies, and fluids are left out. Moving belt pickups time reachable stacks each tick by the rule below. Omitted pickup length defaults to one tile; ordinary backed-up supply retains finite stock and refills gaps at belt speed. The simulator models each entity's game statuses and is checked against recordings and provides state transition logs in debug mode to provide insights into what each entity is doing and a description for why it wanted to transition to a different state. Any deviation from the game is measured by running "scaffold" tests. These tests are driven by having a "scaffold" blueprint paired with a configuration file. Any scaffold can be tested directly in factorio. The `clock-generator-recorder` can help record and run this scaffold and provide per tick entity statistics to compare against the simulator. This is a verification process that the simulator backing the algorithm is doing the right thing. A scaffold test checks both goals against the game: that every window cycle moves exactly the expected output, and that the simulator counts the wakeups the game shows. It also lays the simulator against the game entity by entity: a run of the same clock in the simulator has to move what the game moved through every inserter and finish what it finished in every machine. For that the simulator writes its run in the format of the recorder, so that one set of functions reads both (`clock-generator/src/verification/compare-recordings.ts`); `npm run verify` makes the same comparison for any recording.

### Scope of the mechanics evidence

The [mechanics experiments](../tests/game/mechanics/README.md) keep each observation beside its scenario and limits. The [activation-order replay](../tests/game/mechanics/activation-order/README.md) supplies observed notifications and wake/sleep outcomes; it does not derive the factory behavior that caused them. The [busy-input](../tests/game/mechanics/busy-input/README.md), [source-pickup](../tests/game/mechanics/source-search/README.md) and [circuit/carried-hand](../tests/game/mechanics/circuit-evaluation/README.md) records distinguish selected game actions from observation-induced checks. Their bounded counts do not establish production rates or prices. The simulator's dispatch, the update list (`clock-generator/src/simulation/dispatch.ts`), follows these observations.

### The status of an inserter

The status the game shows for an inserter is decided by its sink before the inserter itself, and not by what the inserter carries. It is defined in `clock-generator/src/state/factorio-entity-state.ts` and was derived from recordings of five scaffolds in Factorio 2.1.21.

- An inserter that is switched off by its circuit condition shows as disabled from that tick on, even while it finishes the swing and the drop it had already started. A window of 4 ticks shows as 4 ticks that are not disabled.
- The status is a tick ahead of what the inserter does. It takes nothing in the first tick it shows as enabled, and it can still take in the first tick it shows as disabled, never after that. So an inserter acts in as many ticks as its window has, the first one included, and the simulator enables it for exactly those.
- With an empty hand, it is waiting for space in the destination whenever the sink takes nothing from anyone: the output of the machine is at its output block, or every ingredient is at its insertion limit, and its fuel is at its limit too. This is shown even while the arm is still swinging back.
- With an empty hand and a sink that still takes something, it is working while it swings back, and waiting for source items once there is nothing for it to take. This is also what it shows when the sink is full of the one item this inserter brings.
- With a hand it is still filling, it is waiting for more items between pickups.
- A full hand is working, until it cannot be dropped in one go. A hand goes onto a belt one stack at a time and shows as waiting for space in the destination in between.

### What an inserter takes off a belt first

With an empty hand, prefer the configured pickup lane's item when the destination can accept it. Beside a belt,
this is the nearest lane. Centered downstream of an underground entrance or exit and facing back into it,
mirroring selects lane 2 when mirrored and lane 1 otherwise. Once a hand contains an item, continue collecting
that item until the hand is full or the destination stops accepting it. Explicit filters restrict which items may
be collected; they do not override a supplied `near_lane`. Without `near_lane`, item selection keeps the
filter/recipe order and matching physical lanes are tried in their config order.

### Picking up from moving belts and underground endpoints

The [consolidated experiment record](belt-pickup/experiments.md) documents the measurements, rejected
hypotheses and generated-clock checks behind these scoped rules.

**Take one reachable stack per tick: preferred lane first, then the other lane if the preferred lane has none of the item being collected. Leave a hole and keep the remaining stacks moving at belt speed.**

- Saturated lanes have stacks a quarter tile apart. Take the upstream-most reachable stack on the selected lane,
  capped by that lane's stack size and the remaining hand capacity. There is at most one stack total per tick.
- A straight belt exposes **one tile per lane**. Either underground entrance or exit exposes **half a tile per lane**.
  The model assigns no fixed lane-switch delay; an underground has less pickup space, rather than a fixed tick
  penalty. Collection also checks the calibrated arm-extension reach below.
- Lane phases, holes and partially taken stacks persist between hands, across closed windows and when inserter
  controls change. Each lane keeps its own remaining stacks.
- On **backed-up supply**, items stop between pickups and the belt refills gaps. A stack is available each
  pickup tick in the measured turbo first hands, but slower belts can exhaust reachable stock. Ordinary through
  supply uses a bounded queue: stop the head at the endpoint, retain quarter-tile spacing, and refill gaps at belt
  speed. Holes and partial stacks persist across hands; geometry still limits reach. Capture does not infer supply motion from a snapshot.

For example, four grabs from one moving turbo lane can occur at `0,1,2,3` on a straight belt and `0,1,2,4` or
`0,1,3,5` underground, depending on phase. With the same item in four-item stacks on both saturated lanes, the
measured 16-item hands filled at `0,1,2,3` on all three geometries: the far lane supplies a grab when needed.
These are offsets from the first grab, not an arm-arrival or wakeup timing rule.

`source.pickup_length` describes physical reach: **1** tile for a straight belt (the default when omitted), or
**0.5** for either underground endpoint. This default applies both when parsing a config and when constructing
entities from a direct engine input. There is no legacy calculation selected by omitting geometry.
The UI defaults to a straight side pickup. Underground inputs require a specific `source.pickup_layout`: side
entrance/exit, front entrance/exit, or over the exit hood. Layout supplies omitted length; conflicting length is
rejected. Sidecar exports layout with model format 2; older underground captures require recapture. See the
[capture guide](belt-pickup/capture.md#physical-layout).

Supply is a separate choice: **Moving** by default, or **Backed up** with `overrides.backed_up_belts: true`.
The simulator retains the pickup length in both cases. Moving supply models reachable stacks, holes and partial
stacks; ordinary backed-up supply additionally stops and compresses stacks at its closed endpoint.
Older `non_moving_belts` config settings migrate to `backed_up_belts` on import. New configs and exports use only
`backed_up_belts`; if both keys are present, the new key takes precedence. Saved results retain their run's assumptions. Older manual underground configs must choose a layout;
physical approach cannot be recovered from half-tile reach alone.

The [lane model](../src/state/belt-pickup-lane.ts) stores only holes and partial stacks in an otherwise evenly spaced
supply. The [belt's pickup port](../src/simulation/components/belt-hand-pickup.ts) chooses the physical lane. No whole-belt
simulation or extra search dimension is involved.

Calibration: Factorio 2.1.21, legendary stack inserters, four-item belt stacks, all four belt speeds (#245), and pickups
from both sides of an eastward belt. Belt pickup timing is calibrated with 16-item hands on four-item belt stacks
only: pickup from one- to three-item stacks was never measured, and the 8- and 12-item hands of the same-item probes
are seeded checks on moving turbo and express belts. Both are [Not tested](belt-pickup/experiments.md#belt-stack-sizes-and-hand-sizes);
the generator warns about such a pickup and does not refuse it (follow-up F7). Same-item probes checked 5,268 uninterrupted hands across 78 captures,
including hand sizes 8/12/16, interrupted windows and staggered turbo lanes; subsequent grabs and lane contents
matched when seeded with the observed first grab, remaining stacks and phases. Game regressions compare actual
simulator grabs and default-clock throughput/recovery on the [same-item fixtures](../tests/game/mechanics/belt-pickup/fixtures/same-item),
and retain the [different-item electromagnetic checks](../tests/game/mechanics/belt-pickup/fixtures/different-items).
Regressions with backed-up turbo belts isolate each ingredient and check the default clock's throughput and recovery on all
three electromagnetic scaffolds. Detailed measurements and reproduction commands live with those fixtures.

One [front-facing underground exit case](../tests/game/mechanics/belt-pickup/fixtures/front-underground-exit/README.md)
also matches the existing simulator: a mirrored inserter north of a northbound exit selects lane 2 supercapacitors
and fills its first backed-up hand at offsets `0,1,2,3`. The config explicitly supplies `near_lane: 2` and
`pickup_length: 0.5`; neither lane is physically nearer. Sidecar 0.10.0 captures this front-exit preference from
inserter mirroring and exports half-tile reach. Sidecar 0.11.0 also captures an inserter upstream of an exit and facing with belt travel as
`pickup_layout: "over-hood-exit"`, with half-tile reach and lane 1 unmirrored / lane 2 mirrored.
Other unsupported inline pickups remain unclassified. Swapping the lane
ingredients changes the selected item to accumulators while retaining lane 2 and
the same grab offsets, supporting lane preference over fixed recipe order for this orientation. Flipping only
the inserter with those swapped ingredients selects lane 1 supercapacitors, again at `0,1,2,3`; the simulator matches
with explicit `near_lane: 1`. A front exit cannot carry moving supply: its input stands on the exit's output tile.
Other cardinal orientations remain unverified.

An [inline underground entrance case](../tests/game/mechanics/belt-pickup/fixtures/front-underground-entrance/README.md)
checks an unmirrored inserter east of an eastbound entrance. It selects lane 1 accumulators with both moving and
backed-up supply. Its first hand fills at `0,1,2,4` moving and `0,1,2,3` backed up, consistent with half-tile reach
and the separate supply rules above. The moving comparison allows the two turbo stream phases rather than
inferring an initial phase from the blueprint. Flipping only the inserter's mirroring changes selection to lane 2
supercapacitors under both supply conditions, retaining those grab offsets. Sidecar 0.11.0 exports `near_lane: 1`
unmirrored or `near_lane: 2` mirrored, plus half-tile reach, without warnings in all four game cases. Capture
keeps supply motion separate from geometry. Classifier rotation checks cover all cardinal directions; actual
entrance grabs in other orientations and repeated hands remain unmeasured here; the backfill below adds ingredient swaps and speed/phase controls.

The entrance's [same-item moving case](../tests/game/mechanics/belt-pickup/fixtures/front-underground-entrance/README.md#same-item-on-both-moving-lanes)
also follows the existing fallback rule in both mirroring states. With accumulators on both lanes, the preferred
lane supplies three grabs and the other supplies the fourth: `1,1,1,2` unmirrored or `2,2,2,1` mirrored. Both fill
at `0,1,2,3` instead of the different-item controls' `0,1,2,4`. The position replay matches both lanes after
seeding the observed first grab; the simulator supports each measured hand and lane sequence for one turbo phase.
These first-hand measurements do not calibrate absolute arrival or initial phase.
The [same-item backed-up controls](../tests/game/mechanics/belt-pickup/fixtures/front-underground-entrance/README.md#same-item-on-backed-up-lanes)
fill at the same offsets while keeping every grab on the preferred lane: `1,1,1,1` unmirrored or `2,2,2,2`
mirrored. The other lane stays stationary and untouched. The existing backed-up availability rule matches the
hand counts; half-tile geometry and lane preference remain separate from the supply setting.
The [same-item front-exit controls](../tests/game/mechanics/belt-pickup/fixtures/front-underground-exit/README.md#same-item-on-both-lanes)
also fill at `0,1,2,3` entirely from lane 1 unmirrored or lane 2 mirrored, leaving the other lane untouched.
The front inserter blocks the lane past it, so these are backed-up measurements.

The [four-speed backfill](belt-pickup/experiments.md#belt-speed-coverage) now measures side pickups,
front-entrance moving/backed-up controls and front-exit backed-up controls at turbo, express, fast and normal
speeds. Normal moving front-entrance controls use a paired compact destination to respect underground range.
The historical timing examples above describe turbo fixtures.

The production [backed-up queue](../src/state/backpressure-pickup-lane.ts) matches held quantities and exposed stock
in all 48 ordinary backed-up captures, including both physical near sides, after a single full-stock seed.
That comparison is given the game's arm arrival and drop; run from placement with neither, the whole simulation
reproduces those captures too (see [Starting on supplied belts](#starting-on-supplied-belts)). The legendary stack inserter also retains
its radial collection reach between grabs. Advance it toward the selected stack by the prototype's extension
speed (0.25 tile per tick at legendary); collect when within one more extension step. The physical layout
places each stack relative to the pivot. Keep reach while a partial hand waits or controls change; discard its
history from repeat detection once the hand is empty/full, since the next hand initializes its own reach.

This matches all 198 side-pickup arrival phases and all 96 ordinary/reflected repeated-hand controls, including
the normal moving entrance's four delayed phases. Sixteen fresh controls check all eight normal entrance
phases from both physical near sides. This collection constraint is calibrated for through supply and
legendary stack inserters; a belt pickup by any other inserter is refused (#260).
Collection replay alone does not establish generated-clock parity; absolute arrival from placement is the startup
contract below, for side and over-the-hood pickups (front pickups are measured from their first hand only).
Generated clocks are checked in the game separately: the ordinary side pickups, the over-the-hood exit and the
front entrance and exit each have native clock controls ([experiments](belt-pickup/experiments.md#generated-clocks-and-drops)).

Scope remains one controlled through supply. Pickups from a side-loaded tile, with one side stream or two
merging onto the pickup lane, are out of scope and refused, as are pickups from a splitter; see the
[experiment history](belt-pickup/experiments.md#side-loaded-pickups-and-merges). A belt fed through a splitter further
upstream is modelled as a plain belt, which is wrong when the splitter's other output takes items: moving supply arrives slower and backed-up refill can lag. Sparse supply, shared upstream
withdrawals, other bend approaches, other orientations and arbitrary relative lane phases remain unverified.
A moving front exit cannot be built: the inserter on the exit's output tile blocks the belt. A config that says
moving supply gets a clock for moving belts there anyway; on the backed-up exit the game holds it, with recovery
at every tier ([generated clocks](belt-pickup/experiments.md#generated-clocks-and-drops)). Clocks are made only for the
belts the config names. At normal speed a backed-up belt refills a pickup slower than a stack a tick: the half tile of
an underground end holds three stacks in reach and the fourth comes 8 ticks later, so a hand takes 10 ticks. A window
read off the planning run is as long as the hand there took, which is shorter where that hand had started before the
window or had waited for its machine while the belt refilled; a hand that starts in it from another start is cut. So
on backed-up belts every belt-fed window lasts at least as long as a hand takes from the lanes at rest
(`backpressureHandTicks`, the same queue), where that is slower than a stack a tick (#456): the normal side underground
entrance and exit and the front exit get a stable clock for backed-up belts. Until 0.23.0 they got one planned with the
belts moving (recorded exact then); the new clocks hold in the game as well, exact in baseline and after every cut (#479).

### Starting on supplied belts

A run of a clock starts as the harness's staged start does, and the simulator predicts every hand from there: the
first one included, with no arm arrival, drop or later lane state taken from the game. Recorded in Factorio 2.1.21
(#273, [experiments](belt-pickup/experiments.md#startup-from-placement)).

- **Placement.** A cold start (`cold_start`, `runClockOnBuild` and `simulateClockOnly`) has every machine, buffer and
  hand empty, every bar at 0 and the supplies full; a recipe that makes its own ingredient gets
  `overrides.kick_start_items` once. The clock starts with the run, at its tick 0; there is no free run before it. Every
  inserter starts at rest with an empty hand over its pickup and goes through its phases (pickup, swing, drop, swing
  back) from the first tick.
- **The arm.** A new hand needs no travel to its first stack: the calibrated legendary stack inserter's collection
  reach starts each hand at the first stack it collects, and moves at the prototype's extension speed between the
  grabs of one hand (above).
- **A backed-up supply** is a full queue of full stacks, a quarter tile apart, at rest at the endpoint: the same at every
  start, so it has no phase.
- **A moving supply** has every slot of each pickup lane filled, moving at the tier's speed `u` (in 1/32 tile a tick:
  normal 1, fast 2, express 3, turbo 4). Its phase `p` (0-7, in 1/32 tile) puts the stacks at tick `t` at `p - u·t` mod 8.
  A trial starts at phase 0 unless an internal run option (`moving_pickup_phases`) names others; the lane-phase checks
  sample the rest. In the game the phase is wherever the stream stands when the clock starts.
- **The frame.** The simulator's tick `t` of a run is the clock's; its `held[i]` (after tick `i + 1`) is the
  recorder's sample `i + 4` of a staged start, and a lane at native phase `q` (read off the pickup tile at the
  placement tick) is at model phase `q - 4u` mod 8. Measured at all four tiers; status labels lead by a tick, so the
  frame is set by held counts, never by status edges. Probes that release an input by script at tick `g` see its first
  stack at `g + 2`.
- **The clock's start.** A clock of the game counts from 1 at its start, and a window decider is open for its window's
  clock values only, so for the first `CIRCUIT_LATENCY_TICKS` (2) ticks after the clock starts no window reaches an
  inserter. The simulator moves every window by that latency, so a window that ends in the window cycle's last two positions,
  or a start inside a window, carries into ticks 0-1 of each window cycle; at the clock's start those ticks stay dark
  (`ClockedEnableControl.reset`). A run starts its clocks as its warm-up starts (or the judged run, with no warm-up); a
  later step and a disturbance trial's continuation are no start. A fuel inserter's clock of its own is moved by no latency in
  the simulator and so leaves nothing dark. Recorded on 57 clocked cold starts: the 48 side-pickup cold starts of the
  generator's recommended clocks (four tiers, both near sides, straight belt and both underground ends, moving and backed
  up), and nine more started inside an input window, with the deciders or the inserters built in reverse, or the build
  moved, on side pickups and over the hood. In the 11 where the start matters the game follows the rule; the simulator
  holds what both clocked inserters held in every tick in 56 of 57 (in the other one later hand comes a tick early, a
  separate case: [experiments](belt-pickup/experiments.md#startup-from-placement)).

Not covered: a belt state a harness protocol leaves behind (the speed-coverage calibration's surplus stock is a
harness state, not a placement); front pickups, whose first hands are measured from the game's arrival; machine-level
start-up dips; inserters other than the legendary stack inserter; and convergence from other live states (one modelled
cold start, see [stability](stability.md)). Never checked tick for tick in the game: a subtick clock's first ticks and a
fuel inserter's own clock (see [experiments](belt-pickup/experiments.md#startup-from-placement)).

### Captured pickup provenance

[Pickup capture status](belt-pickup/capture.md) is saved on each imported source. Only an explicit supported model
with matching geometry and lane data can drive generation. Unsupported and legacy unclassified pickups
remain unverified after save/reload or version updates; update Sidecar and recapture when support is available.
Manual configurations keep the straight-belt default. A newer engine does not reinterpret an old unsupported
capture as a supported source.

**Side-loaded pickup tiles, merges and splitters are out of scope.** A config that names `source.pickup_supply`
or `source.pickup_merge` is refused, and so is a capture that Sidecar marks unsupported with the reason
`side-loaded` or `splitter`. See the [experiment history](belt-pickup/experiments.md#side-loaded-pickups-and-merges).

### A stack inserter dropping onto a moving lane

A legendary stack inserter deposits one belt stack per successful tick. Output packets persist between hands,
so the empty-belt burst is available only when the receiving space permits it. With four-item stacks, an empty
tile gives deposit offsets `0,1,2,4` on turbo, `0,1,2,5` on express, `0,1,4,8` on fast, and `0,1,8,16` on normal.
A normal belt's next hand can instead use `0,8,16,24` because the previous hand still occupies the tile.

The simulator keeps a finite queue at each drop spot, in 1/256-tile units:

- Move packets downstream at belt speed (8/16/24/32 units per tick). Followers stop behind preceding packets at
  quarter-tile spacing (64 units); an already compressed gap reopens without moving a packet backwards.
- Try to place a new packet one movement step beyond the nominal drop spot, or behind preceding stock when
  necessary. Its landing position must be strictly less than a quarter tile behind the nominal spot.
- An insertion may temporarily compress an upstream follower's gap. Keep that packet and let it wait for space.
- Retain packets between hands and control replacements. Forget them after they pass every drop spot's reach.

To share this queue between output inserters, give every sink on that belt a `drop`, for example
`{"lane": 1, "position": 12.5}`. Lane numbers follow the belt config's lane order; positions are tiles along the
path, increasing downstream from one common origin. Negative and fractional positions are allowed. Either all
output inserters on a belt specify geometry or none do. Without explicit geometry, each inserter uses an
independent local tile at position 0.5 and retains its own output stock; the config does not imply that these
unknown spots collide.

The [drop calibration](../tests/game/mechanics/belt-drop/fixtures/turbo-stacks/README.md) covers all four speeds
and belt stack sizes 1–4, with a finite source and unchanged research. Portable native clips check every source
quantity, held quantity and receiving-tile position from a disabled start. Additional occupied-output controls
check the landing cutoff and compressed gaps. Stack size 3 uses full hands of 15 and leaves the final two items
waiting in the hand. `Belt.amountToDropAtTick` remains an empty-belt reference; runtime drops use actual space.
The existing turbo shared-lane regressions retain their 4-, 6-, 14- and 22-tick drop patterns.

This local output rule assumes a freely draining downstream lane. A blocked lane is a belt that refuses the product
(a disturbance, see [stability](stability.md)): the output inserter holds its hand from the tick the belt stops
taking, where the game first fills the belt behind the drop (112 to 192 items on the 104 belt-output clock controls at
stack size 4; 9 to 156 on the blocked-output clocks at stack sizes 1–4, `tests/game/builds/blocked-output-clock-controls.json`).
That moves output between the blocked window cycles and the few after the release (the game is back at its output 0 to 5
window cycles after the release window cycle, the simulator 1 to 6), not what follows: in all 120 recordings every window cycle the
captures judge is the same in game and simulator, and a belt that fills to an infinite end 10 or 25 tiles past the drop
changes no verdict or selection in the blast or on those 16 clocks
([experiments](belt-pickup/experiments.md#generated-clocks-and-drops)). External incoming traffic still needs its own
modeled transport geometry. Other inserter prototypes and qualities remain uncalibrated.

### Drops of several copies onto one belt

The simulator drops each output inserter's hand on a belt of its own, so it never sees the hands of other inserters or of the other copies
on the same stretch of belt. The result says what the lane model above would do with them
(`src/config/drop-spacing.ts`). Output inserters that drop straight onto a belt from the same side, in the same row, are one line; copy `k`
of the unit stands `k` times `setpoint.copy_offset` from it (copies in rows of their own never meet). Seen from the moving belt a hand
that starts at tick `t` at place `p` lies at `(p - v t) mod L` with `v` the tiles the belt moves in a tick and `L = v P` the tiles it moves in
a window cycle of `P` ticks, and takes a quarter tile for each stack of the hand: a hand of 16 at stack size 4 takes one tile. Two hands land on each
other when these stretches overlap. This agrees with replaying `LaneTraffic` on random layouts (`drop-spacing.test.ts`); the replay gives the
ticks a hand waits. On the grenade build (seven copies 12 tiles apart, a turbo belt that moves 14 tiles in 112 ticks) the 14 hands of a line
fit when the inserters of a line start together and land on each other when the two inserters of each copy start 56 ticks apart; in the game a
hand moved one tile off its place waited 6 ticks and the others did not wait. Places come from the exported positions and the side each
inserter takes from, the way the belt runs from Sidecar 0.14.0 (without it the check is made both ways and told only when they agree), and
the gap between copies from the repeated-unit conversion or from the user. A drop marked as side-loading onto another belt is left to the
merge, and the belt is taken to run straight past the inserters.

The result also lists the spacings of the copies (from the width of a copy for one loop of the tiles the belt moves in a window cycle, and the same list at any of these plus a loop; where no spacing can fit, because the hands of a lane outnumber those tiles, it says so instead) and the distances between a copy's two inserters at which the hands fit, and the editor says it before Generate for the time one output hand takes at the setpoint (`src/crafting/drop-room-note.ts`). The idea, the arithmetic of pitches and offsets and the evidence are in [drop spacing](../tests/game/mechanics/drop-spacing/README.md).

### Copies that take from one lane

A clock is made on one copy of the build. Where the copies take from the same lane (a lane's `sharing`, default
`shared`), each clock that holds is run once more with every copy built, each with its own machines, chests,
drills and inserters on the clock of the config's own (`src/crafting/shared-lane-model.ts`). The copies stand in a row,
`setpoint.copy_offset` apart along each lane they share. Without it, a copy's length comes from its positions. Without
positions, its length is the longer side of its widest machine or drill. The result says the spacing it assumed. Each
shared lane runs tick by tick with every copy's takers on it (`src/state/shared-lane.ts`): stacks come on at the
lane's `supply_rate`, move at the belt's speed and leave at its end (`lane_end`: a dead end holds them, an infinite
end takes them at the lane's capacity; an unknown end is run both ways). A
part copy holds its share of each shared lane's takers, rounded up for each, the ones furthest upstream, with what their
machines need. The items on a lane move in the direction of the belt (`flow_direction`). Without it, the check runs
the items in each direction along the copies. The verdict has two checks (`src/crafting/shared-lane-verdict.ts`). First,
a taker that puts down fewer of the lane's items over the whole window cycles of the second half of the run than in a
run of one copy alone is short. Second, a shortfall makes the clock unstable only where a machine or an output inserter
of a copy is behind its target over the same window cycles; a machine of a part copy is held to its share of a whole
copy's target. Where nothing is behind, the shortfall is stock that moved between the two runs, and the clock holds
([stability](stability.md#copies-that-share-a-lane)).

Standing: on the clocks recorded on #660 (three copies on ore lanes that flow into loaders) and #725 (5.5 copies on
dead-ended lanes) and on logistic science 240 (11 copies) the run gives the game's verdict on every copy. The size of a
loss can differ (#660, Takt Batches with 6 swings: copy 3 about 5 of 6 hands an inserter against 4.9 in the game).
Limits: the row is straight, so a row folded back on itself or mirrored is run as if it were straight; a belt the build
drops onto is not run with every copy on it (the result names its lanes); side-loads, merges and splitters on a shared
line are not modelled, except on an output belt that the config states (below). Each copy's machines are its own, so
machines two copies share in the game are not.

### The output belt of the copies

Where a config states its output belt (`output_belt`), the run of the copies moves every stack on it in each tick
(`src/crafting/output-belt-run.ts`). The stacks go from the output inserters of the copies to the infinite end. The config
states tiles. The engine makes the lines of each lane from them (`src/config/output-belt.ts`,
`src/entities/belt/join/output-belt-join.ts`). The join model moves the stacks on the lines in each tick
([belt join](../tests/game/mechanics/belt-join/README.md)). It has each side belt and its join, and the joins of the
copies in order. It has the lane change onto an underground entrance and a copy's drop onto a stretch. It has the
splitter with its loop, and the infinite end. The infinite end is a loader at the end of the last stretch. A config without the
section runs as before: each output inserter drops on a tile of its own.

An output inserter puts its stacks on the middle of its drop tile, with the rule above. A stack goes one step past the
middle, or 64 behind the stack ahead. It must be less than 64 behind the middle. On a free side belt, a hand's stacks go
down 0, 1, 2 and 4 ticks after it comes. A stack stays in the hand only when the side belt is full to its drop tile. On
the automation science 240 build, that is 8 stacks, as in the game. In the game, that build's drops show the stacks at
96, 128, 160 and 160 from the end of the drop tile. Behind a full side belt, they are at 153 and 185.

An output blockage of the product shuts the infinite end: the belt lane is blocked from draining to the belt it joins. Every
lane upstream backs up from there. A hand is held only when its side belt is full. The blockage does not refuse the
product at every drop. The end changes from the tick after the next. In the game, an end that a script changes acts
from the next tick. The state of a repeat holds every stack on the output belt, by its line and position.

Recorded on AUTOMATION_SCIENCE_240, nine copies (Factorio 2.1.24, 2026-11-11):

- The tiles alone give the travel that the recordings show. A drop takes 13 ticks to its join, and 2 more to leave the
  exit's line. Copy 4's stacks take 414 ticks from its join to the splitter, through the lane change. Copy 8's take 120.
  Copy 9's take 122 from its drop. Copy 5's take 84 from its drop tile to copy 6's join.
- The lane change gives 414 only when the side load lands on the entrance's own line, the upstream half of its tile.
- Two clocks leave copies short in the game: 4cc378b0763b and 73f5b0448482. On both, copies 4 and 8 are short, and the
  other copies hold. The output inserters of copies 4 and 8 take more than 5 ticks from the first stack to the last in
  80 of 320 hands. The game has 15 of 61 and 14 of 60. Only the third hand of a window is held. On the selected clock
  (b1490c9f2c49) every copy holds, as in the game.
- The infinite end was shut at clock value 54 for 864 ticks on the selected clock. The engine gave the game's packs in every
  window cycle on copies 1, 2, 4 and 6. On each other copy, 2 or 3 window cycles are different by 4 to 16 packs. The packs lost
  are the game's on all nine copies. Copy 5 stops 613 ticks after the cut, the game 608. Copy 9 stops at 493, the game
  at 496.

What the join model does not establish ([belt join](../tests/game/mechanics/belt-join/README.md#limits)), and how often
the runs of this build reach it:

- Two sender lanes onto one lane of a straight belt agree with the game only in the shape of the loop. This build's loop
  has that shape.
- In the ticks after a build, the game can put a stack one step (32) off at a cut between two of its lines. The run of the
  copies starts with no build. So this is a limit of the recordings, not of the run.
- Not measured: a stack of the receiving lane at 68 to 70 at a join onto an underground exit. Not measured: a contest
  onto an underground entrance. The generation of this build makes 968,144 landings onto an exit and 230,539 onto the
  entrance, the trials included. No landing onto an exit has a stack at 68 to 70, in the generation or in the blockage.
- The runs reach a contest onto the entrance: 6,756 landings in the generation, and 806 in the blockage, have a stack of
  the receiving lane behind the side head's own spot. The layout has no line that feeds the entrance's lane from
  upstream. So each such stack is an earlier stack of the same lane change, in a lane that is full.
- The splitter: "none" for a priority is refused. An output looks at the stack ahead on the next line. One held-out copy
  shows this, and no hand-over of this build's runs needs it. The back end takes only the head of the input with the
  priority (24 of 24 held-out copies). 105,273 hand-overs of the generation go to the back end.
- Two side belts onto one tile are refused only with a `copy_offset` of zero. The infinite end's loader and a lone underground
  exit's line (128) come from the module's lengths and the recording of the build. A side head that lands past the end
  of a lone exit's line stays on that line. No landing of this build's runs does this.
- The model shuts the infinite end's loader. The game test removes the loader. So the model's loader line holds two more
  stacks a lane while it is shut.
- The recording of the selected clock was replayed through the model, from its first row. From row 6,000, the model
  holds the game's stacks on every recorded line, with one exception: the last stack of the loop's first line in a
  standing queue. The game keeps it at the back of the curve's inner lane, 81 behind the stack ahead. The model keeps it
  64 behind. The number of stacks is the game's. Why is not established.
- The recordings of the two clocks that leave copies short start in the middle of a run, and the splitter's own lines
  are not recorded. Their replays do not come to the game's stacks in their 3,200 rows, at the splitter's right output,
  the loop and copy 9's stretch. The replay of the selected clock from the same row does not either. Whether the model
  agrees with the game at the splitter on those clocks is not established.

### Two inserters that bring the same item

When two inserters bring the same item to a machine, one of them can be left holding it. If it starts picking the item up after the other has already put it in, the item is at its insertion limit by the time its hand is ready, and it holds the hand until the machine has used enough for it to drop.

That alone only costs time. It is a deadlock when the inserter that is stuck is also the one that brings another ingredient. While it holds the first item it takes nothing else off the belt. If the machine then runs out of that other ingredient while the first is still at or over its insertion limit, the machine cannot craft, the first item never goes down, and the inserter never lets go. The build stays that way for good, whatever the clock does afterwards.

This is a risk of the build, whatever the items are: a machine with an inserter that brings two items, where another inserter brings one of the same items. Whether it happens is a matter of the timing of the two inserters against each other. This rule comes from my own testing of the game.

Seen on the utility science sample in Factorio 2.1.21 on 2026-10-10, under uneven output swings with backed-up belts: the machine held 16 processing units, 16 low density structures and no flying robot frames, the inserter that brings the frames held 12 low density structures, and the build made 0 of 192 in each of 53 window cycles. Under batched swings it made 192 in each. The simulator has the deadlock: started in that state it stays in it. None of its checks gets a build into it.

The generator reads the risk off the config alone, with the items of an inserter that has no filters worked out from its belt and its machine (`clock-generator/src/crafting/deadlock-risk.ts`). A build that has it is named as a deadlock risk wherever its clocks are listed, and copying the blueprint of one of its clocks warns which two inserters share which item. On such a build the verdict of the disturbance trials does not decide the selection, since the trials do not see the deadlock: its clocks that hold their expected output are ranked as they were before a clock had to go back to its rate after a loss, by their wakeups.

### Two inserters that take from one machine

In the measured intervals below, inserters waiting with empty hands follow a stable local order when taking one product from one machine: the first takes up to its hand, the next what is left, in the same tick, and the one that took last is not passed over. This is not a universal game scheduling rule. The simulator uses a fixed order for each run (`clock-generator/src/simulation/competing-takers.ts`): the takers of each machine are updated in one order for the whole run, among the places the list gives them.

Recorded in Factorio 2.1.21 (2026-10-26) on the supercapacitor plant of the original pink science scaffold of #100, two stack inserters taking its supercapacitors into two science plants, 4,800 ticks of both copies: of the 62 ticks that show which was served first, the same one was on 59; on 28 and 31 of the contested ticks both gained in the one tick (the plant held 20, both hands were empty, and the next tick one held 16, the other 4 and the plant 0); and on the 6 ticks where a rule of turns would have passed the last taker over, it was served again. Over 3,600 window cycles the favoured branch made 99.9% of its plant's maximum and the other 95.7%, one hand short every 59 window cycles, which the fixed order predicts by arithmetic alone. Re-read against the pentapod egg biochambers of agricultural science (#90, the build a rule of turns was first fitted to), four recordings of two saves: on every contested tick with one taker served it was the same one of the two (63 of 63 and 111 of 111 a machine), also on the 4 and 6 ticks right after it had taken.

Which of them the game puts first is not known. In the #100 recording it was the one built first, which stands west and has the lower export id; on the agricultural science scaffold it was the inserter into the science biochamber, on one machine the lower unit number and on the other the higher, so it is not the unit number alone there. A config carries no build order, so the generator does not choose one: a clock is checked under the declared order samples ([stability](stability.md), "How a clock is started"). `tests/game/mechanics/staged-start/taker-order.game.test.ts` builds the agricultural science scaffold from the staged start twice, its inserters built in ascending and in descending config order, so that the unit numbers of each pair of egg takers come out the other way round, and records 150 window cycles (2026-10-26): on both egg biochambers the same inserter was served first in both builds (the one into the science biochamber: on 17 of 18 or 23 of 23 of the ticks that showed an order, in each build), so the order is not the build order and not the unit number, and the place of the inserter stays the best guess. The generator still does not choose an order.

Open: takers that both hold part of a hand. The recordings above show the order only where the takers waited with empty hands (status "waiting for source items"). On the agricultural science scaffold on the 2-swing clock (recorded 2026-10-26, 36,000 ticks from the staged start), on the ticks where both takers of an egg biochamber held part of a hand and one alone took, the inserter into the other egg biochamber was served first on 26 of 33 and 22 of 35 ticks, not the one into the science biochamber; on 45 of the 51 of those ticks where the two had gone to sleep at different ticks, the one that went to sleep first was served. The simulator serves them in its one fixed order, and with that the build runs out of eggs in its 12th window cycle (given a kick start of the 84 eggs the game takes), where the game moved 800 in every one of the 27 window cycles from the 11th to the 37th. This is one recording of one build: the measured empty-hand intervals show a stable order, while the partial-hand intervals show a varying order, with the earlier sleep preceding the next pickup in most of those observations. The default simulator still keeps a fixed order for each run for both kinds of hand. A clock is kept only if it holds under the declared order samples, so it may reject a clock that the game runs well (the 2-swing agricultural science clock, and the 5-swing clock of the egg-biochamber variation at speed 80).

Before 0.23.0 the simulator had a rule of turns instead: the one that took last was passed over while another waited and the machine held less than a hand, and the order of config ids decided only from a hand up. It split a machine's output evenly where the game gives one taker all it can use.

### When a waiting inserter acts

An inserter that waits for space in a machine is in sleep, and acts in the tick after the one that wakes it. Two things wake it: the machine finishes a craft, or another inserter takes the machine's products. So when the output inserter takes a machine down from its output block, an inserter that was waiting to put into it takes its first items one tick later. Only when the machine finished a craft in the tick before the products were taken was it on the update list already, and then it takes them in the tick they are taken. An inserter whose arm comes back in that tick is not held up. It is defined with the machine's wake flags in `clock-generator/src/simulation/components/machine-wakes.ts`, and applied by the idle rule of an inserter's hand and by the pickup of a hand from a belt.

Recorded in Factorio 2.1.21 on the scaffolds, on inserters that take from a machine or a chest and had waited 6 ticks or more: the first items came a tick later in 5,777 cases of 5,777 where no craft was finished the tick before, and in the same tick in 3,756 of 3,756 where one was. A hand from a belt that stopped part way at the output block goes by the same rule (843 of 843 and 248 of 248). A hand from a belt that had not started lands its first stack a tick after the products are taken either way.

A hand from a belt that had not started and waited for an ingredient at its insertion limit is woken by the machine's own craft start, which takes the ingredients (see [wakeups](wake-ups.md)), and lands its first stack in the tick after that start (2026-10-20, #266). The simulator updates machines after inserters, so it finds the room in that tick too, and the pickup phase takes the stack there without the tick it waits after products are taken (`wokenByItsMachinesCraftStart`, `clock-generator/src/simulation/components/machine-wakes.ts`). Recorded in Factorio 2.1.21 on the normal moving underground pickups from cold starts at chosen lane phases: in all 102 such resumes of the first runs the game took its first stack in the tick after the craft start, where the simulator took it a tick later; at a window's last enabled tick that lost the stack to the next window, and at the exit's natural lane phase it lost one stack in window cycle 5 and settled into a cycle of six window cycles, at 143 a window cycle against 176. With the rule the simulator moves what the game moved, window cycle by window cycle, from 51 of the 64 lane-phase starts of each build, its output inserter tick for tick, and from the other 13 once they settle; those 13 first part where an input window opens in the same tick as the output inserter's on a machine at its output block, which the rule below for windows that open together decides (#267, #268). With both rules it follows the game from all 64, tick for tick. All 128 starts are pinned as native controls (`tests/game/builds/lane-phase-controls.json`, `normal_underground`), five of them never settling in the game. A hand that stopped part way at the insertion limit is not recorded, and keeps the tick.

An inserter whose window opens in the tick the products are taken is held up as well (decided on 2026-10-14, issue 152). The game shows an inserter on a clock as enabled the tick before its window, and it waits in that tick: it finds the machine at its block, and is in sleep on it when the products are taken. So it takes its first items a tick later, also where the machine finished a craft in the tick before. Where the inserter that takes the products has a window that opens in that same tick too, the order their deciders were built in decides (below). Recorded in Factorio 2.1.21 on inserters that take from a machine, on the accumulator build of the issue and on the scaffolds: a tick later in 1,158 of 1,170 cases where the inserter that took the products was enabled before (44 of 44 where a craft finished the tick before), and in the same tick in 852 of 888 where its window opened too. The 12 are at one sample of the agricultural science recording; the 36 are at one place in the cycle of seven window cycles the 0.9.0 clock of the accumulator build settled into, where the same window a window cycle later takes its items in the tick, which was not checked against that clock's decider order. Recorded since on the same build under an even hands clock whose windows all start at 0 (2026-10-14, see "Even hands" under "Wake-up Lists"): at the one place in the window cycle where all its windows open together, the iron and battery inserters of both accumulator plants took their first items a tick later in all 300 cases (4 places in the window cycle), though the output inserter's window opened in that tick too. That is the decider order: the output inserters' decider is that clock's first, built before those of the iron and battery inserters. The simulator, which took them in the tick until it had the order (#268), takes them a tick later too. No verdict changes with it: game and simulator both move 288 every window cycle.

A hand from a belt is held up by a window that opens on a machine at its output block as well (2026-10-16). An inserter that takes from a belt and waited for its machine goes on a tick after the products are taken in either case, which the pickup phase has. A window that opens starts the pickup from the disabled phase, though, and has no such tick: the inserter finds the machine at its block, is in sleep on it when the products are taken, and takes its first stack 2 ticks after its enable (waiting for space, waiting for items, then the hand grows), where the simulator took 1. So `wokenThisTick` (the idle rule of an inserter's hand, `clock-generator/src/simulation/components/hand.ts`) holds a belt-fed inserter up when its window opens on a machine whose block was lifted in that tick, by the same rule as for a machine source, and leaves the belt source out only where no window opens. Recorded in Factorio 2.1.21 on the scaffold of the utility science 480 build (222 windows): the belt-fed inserters whose first status after the enable was waiting for space in the destination took their first stack 2 ticks after it in 1,373 of about 1,470 windows (the rest wait longer for other reasons), and 1 tick in 329 of 329 where it was waiting for source items; the machine-fed inserters took 1 tick in 4,202 of 4,204 windows. With the rule the belt-fed inserters of a simulated run stay in step with that recording for hundreds of ticks longer (inserters 14 and 15 through all 8,000 ticks checked), where lifting the exclusion for every case parted two of them at tick 40. Not settled: of the other recordings with belt-fed inserters, one Thaeln clock took 2 ticks in 1,322 of about 1,450 waiting windows (supports it), another 2 ticks in 326 and 1 in 108 (mixed), and two recordings have too few cases; two windows of the first recording go the other way. No settled rate of that scaffold moves with it.

Where the window of the inserter that takes the products opens in that tick too, the order the clock's window deciders were built in decides, for an inserter that takes from a belt as for one that takes from a machine (2026-10-20, #268). The game updates the inserters a tick enables in the reverse of the order their deciders were built, the last built first. So an inserter whose decider was built before the taker's is updated after it, sees the products taken, and takes its first items in that tick; one whose decider was built after the taker's is updated first, finds the machine still at its block (it shows "waiting for source items"), and takes them a tick later. Where the taker puts the products, onto a belt or into a machine or a chest, plays no part, and neither does where the deciders stand. Recorded in Factorio 2.1.21 on 9,189 of 9,189 windows that opened on a machine at its block with the taker's, over fifteen runs: clocks of the chemical science, accumulator and advanced circuit builds and of the normal underground pickup, each built in its own order, in reverse, and with the deciders' entity numbers reversed in their own places. Every group of windows changes sides with the order, none with the drop target (#268; the recordings were not kept in the repository). #267 had read it as the taker's drop target, a tick later in 1,327 of 1,327 windows where the taker drops onto a belt and in the tick in 602 of 602 where it drops into a machine or a chest: the generator's blueprints build the output inserters' decider first, and an intermediate machine's taker mostly after its inputs. Built the other way round, #267's own run of the chemical science build swaps its two groups, 82 and 166.

A check of a clock has the order the clock's blueprint builds its deciders in: one decider for each set of windows, whatever the inserters and drills carry (the inserters outside the plan, a by-product inserter, by their items too), in the order of the first entity's id as a string, the fuel clocks of their own after them (`deciderBuildOrder`, `clock-generator/src/crafting/decider-order.ts`; checked against the exported schedules of every sample). A take in the first tick of the taker's window marks the machine with where the taker's decider stands (`windowOpeningTakeDecider`), and `wokenThisTick` lets an inserter whose window opens in that tick too go in it only where that decider was built after its own; where either is not known, a tick later. The simulator updates the inserters that take from a machine before those that put into it, also where competing takers of another machine are served in another order (`inserterUpdateOrder`, `clock-generator/src/simulation/competing-takers.ts`, the order of the inserters phase of the tick's table, `clock-generator/src/simulation/tick-phases.ts`), so the rule is met by every such window. With it the simulator replays each of the fifteen runs in its own order with every group on the game's side, the battery plants of the accumulator build included (iron in the tick, copper a tick later, where it had them the other way round), and follows the 128 lane-phase starts of the normal underground pickups and the eight staged cold starts of the same builds that preceded them tick for tick.

The entry for this rule in the shared mechanics docs (factorio-benchmarks, docs/mechanics) is pending.

A hand that an inserter takes from a machine stops filling while the machine it puts into takes nothing of its item, as a hand from a belt does: it keeps what it holds, also through a closed window, and goes on once the machine is under its block. Recorded: such a hand did not grow in 20,701 samples of 20,701 with products to take where the machine it puts into was at its output block, and grew in 11,561 of 11,561 where it was not. It is in the machine's pickup port as a hand reaches it (`clock-generator/src/simulation/components/machine-hand-pickup.ts`).

Without these two rules the clock version 0.9.0 selected for the accumulator build of issue 152 (640 a second over 18 copies; `resources/config-samples/intermediates/accumulator/accumulator-320.json` now holds abucnasty's later build of nine copies at 320 a second) made 512 to 544 of its 576 a window cycle in the game, in a cycle of seven window cycles, where the simulator had 576 in every one. The iron and battery inserters of the accumulator plants opened their windows in the tick their output inserter, on its way back from the belt, took the products, and took their hands a tick later than the simulator had them; the battery inserters held 13 of 16 batteries through their closed window where the simulator filled the hand in its last tick. With the two rules the simulator has that clock at 512, and the clock it selects instead made 576 in each of 58 window cycles in the game, after 3 at 544 while it settled from the scaffold's start.

That one tick decides whether a clock holds when its windows are as long as the hands they are made for. Under a clock for the advanced circuit build with windows of 4 ticks for the inserters that take off a belt, the game made 608 and 624 of 704 a window cycle in turn, where the simulator made 704. One of the two plants had fallen two hands of plastic and of cable behind the other. Its output stood over the output block for the ticks before every output window, the plastic and the cable inserter whose windows opened in those ticks took their hands a tick after the output inserter had cleared it, and a window that was a tick short for it lost a hand: 192 of 256 plastic, 384 of 512 cable and 264 of 352 products a window cycle. With this rule and the output block above, a run of the simulator that starts in the state the game was recorded in holds what every machine and every inserter of the game held, tick for tick, for the 36,372 ticks the recording goes on, and so it does for the recording of the clock tightened by hand that holds 704.

That clock has two states, and the game was in both: one plant made its 352 a window cycle and the other 264, under the same windows. Which one a machine ends up in is decided by what it holds when the clock starts. In the earlier filled-start generator, with machines full of ingredients and emptied of products, the simulator held 704 from every place in the window cycle and classified the clock as meeting goal 1. In that investigation, starting the plants short of ingredients instead fell short from 12 of 108 starts, where the tightened clock and the clock from version 0.5.0 got back to 704 from all 108. Those observations are historical evidence, not the current startup contract. Current clock trials start with full input supplies, empty machines, buffers and hands, phase 0 and the configured one-time kick start (default 200), and with the clock's first latency ticks dark (see [Starting on supplied belts](#starting-on-supplied-belts)); planning still uses a separate prepared build. Optional extended checks sample other cold clock phases and competing-taker orders actually listed in `assessment.start_dependence.starts`, not filled or free-running builds. Neither those samples nor the disturbance trials prove convergence from every live inventory or build order (see [stability](stability.md)).

### Products a machine cannot put out

A machine starts a craft whatever its output holds, and the products are made when the craft finishes. If they do not fit under the stack size, the machine holds them and starts no craft until they do. It puts them in its output in the first tick there is room, in whatever state the machine is: working, short of ingredients or at its output block. In a tick the inserters act first and the machines after them (the order of a tick, phase by phase and step by step, is one table: `clock-generator/src/simulation/tick-phases.ts`), and the recorder samples at the end of the tick. So when an inserter takes products from a machine that holds some, the machine puts them in during that same tick, and one sample shows both, though the machine has nothing left to craft with. Seen in the game on the agricultural science build from the staged start: the two nutrient machines held 40 nutrients behind a full output, an inserter took 32 and the output read 88 in the sample of tick 92, where the simulator, which put held products in only while the machine was working, read 48. With the rule they agree through the first 600 ticks. A full productivity bar is still paid in the working tick, not before. The statistic `products_finished` is not changed by it: the simulator counts a craft when it finishes, the game when its products are put in the output.

Held products reach the output at once, so a machine whose output was taken down to just under its output block can be put back at the block by them, and its inserters then bring nothing until the output is taken down again. On the utility science build with the direct insert chain and always-on inserters, the casting machine of low density structure held 2 behind a full stack of 50; the inserters took it down to 18 (the block is 19), the 2 are put in at once and the plastic inserter waits. Before, the 2 stayed held until plastic came, which is the fault the rule removes. The 3-swing batched clock for that build moves 192 a window cycle in the simulator when the held products wait, and 176, 160 and 144 in turn (180 a second of 240) when they do not.

### Cars, wagons and rocket silos as chests

Since 0.20.0 a car, a tank, a cargo wagon and a rocket silo are chests of mixed items, modelled slot by slot (`src/state/slot-inventory.ts`, `src/state/rocket-silo-inventory.ts`). Recorded in Factorio 2.1.21 on five builds compared with the simulator inserter by inserter (`tests/game/mechanics/containers/`): 339 of 339 hands, 120 of 120 container slots and every silo inventory equal, at two places; and on six clocks through a car, a tank or a wagon, which hold their setpoint and have recovery in the game (`tests/game/builds/container-clock-controls.json`).

- **Where an item goes.** First into the slots filtered to it, in slot order; then it tops up the free slots that hold it; then it fills empty free slots in slot order. A slot filtered to another item never takes it. A hand that does not all fit goes in in part, and the rest waits in the hand.
- **What an inserter takes.** The item of the last slot that holds one it may take, from that slot and then the slots before it; a hand that holds some of an item takes only more of it.
- **Blocked slots.** A slot filter `{slot, blocked: true}` is a slot that inserters cannot fill, as the game's No item and Deconstruction planner filters make it. It adds no capacity and no item. Sidecar exports both game filters as blocked slots, and a config that names either as a slot's item is read as blocked.
- **A rocket silo.** The ingredients of its fixed rocket part recipe go into its input slots, a whole hand at a time while the slot holds less than the automated insertion limit (2 at crafting speed 1). Any other item, and the ingredients when the recipe is of another quality, go into its rocket inventory while the rocket lifts their weight (1,000,000; the game holds weights in 1/65536 parts). An inserter takes only from the rocket inventory. No craft is run.
- **Two inserters in one tick** (a known limit, listed in `src/rules-of-the-game.ts`). Which of two inserters acting on one container in the same tick goes first follows the order they were built in, the last built first, as for the clock deciders above; the simulator serves the inserter with the lowest config id first. Built the other way, two of the five builds split the container differently in the game. The placement rules hold in both orders.
- A car or wagon at the end of a line fills up or runs dry; moving trains are not modelled.
- **A mining drill into a chest** (since 0.20.0, a drill's `target` of type `chest`). The drill drops what it mines as far as the chest has room, by the chest's own rules: the free slots of a car, a tank or a wagon in slot order, the rocket inventory of a silo by weight, a buffer chest of its item. What does not fit stays in the drill, which mines no more until it has dropped it: a full chest stops the drill. Since 0.20.0 it is clocked just in time from the windows of the inserters that take from the chest ([drills.md](drills.md#a-drill-into-a-chest-on-a-clock)), unless the config sets it to always enabled. Recorded in Factorio 2.1.21 (`tests/game/mechanics/containers/`, at two places): a big mining drill on iron ore into a car (4,000 ore in its 80 slots), into a car with five slots filtered to copper plates (3,750 ore, the five slots empty), into a steel chest (2,400) and into a rocket silo (500 ore in its rocket inventory, nothing in its input slots), each emptied by one stack inserter. The containers end as the simulator has them, slot for slot, with every hand equal, and fill by the simulator's amounts in every tick from the drill's first drop (see [drills.md](drills.md)).
- **A container used as a hub** (since 0.20.0). While the build warms up, an inserter that takes an item from a car, a
  tank, a wagon or a silo that the build fills waits until the container holds as much of that item as it can, not until
  it is full of every item: a wagon that machines both fill and empty, as in a smelting chain around one wagon, is full of
  its later items only once its earlier ones have been taken.
- **A product that leaves through a container** (since 0.20.0). Where the inserters that take the target product out of
  its machine all put it into one car, tank, wagon, silo or buffer chest, and other inserters take it from there onto a
  belt or into a chest, those inserters are the build's output: they get the output swings, the rate and the windows of
  the target. The machine's inserters into the container are planned through it, with the same items a cycle. A product
  that passes through a second container on its way out is refused.

### What an inserter takes from an infinity chest

An infinity chest follows the rule of the chests above: an inserter takes the item of the last slot that holds one it may take. The chest keeps its slots in the game's inventory order whatever its filters say: by item group, then subgroup, then the item, each by its `order` string and then its name (`item_order` in `resources/data-filtered.json`, made by `resources/filter-raw.js`). Its slots have no config, so the simulator gives the hand, of the items the sink takes now, the one that order puts last (`clock-generator/src/simulation/components/container-hand-pickup.ts`). Until 0.27.2 it gave the first in the hand's order instead (the sink's ingredients, or the inserter's filters).

Recorded in Factorio 2.1.24: two infinity chests of electronic circuits, copper cable, plastic bars and processing units, with their filters in opposite orders, each feeding an assembling machine of advanced circuits (ingredients electronic circuit, plastic bar, copper cable). Both held plastic in slot 1, cable in 2, electronic circuits in 3 and processing units in 4 in every reading; plastic sorts first by its subgroup though its own order string sorts after cable's. In 24 of 24 starts from an empty machine the stack inserter took electronic circuits, then cable, then plastic, and never the processing units. The containers mechanics test (`tests/game/mechanics/containers/`, builds `infinity-source` and `infinity-source-reversed`) records one start of each chest against the simulator, the chest's slots and every hand. On the chest-fed processing unit build (`PROCESSING_UNIT_15_CHEST_FED`) the game took advanced circuits whenever the plant was under their limit, and its chest kept electronic circuits in slot 1 even when its filters or its slots were swapped by hand.

### A machine that places its results itself

A recycler places its results itself: its prototype has a `vector_to_place_result`, a spot 2.3 tiles in front of it, and it puts them into the container that stands there (a car in the ore voider benchmark), or keeps them in its output where nothing does, for inserters to take (rule 18 of `src/rules-of-the-game.ts`). The config names the machine or container as the machine's `result_target`, as a drill's `target`. Into a machine it uses the same placement code and stop as a mining drill ([drills.md](drills.md#the-stop-into-a-machine)); results the target recipe does not use stay in the recycler and need an inserter to remove them. Recorded in Factorio 2.1.21 on a lab made from the ore voider benchmark's saves:

- **Speed.** Crafts a second are its crafting speed over the recipe's time, several in one tick: 4 a tick at speed 7.5 (47,992 in 11,999 ticks). A recycling recipe takes the original recipe's time / 16 / its result count; ore takes 0.5 s / 16. It accepts no productivity.
- **What comes back, by chance.** An item that cannot be recycled into ingredients (ore) comes back as itself with a 25% chance a craft (0.2511 over 47,992 crafts); a crafted item gives each ingredient's amount / 4, a fraction being the chance of one more (a gear gives an iron plate at 0.4978). Each roll is its own: the returns of a tick follow a binomial of its crafts. The simulator makes a result that comes by chance at its expected amount, the fraction carried to the next craft (`expectedAmount`, which reads `extra_count_fraction` since recyclers are modelled), so a run repeats as any other; the spread is room in the windows (below), not simulated.
- **The stop.** It puts its results in its output whatever that holds, any number of stacks (its 12 result slots, one for each result in the recipe's order), and while a stack of any one result waits there it starts no craft and takes no ingredients: with its car full it stopped with 50 ore waiting, and went on as soon as there was room; on scrap a full stack of the rarest result stopped it as one of the commonest did. With a result target it puts what waits into the container in each of its ticks, as far as the container has room, what that tick's crafts gave included: on the ore voider's exact-speed cell under its clock, nothing was left in its output after any of 216,000 ticks while its car had room. With its car full, 50 ore waiting and its input emptied by script, its four inserters brought it no ore in 600 ticks.
- **Its ingredients.** Ore is both what it takes and what it gives back; it keeps them apart, as a machine whose recipe makes its own ingredient does, and is not given a kick start of it, since it gives back less than it uses. Its insertion limit is the furnace rule's, 100 at the voider's speeds (115 held when stopped, a hand dropped while under it).
- **What takes its results.** At its output an inserter that waits for a full hand (the prototype's `wait_for_full_hand`: the stack inserter only) waits, as everywhere, and any other inserter swings what it holds, the bulk inserter included: on scrap a stack inserter waited with a part hand of holmium ore for 10.5 minutes, and a long-handed inserter swung each low density structure on its own. A taker waiting there, or at the container it places into, is woken by each tick in which it places a result, of whatever item, and by no craft that gives none ([wake-ups.md](wake-ups.md)): the simulator counts those placings (its Placement's `results_placed`).
- **A rocket silo as its result target** takes its results as an inserter's drop would, by item and by its rocket part recipe's quality: at another quality than the build's items every result goes into the rocket inventory, by weight. At normal quality the recipe's own ingredients go into its input slots, where no inserter takes them out (recorded on scrap: processing units and low density structure to a stack and 64, and the recycler stopped for good in 24 minutes), so such a build is refused when it loads, with the silo's `recipe_quality` to set.
- **Quality** is one roll a craft for all its results (75.7% normal, 21.9% uncommon from four legendary quality modules); items have no quality in the generator, so a build of quality modules or mixed qualities is not modelled.

A target that counts the item a recycler destroys (`setpoint.counts: "destroyed"`) is counted at the inserters that bring it in from outside the build, and is planned by arithmetic: the crafts are what is brought over what a craft uses less what comes back into it (4/3 crafts an ore brought for iron ore), every result is taken out of the result target at its expected amount, and the window cycle is the fewest hands brought that last whole ticks. The windows that take a result out of the result target get room for its spread: what a window cycle gives over its expected amount in all but 1 in 740 window cycles, the binomial's own quantile at 0.99865 less its mean, from that result's own chance and the window cycle's rolls (a craft and each productivity payout; `src/crafting/random-margins.ts`). That is the share three standard deviations cover of a normal amount; for a small count the binomial's tail is heavier, and on scrap holmium ore crossed the 3-sigma line about four times as often as 3 sigma says (10 or more in 378 crafts at 1/100: 0.0053 against 0.00135; the quantile is 11). What a machine's crafting has to spare against what comes back is reported, with the ticks over which it covers what comes back at that share, within which the container takes up the rest. The plan makes every taker's hands whole in one window cycle where that window cycle is 24,000 ticks or fewer and the container holds what it gives of every result in all but 1 in 740 window cycles (the ore voider: 144 ticks, 8 of the car's 80 slots); the simulator then runs that window cycle as any other.

#### Results that come by small chances

Where no such window cycle exists (scrap at +300%: holmium ore at 0.04 of a hand a feed cycle of 480 ticks; scrap without productivity: 100 cycles, 48,000 ticks, more than its silo holds), the inserters that take the same results out of the container get one window a window cycle, worked out by arithmetic before anything is simulated (`src/crafting/exhaust.ts`):

- **The window cycle** is the longest whole number of feed cycles, up to 24,000 ticks, whose results the container holds at its worst moment in all but 1 in 740 window cycles. The worst moment is just before an opening, each result counted over the whole feed cycles since its window last opened. What a container holds is measured as the game limits it: a rocket silo's rocket inventory by the weight the rocket lifts, a car, tank or cargo wagon by its slots, each item's own filtered slots first. The share is the quantile of the sum, each result's count a binomial of its rolls (a craft and each productivity payout), the results counted as independent; one roll gives at most one of scrap's results, so their counts are negatively correlated and the sum spreads less than that.
- **Each window** takes, in full hands, what its results give a window cycle at that share, or their expected count and a 32nd of the backlog a lost output leaves where that is more (the container full of the lightest of them and a stack of each waiting in the machine, which the window then drains within the 32 window cycles a disturbance trial gives before the 8 it has to hold). Each inserter there may hold a part hand from the window before, and each result may have a part hand left in the container: up to (inserters + results − 1) × (hand − 1) more. A window of h hands is (h − 1) hand cycles and one tick long, as an inserter starts a hand in every hand cycle of a window.
- **One inserter with several filters** at the container is refused. Holding part of a hand of one of its results, a stack inserter takes only more of that one, so its other results pile up in the container, and once it is full the one it waits for cannot come in: the build stops for good. Recorded in Factorio 2.1.21 on a recycler on scrap placing into a rocket silo, with processing units, low density structure and holmium ore on one filter stack inserter (the simulator does the same): after 47 minutes it held the same part hand at 284 openings in a row with the silo full, and no scrap came in again. Every inserter that takes a result takes only it; several inserters may take the same one.
- **The openings** are spread evenly over the window cycle in the order the recipe lists the results ("Results in turn"), so the container never holds a whole window cycle of every result at once. The inserters that bring the item destroyed get one window a hand, spread evenly, as in even hands.
- **The hands are not whole.** An inserter that waits for a full hand keeps its part hand from one window to the next, so the plan's hands of a result a window cycle are a fraction (gears 9.6) and carried: the window cycle is no multiple of them, and the clock's window cycle is the plan's window cycle. The simulator runs the windows from its start phases and for 20 window cycles after its warmup, and the clock holds when the inserters bring the item in at the target in every judged window cycle, every result the machine placed went into the container (it never waited in the machine's output) and the inserters that take each result took what the crafts gave, within a window cycle's worth and a hand each (`src/crafting/results-taken.ts`), and the arithmetic holds (the container's worst moment within what it holds).

A build of results this rare whose container is a chest of one item or an infinity chest is refused: its room is not known.

A recycler is a furnace prototype: it takes its recipe from the items it is brought, as a furnace does, so a build that brings it an item its recipe does not use is refused (it would switch recipes with the old recipe's results still in it, which is not recorded), and it stops at a full stack of any one result waiting, each result in its own slot. It places its results by its result vector, as a drill drops what it mines into what it faces.

### Mining drills

A drill mines by two progress bars, as the game's does (since 0.20.0): each tick an enabled drill drops what it holds, into a machine up to its stop or into a chest as far as it has room, waits while it holds anything, and otherwise mines. A drill disabled by its circuit keeps what it holds and both bars. The whole of it, with the stop into a machine, mining productivity and the game recordings, is on [drills.md](drills.md).

### Other known limits

- **A window that opens on a machine at its output block** follows hold-up rules with unexplained exceptions (see "When a waiting inserter acts"). One of them (#276): when another inserter takes a machine's products off its output block in the tick a belt hand comes back from its swing, the simulator has the hand take its first stack in that tick. In the game it comes a tick later when the taker drops onto a belt (56 of 56 hands), and by the decider order when it drops into a chest (79 of 79). The game's rule, tried in the simulator, moves no recommended clock. Whether the model takes it on is not decided.
- **A fuel inserter's own clock** runs with no circuit latency in the simulator, while its blueprint encodes the usual two ticks (#276). Neither has been checked in the game. Adding the two ticks changes no clock, verdict or selection, only the wakeup figures of four fuel samples, none of which has a build.
- **The burner energy model** is checked on outcomes only (total burn against the configured rate), never tick by tick against the game.


## Right bend with an upstream pickup

`bend-right-upstream` models the unmirrored legendary stack inserter one tile opposite a right-turn turbo
belt's outgoing direction. In the recorded orientation the belt exits south and the inserter stands north.
The two lanes follow quarter circles of radii 188/256 and 68/256 tile, with exposed lengths 295/256 and
106/256 tile. Collection reach is computed from each stack's position on its arc relative to the inserter
pivot, rather than from a straight-belt radius. Preferred lane 1 is fixed for this approach.

The supplied electromagnetic science build provided 170 measured full hands from backed-up/full-lane
starts on four-item belt stacks: 85 outer-lane hands fill in four consecutive grabs, and 85 inner-lane hands
fill in five ticks for four grabs.
The native-derived fixture in `tests/game/mechanics/belt-bend/right-upstream-hands.json` records the
initial stock and hand positions. Replay begins at the first already-arrived grab; it measures collection,
not absolute arm arrival from placement. A second control on the same physical cell explicitly supplements
four-item stacks upstream and drains downstream to isolate full moving supply. Its 1,039 hands give four-tick
outer-lane fills and seven-tick inner-lane fills; the production pickup model reproduces every hand from the
observed phase and first arm arrival (`right-upstream-moving-hands.json`). The native/model radial difference
stays within 2/256 tile. This controlled supply is calibration only: it is not used in original-scaffold throughput
or recovery runs. With only the original feeders and forced continuous draw, supply is sparse and those separate
captures do not establish full moving supply. Startup, generated-clock throughput and recovery need native
build controls as well. Other bend approaches and belt speeds are not inferred from this measurement.

Sidecar captures this physical layout with model version 3. Old captures marked unsupported are not
promoted by updating the generator; they must be captured again. See [capture and configuration](belt-pickup/capture.md).

## Counting outputs through a buffer

When machines put their target product into a finite container and other inserters take it out of the build,
planning and verification count the drops of those final takers. Transfers from machines into the buffer are
internal movement: uneven batches there do not establish uneven final delivery. If several machines share
the container, each final taker is counted once. The longer-run check uses the same target-path rule as the
planner, including targets that count incoming items destroyed by a recycler.
