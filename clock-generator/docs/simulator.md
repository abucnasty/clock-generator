# Simulator goals

This page was split out of GOALS.md on 2026-10-15; GOALS.md holds the goals.

## Simulator Goals

This project actively runs a simulation of the machines, inserters and mining drills that are in the configuration file. It simulates all their crafts and transfers every tick. Infinity chests and input belts are endless supplies, and fluids are left out. Moving belt pickups time reachable stacks each tick by the rule below. Omitted pickup length defaults to one tile; ordinary backed-up supply retains finite stock and refills gaps at belt speed. The simulator models each entity's game statuses and is checked against recordings and provides state transition logs in debug mode to provide insights into what each entity is doing and a description for why it wanted to transition to a different state. Any deviation from the game is measured by running "scaffold" tests. These tests are driven by having a "scaffold" blueprint paired with a configuration file. Any scaffold can be tested directly in factorio. The `clock-generator-recorder` can help record and run this scaffold and provide per tick entity statistics to compare against the simulator. This is a verification process that the simulator backing the algorithm is doing the right thing. A scaffold test checks both goals against the game: that every clock period moves exactly the expected output, and that the simulator counts the wake-ups the game shows. It also lays the simulator against the game entity by entity: a run of the same clock in the simulator has to move what the game moved through every inserter and finish what it finished in every machine. For that the simulator writes its run in the format of the recorder, so that one set of functions reads both (`clock-generator/src/verification/compare-recordings.ts`); `npm run verify` makes the same comparison for any recording.

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

For example, four grabs from one moving turbo lane can occur at `0,1,2,3` on a straight piece and `0,1,2,4` or
`0,1,3,5` underground, depending on phase. With the same item in four-item stacks on both saturated lanes, the
measured 16-item hands filled at `0,1,2,3` on all three geometries: the far lane supplies a grab when needed.
These are offsets from the first grab, not an arm-arrival or wake-up timing rule.

`source.pickup_length` describes physical reach: **1** tile for a straight belt (the default when omitted), or
**0.5** for either underground endpoint. This default applies both when parsing a config and when constructing
entities from a direct engine input. There is no legacy calculation selected by omitting geometry.
The UI defaults to a straight side pickup. Underground inputs require a specific `source.pickup_layout`: side
entrance/exit, front entrance/exit, or over the exit hood. Layout supplies omitted length; conflicting length is
rejected. Sidecar exports layout with model format 2; older underground captures require recapture. See the
[capture guide](belt-pickup/capture.md#physical-layout).

Supply is a separate choice: **Moving** by default, or **Backed up** with `overrides.backed_up_belts: true`.
The simulator retains the pickup length in both cases. Moving supply models reachable stacks, holes and partial
stacks; ordinary backed-up supply additionally stops and compresses stacks at its closed endpoint. Choosing **Backed up** also omits moving-belt clock slack.
Older `non_moving_belts` config settings migrate to `backed_up_belts` on import. New configs and exports use only
`backed_up_belts`; if both keys are present, the new key takes precedence. Saved results retain their run's assumptions. Older manual underground configs must choose a layout;
physical approach cannot be recovered from half-tile reach alone. Belt slack remains extra margin for late starts and supply gaps.

The [lane model](../src/state/belt-pickup-lane.ts) stores only holes and partial stacks in an otherwise evenly spaced
supply. [Belt pickup logic](../src/control-logic/inserter/modes/pickup/belt-pickup-logic.ts) chooses the physical lane. No whole-belt
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
Their outlet is physically blocked by the front inserter, so these are backed-up measurements.

The [four-speed backfill](belt-pickup/experiments.md#belt-speed-coverage) now measures side pickups,
front-entrance moving/backed-up controls and front-exit backed-up controls at turbo, express, fast and normal
speeds. Normal moving front-entrance controls use a paired compact destination to respect underground range.
The historical timing examples above describe turbo fixtures.

The production [backed-up queue](../src/state/backed-up-pickup-lane.ts) matches held quantities and exposed stock
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
withdrawals, bends, other orientations and arbitrary relative lane phases remain unverified.
A moving front exit cannot be built: the inserter on the exit's output tile blocks the belt. A config that says
moving supply gets a clock for moving belts there anyway; on the backed-up exit the game holds and recovers it
at every tier ([generated clocks](belt-pickup/experiments.md#generated-clocks-and-drops)). The reverse also holds
at normal speed: a backed-up belt refills a pickup slower than a stack a tick, so on a config whose belts are backed
up the generator, when no other clock can be selected as stable, makes one planned with the belts moving and checks
it on the backed-up belts (the normal side underground entrance and exit and front exit select it, recorded exact).

### Starting on supplied belts

A run of a clock starts as the harness's staged start does, and the simulator predicts every hand from there: the
first one included, with no arm arrival, drop or later lane state taken from the game. Recorded in Factorio 2.1.21
(#273, [experiments](belt-pickup/experiments.md#startup-from-placement)).

- **Placement.** A cold start (`cold_start`, `runClockOnBuild` and `simulateClockOnly`) has every machine, buffer and
  hand empty, every bar at 0 and the supplies full; a recipe that makes its own ingredient gets
  `overrides.loop_seed_items` once. The clock starts with the run, at its tick 0; there is no free run before it. Every
  inserter starts idle with an empty hand over its pickup and runs its own state machine (pickup, swing, drop, swing
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
  inserter. The simulator moves every window by that latency, so a window that ends in the period's last two positions,
  or a start inside a window, carries into ticks 0-1 of each period; at the clock's start those ticks stay dark
  (`ClockedEnableControl.reset`). A run starts its clocks as its warm-up starts (or the judged run, with no warm-up); a
  later step and a loss trial's continuation are no start. A fuel inserter's clock of its own is moved by no latency in
  the simulator and so leaves nothing dark. Recorded on 57 clocked cold starts: the 48 side-pickup cold starts of the
  generator's selected clocks (four tiers, both near sides, straight belt and both underground ends, moving and backed
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
(a backpressure loss, see [stability](stability.md)): the output inserter holds its hand from the tick the belt stops
taking, where the game first fills the belt behind the drop (112 to 192 items on the 104 belt-output clock controls at
stack size 4; 9 to 156 on the blocked-output clocks at stack sizes 1–4, `tests/game/builds/blocked-output-clock-controls.json`).
That moves output between the blocked periods and the few after the release (the game is back at its output 0 to 5
periods after the release period, the simulator 1 to 6), not what follows: in all 120 recordings every period the
captures judge is the same in game and simulator, and a belt that fills to an outlet 10 or 25 tiles past the drop
changes no verdict or selection in the blast or on those 16 clocks
([experiments](belt-pickup/experiments.md#generated-clocks-and-drops)). External incoming traffic still needs its own
modeled transport geometry. Other inserter prototypes and qualities remain uncalibrated.

### Drops of several copies onto one belt

The simulator drops each output inserter's hand on a belt of its own, so it never sees the hands of other inserters or of the other copies
on the same stretch of belt. The result says what the lane model above would do with them
(`src/config/drop-spacing.ts`). Output inserters that drop straight onto a belt from the same side, in the same row, are one line; copy `k`
of the unit stands `k` times `target_output.copy_offset` from it (copies in rows of their own never meet). Seen from the moving belt a hand
that starts at tick `t` at place `p` lies at `(p - v t) mod L` with `v` the tiles the belt moves in a tick and `L = v P` the tiles it moves in
a period of `P` ticks, and takes a quarter tile for each stack of the hand: a hand of 16 at stack size 4 takes one tile. Two hands land on each
other when these stretches overlap. This agrees with replaying `LaneTraffic` on random layouts (`drop-spacing.test.ts`); the replay gives the
ticks a hand waits. On the grenade build (seven copies 12 tiles apart, a turbo belt that moves 14 tiles in 112 ticks) the 14 hands of a line
fit when the inserters of a line start together and land on each other when the two inserters of each copy start 56 ticks apart; in the game a
hand moved one tile off its place waited 6 ticks and the others did not wait. Places come from the exported positions and the side each
inserter takes from, the way the belt runs from Sidecar 0.14.0 (without it the check is made both ways and told only when they agree), and
the gap between copies from the repeated-unit conversion or from the player. A drop marked as side-loading onto another belt is left to the
merge, and the belt is taken to run straight past the inserters.

The result also lists the spacings of the copies (from the width of a copy for one loop of the tiles the belt moves in a period, and the same list at any of these plus a loop; where no spacing can fit, because the hands of a lane outnumber those tiles, it says so instead) and the distances between a copy's two inserters at which the hands fit, and the editor says it before Generate for the period one output hand takes at the target rate (`src/crafting/drop-room-note.ts`). The idea, the arithmetic of pitches and offsets and the evidence are in [drop spacing](../tests/game/mechanics/drop-spacing/README.md).

### Two inserters that bring the same item

When two inserters bring the same item to a machine, one of them can be left holding it. If it starts picking the item up after the other has already put it in, the item is at its insertion limit by the time its hand is ready, and it holds the hand until the machine has used enough for it to drop.

That alone only costs time. It is a deadlock when the inserter that is stuck is also the one that brings another ingredient. While it holds the first item it takes nothing else off the belt. If the machine then runs out of that other ingredient while the first is still at or over its insertion limit, the machine cannot craft, the first item never goes down, and the inserter never lets go. The build stays that way for good, whatever the clock does afterwards.

This is a risk of the build, whatever the items are: a machine with an inserter that brings two items, where another inserter brings one of the same items. Whether it happens is a matter of the timing of the two inserters against each other. This rule comes from my own testing of the game.

Seen on the utility science sample in Factorio 2.1.21 on 2026-10-10, under uneven output swings with backed-up belts: the machine held 16 processing units, 16 low density structures and no flying robot frames, the inserter that brings the frames held 12 low density structures, and the build made 0 of 192 in each of 53 periods. Under batched swings it made 192 in each. The simulator has the deadlock: started in that state it stays in it. None of its checks gets a build into it.

The generator reads the risk off the config alone, with the items of an inserter that has no filters worked out from its belt and its machine (`clock-generator/src/crafting/deadlock-risk.ts`). A build that has it is named as a deadlock risk wherever its clocks are listed, and copying the blueprint of one of its clocks warns which two inserters share which item. On such a build the verdict of the trials for backpressure loss does not decide the selection, since the trials do not see the deadlock: its clocks that hold their expected output are ranked as they were before a clock had to get back from a loss, by their wake-ups.

### When a waiting inserter acts

An inserter that waits for space in a machine is asleep, and acts in the tick after the one that wakes it. Two things wake it: the machine finishes a craft, or another inserter takes the machine's products. So when the output inserter takes a machine down from its output block, an inserter that was waiting to put into it takes its first items one tick later. Only when the machine finished a craft in the tick before the products were taken was it awake already, and then it takes them in the tick they are taken. An inserter whose arm comes back in that tick is not held up. It is defined in `clock-generator/src/control-logic/inserter/waiting-inserter.ts`, and applied by the idle transition of an inserter and by the pickup of a hand from a belt.

Recorded in Factorio 2.1.21 on the scaffolds, on inserters that take from a machine or a chest and had waited 6 ticks or more: the first items came a tick later in 5,777 cases of 5,777 where no craft was finished the tick before, and in the same tick in 3,756 of 3,756 where one was. A hand from a belt that stopped part way at the output block goes by the same rule (843 of 843 and 248 of 248). A hand from a belt that had not started lands its first stack a tick after the products are taken either way.

A hand from a belt that had not started and waited for an ingredient at its insertion limit is woken by the machine's own craft start, which takes the ingredients (see [wake-ups](wake-ups.md)), and lands its first stack in the tick after that start (2026-10-20, #266). The simulator updates machines after inserters, so it finds the room in that tick too, and the pickup mode takes the stack there without the tick it waits after products are taken (`wokenByItsMachinesCraftStart`, `clock-generator/src/control-logic/inserter/waiting-inserter.ts`). Recorded in Factorio 2.1.21 on the normal moving underground pickups from cold starts at chosen lane phases: in all 102 such resumes of the first runs the game took its first stack in the tick after the craft start, where the simulator took it a tick later; at a window's last enabled tick that lost the stack to the next window, and at the exit's natural lane phase it lost one stack in period 5 and settled into a six-period cycle of 143 a period against 176. With the rule the simulator moves what the game moved, period by period, from 51 of the 64 lane-phase starts of each build, its output inserter tick for tick, and from the other 13 once they settle; those 13 first part where an input window opens in the same tick as the output inserter's on a machine at its output block, which the rule below for windows that open together decides (#267, #268). With both rules it follows the game from all 64, tick for tick. All 128 starts are pinned as native controls (`tests/game/builds/lane-phase-controls.json`, `normal_underground`), five of them never settling in the game. A hand that stopped part way at the insertion limit is not recorded, and keeps the tick.

An inserter whose window opens in the tick the products are taken is held up as well (decided on 2026-10-14, issue 152). The game shows an inserter on a clock as enabled the tick before its window, and it waits in that tick: it finds the machine at its block, and is asleep on it when the products are taken. So it takes its first items a tick later, also where the machine finished a craft in the tick before. Where the inserter that takes the products has a window that opens in that same tick too, the order their deciders were built in decides (below). Recorded in Factorio 2.1.21 on inserters that take from a machine, on the accumulator build of the issue and on the scaffolds: a tick later in 1,158 of 1,170 cases where the inserter that took the products was enabled before (44 of 44 where a craft finished the tick before), and in the same tick in 852 of 888 where its window opened too. The 12 are at one sample of the agricultural science recording; the 36 are at one place in the seven-period cycle the 0.9.0 clock of the accumulator build settled into, where the same window a period later takes its items in the tick, which was not checked against that clock's decider order. Recorded since on the same build under an even hands clock whose windows all start at 0 (2026-10-14, see "Even hands" under "Wake-up Lists"): at the one place in the period where all its windows open together, the iron and battery inserters of both accumulator plants took their first items a tick later in all 300 cases (4 places in the period), though the output inserter's window opened in that tick too. That is the decider order: the output inserters' decider is that clock's first, built before those of the iron and battery inserters. The simulator, which took them in the tick until it had the order (#268), takes them a tick later too. No verdict changes with it: game and simulator both move 288 every period.

A hand from a belt is held up by a window that opens on a machine at its output block as well (2026-10-16). An inserter that takes from a belt and waited for its machine goes on a tick after the products are taken in either case, which the pickup mode has. A window that opens starts the pickup from the disabled mode, though, and has no such tick: the inserter finds the machine at its block, is asleep on it when the products are taken, and takes its first stack 2 ticks after its enable (waiting for space, waiting for items, then the hand grows), where the simulator took 1. So `wokenThisTick` (`clock-generator/src/control-logic/inserter/transitions/idle-mode-transition-evaluator.ts`) holds a belt-fed inserter up when its window opens on a machine whose block was lifted in that tick, by the same rule as for a machine source, and leaves the belt source out only where no window opens. Recorded in Factorio 2.1.21 on the utility science scaffold of the Thaeln cell (222 windows): the belt-fed inserters whose first status after the enable was waiting for space in the destination took their first stack 2 ticks after it in 1,373 of about 1,470 windows (the rest wait longer for other reasons), and 1 tick in 329 of 329 where it was waiting for source items; the machine-fed inserters took 1 tick in 4,202 of 4,204 windows. With the rule the belt-fed inserters of a simulated run stay in step with that recording for hundreds of ticks longer (inserters 14 and 15 through all 8,000 ticks checked), where lifting the exclusion for every case parted two of them at tick 40. Not settled: of the other recordings with belt-fed inserters, one Thaeln clock took 2 ticks in 1,322 of about 1,450 waiting windows (supports it), another 2 ticks in 326 and 1 in 108 (mixed), and two recordings have too few cases; two windows of the first recording go the other way. No settled rate of that scaffold moves with it.

Where the window of the inserter that takes the products opens in that tick too, the order the clock's window deciders were built in decides, for an inserter that takes from a belt as for one that takes from a machine (2026-10-20, #268). The game updates the inserters a tick enables in the reverse of the order their deciders were built, the last built first. So an inserter whose decider was built before the taker's is updated after it, sees the products taken, and takes its first items in that tick; one whose decider was built after the taker's is updated first, finds the machine still at its block (it shows "waiting for source items"), and takes them a tick later. Where the taker puts the products, onto a belt or into a machine or a chest, plays no part, and neither does where the deciders stand. Recorded in Factorio 2.1.21 on 9,189 of 9,189 windows that opened on a machine at its block with the taker's, over fifteen runs: clocks of the chemical science, accumulator and advanced circuit builds and of the normal underground pickup, each built in its own order, in reverse, and with the deciders' entity numbers reversed in their own places. Every group of windows changes sides with the order, none with the drop target (#268; the recordings were not kept in the repository). #267 had read it as the taker's drop target, a tick later in 1,327 of 1,327 windows where the taker drops onto a belt and in the tick in 602 of 602 where it drops into a machine or a chest: the generator's blueprints build the output inserters' decider first, and an intermediate machine's taker mostly after its inputs. Built the other way round, #267's own run of the chemical science build swaps its two groups, 82 and 166.

A check of a clock has the order the clock's blueprint builds its deciders in: one decider for each set of windows, whatever the inserters and drills carry (the inserters outside the plan, a by-product inserter, by their items too), in the order of the first entity's id as a string, the fuel clocks of their own after them (`deciderBuildOrder`, `clock-generator/src/crafting/decider-order.ts`; checked against the exported schedules of every sample). A take in the first tick of the taker's window marks the machine with where the taker's decider stands (`windowOpeningTakeDecider`), and `wokenThisTick` lets an inserter whose window opens in that tick too go in it only where that decider was built after its own; where either is not known, a tick later. The simulator updates the inserters that take from a machine before those that put into it, also where competing takers of another machine are served in another order (`InserterUpdates`, `clock-generator/src/control-logic/inserter/competing-takers.ts`), so the rule is met by every such window. With it the simulator replays each of the fifteen runs in its own order with every group on the game's side, the battery plants of the accumulator build included (iron in the tick, copper a tick later, where it had them the other way round), and follows the 128 lane-phase starts of the normal underground pickups and the eight staged cold starts of the same builds that preceded them tick for tick.

The entry for this rule in the shared mechanics docs (factorio-benchmarks, docs/mechanics) is pending.

A hand that an inserter takes from a machine stops filling while the machine it puts into takes nothing of its item, as a hand from a belt does: it keeps what it holds, also through a closed window, and goes on once the machine is under its block. Recorded: such a hand did not grow in 20,701 samples of 20,701 with products to take where the machine it puts into was at its output block, and grew in 11,561 of 11,561 where it was not. It is in the machine pickup logic (`clock-generator/src/control-logic/inserter/modes/pickup/machine-pickup-logic.ts`).

Without these two rules the clock version 0.9.0 selected for the accumulator build of issue 152 (640 a second over 18 copies, `resources/config-samples/intermediates/accumulator/accumulator-640.json`) made 512 to 544 of its 576 a period in the game, in a cycle of seven periods, where the simulator had 576 in every one. The iron and battery inserters of the accumulator plants opened their windows in the tick their output inserter, on its way back from the belt, took the products, and took their hands a tick later than the simulator had them; the battery inserters held 13 of 16 batteries through their closed window where the simulator filled the hand in its last tick. With the two rules the simulator has that clock at 512, and the clock it selects instead made 576 in each of 58 periods in the game, after 3 at 544 while it settled from the scaffold's start.

That one tick decides whether a clock holds when its windows are as long as the hands they are made for. Under a clock for the advanced circuit build with windows of 4 ticks for the inserters that take off a belt, the game made 608 and 624 of 704 a period in turn, where the simulator made 704. One of the two plants had fallen two hands of plastic and of cable behind the other. Its output stood over the output block for the ticks before every output window, the plastic and the cable inserter whose windows opened in those ticks took their hands a tick after the output inserter had cleared it, and a window that was a tick short for it lost a hand: 192 of 256 plastic, 384 of 512 cable and 264 of 352 products a period. With this rule and the output block above, a run of the simulator that starts in the state the game was recorded in holds what every machine and every inserter of the game held, tick for tick, for the 36,372 ticks the recording goes on, and so it does for the recording of the clock tightened by hand that holds 704.

That clock has two states, and the game was in both: one plant made its 352 a period and the other 264, under the same windows. Which one a machine ends up in is decided by what it holds when the clock starts. In the earlier filled-start generator, with machines full of ingredients and emptied of products, the simulator held 704 from every place in the period and classified the clock as meeting goal 1. In that investigation, starting the plants short of ingredients instead fell short from 12 of 108 starts, where the tightened clock and the clock from version 0.5.0 got back to 704 from all 108. Those observations are historical evidence, not the current startup contract. Current clock trials start with full input supplies, empty machines, buffers and hands, phase 0 and the configured one-time loop seed (default 200), and with the clock's first latency ticks dark (see [Starting on supplied belts](#starting-on-supplied-belts)); planning still uses a separate prepared build. Optional extended checks sample other cold clock phases and competing-taker orders actually listed in `assessment.start_dependence.starts`, not filled or free-running builds. Neither those samples nor the loss trials prove convergence from every live inventory or build order (see [stability](stability.md)).

### Products a machine cannot put out

A machine starts a craft whatever its output holds, and the products are made when the craft finishes. If they do not fit under the stack size, the machine holds them and starts no craft until they do. It puts them in its output in the first tick there is room, in whatever state the machine is: working, short of ingredients or at its output block. In a tick the inserters act first and the machines after them, and the recorder samples at the end of the tick. So when an inserter takes products from a machine that holds some, the machine puts them in during that same tick, and one sample shows both, though the machine has nothing left to craft with. Seen in the game on the agricultural science build from the staged start: the two nutrient machines held 40 nutrients behind a full output, an inserter took 32 and the output read 88 in the sample of tick 92, where the simulator, which put held products in only while the machine was working, read 48. With the rule they agree through the first 600 ticks. A full productivity bar is still paid in the working tick, not before. The statistic `products_finished` is not changed by it: the simulator counts a craft when it finishes, the game when its products are put in the output.

Held products reach the output at once, so a machine whose output was taken down to just under its output block can be put back at the block by them, and its inserters then bring nothing until the output is taken down again. On the utility science build with the direct insert chain and always-on inserters, the casting machine of low density structure held 2 behind a full stack of 50; the inserters took it down to 18 (the block is 19), the 2 are put in at once and the plastic inserter waits. Before, the 2 stayed held until plastic came, which is the fault the rule removes. The 3-swing batched clock for that build moves 192 a period in the simulator when the held products wait, and 176, 160 and 144 in turn (180 a second of 240) when they do not.

### Cars, wagons and rocket silos as chests

Since 0.20.0 a car, a tank, a cargo wagon and a rocket silo are chests of mixed items, modelled slot by slot (`src/state/slot-inventory.ts`, `src/state/rocket-silo-inventory.ts`). Recorded in Factorio 2.1.21 on five builds compared with the simulator inserter by inserter (`tests/game/mechanics/containers/`): 339 of 339 hands, 120 of 120 container slots and every silo inventory equal, at two places; and on six clocks through a car, a tank or a wagon, which hold their target and recover in the game (`tests/game/builds/container-clock-controls.json`).

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

### Mining drills

A drill mines by two progress bars, as the game's does (since 0.20.0): each tick an enabled drill drops what it holds, into a machine up to its stop or into a chest as far as it has room, waits while it holds anything, and otherwise mines. A drill disabled by its circuit keeps what it holds and both bars. The whole of it, with the stop into a machine, mining productivity and the game recordings, is on [drills.md](drills.md).

### Other known limits

- **A window that opens on a machine at its output block** follows hold-up rules with unexplained exceptions (see "When a waiting inserter acts"). One of them (#276): when another inserter takes a machine's products off its output block in the tick a belt hand comes back from its swing, the simulator has the hand take its first stack in that tick. In the game it comes a tick later when the taker drops onto a belt (56 of 56 hands), and by the decider order when it drops into a chest (79 of 79). The game's rule, tried in the simulator, moves no selected clock. Whether the model takes it on is decided before `later/swing-back` ([later.md](roadmap/later.md)).
- **A fuel inserter's own clock** runs with no circuit latency in the simulator, while its blueprint encodes the usual two ticks (#276). Neither has been checked in the game. Adding the two ticks changes no clock, verdict or selection, only the wake-up figures of four fuel samples, none of which has a build.
- **The burner energy model** is checked on outcomes only (total burn against the configured rate), never tick by tick against the game.
