---
$schema: urn:oasis:names:tc:dita:xsd:reference.xsd
id: glossary
---

# Glossary

The words of the clock generator, for its documentation, its site and its code. The clock generator plans circuit
clocks for Factorio builds: when each inserter is enabled in a repeating window cycle, so that the build holds its setpoint
with as few wakeups as possible.

Each term is checked against three sources, in this order:

1. **Factorio 2.1.24**: the strings the player sees, the runtime API, the debug view and the engine's names.
2. **Control theory**: IEC 60050-351, the International Electrotechnical Vocabulary for control technology. Also
   Åström and Murray, *Feedback Systems* (2008), Janert, *Feedback Control for Computer Systems* (2013), and Wikipedia. The clock
   generator is modelled as a control loop: the build is the controlled system, the setpoint is set by the user, and
   the clock is the controller.
3. **ASD-STE100 Issue 9** (Simplified Technical English): the dictionary and its rules for technical nouns and
   technical verbs.

The first source that has the term gives it. A game word is used as a technical noun (STE rule 1.6). A control term
keeps its standard meaning, and its entry gives the source as a number or a page. Where a source uses the word for a
different thing, or STE does not approve it, the entry says so. A term in none of the sources is the project's own
technical noun.

_Avoid_ lists the words that the term replaces. Do not use them in documentation, on the site or in new code.

## Builds

**User**:
A person who makes clocks with the clock generator.
_Avoid_: player

**Build**:
A group of entities in the game, of any number, that together make one product. One build is one unit. A noun only
(STE rule 1.7). The game uses "build" only as a verb. STE does not approve build (n), and its alternative, STRUCTURE,
is the game's item **Low density structure**. Control theory: the controlled system (IEC 351-49-01).
_Avoid_: module (the game's module items), blueprint (for a build), setup, structure, cell, build (as a verb), plant
(the game's chemical plant), process

**Entity**:
One thing in the game: a machine, inserter, belt, chest or drill. The game's word.
_Avoid_: object, piece

**Setpoint**:
The product a build must make and the rate it must hold, in items per second, for all copies. Set by the user; the
clock never changes it. Control theory: the setpoint (Janert p.21-22, who uses it for rate targets). In IEC terms it is
the command variable (IEC 351-48-09): it comes from outside, and the control does not change it. IEC's reference
variable (351-48-02) is the input of a comparing element in closed-loop control, so the open-loop clock has none. A
setpoint at the maximum rate of the build leaves no time for recovery (Janert p.22). The site's **Setpoint** panel.
_Avoid_: target output, target rate, goal, control frequency (that is the window cycle time)

**Secondary setpoint**:
The rate at which entities outside the configuration take items off an export lane, in items per second. The
configuration's `consumption_per_second` on the lane. It tells what leaves the end of the lane, so the lane states no
lane end.
A project technical noun, related to **Setpoint** (STE rule 1.6): STE approves SECONDARY (adj), and has no entry for
setpoint.
_Avoid_: export rate, consumption

**Copies**:
How many identical builds the user puts in the game; can be partial (0.5, 2.25). The site's **Copies** field. STE:
COPY (n), approved.
_Avoid_: units (as the count)

**Full copy**:
A copy that holds all the machines of the build. STE: FULL (adj) and COPY (n), approved.
_Avoid_: whole copy (for a full copy)

**Partial copy**:
The copy that holds fewer of the machines of the build than the others: the fraction of the copies after the full
copies. 3.5 copies are three full copies and one partial copy. A technical noun (STE rule 1.6): STE does not approve
partial (adj), and gives NOT FULLY.
_Avoid_: part copy, part (bare)

**Configuration**:
A build, with its setpoint and overrides: what the generator works from, what the site saves, and what
clocks are made for. Saved as a configuration file (**Open configuration file…**, **Save configuration file**). The
game's word for a saved set of settings ("Server configuration").
_Avoid_: config (bare), build file

**Check**:
A test of a configuration that shows whether it can be clocked, without making any clocks. A noun only: "do a check of
the configuration" (STE: CHECK (n) approved, check (v) not approved). The button label **Check only** stays as the
site shows it. Not the game's **Check signal**.
_Avoid_: check (as a verb), validate, validation, run a simulation

**Assemble**, **install**, **put** (verbs):
Assemble a build. Install a clock on a build: the whole procedure, put the blueprint down, connect the wires, set
**Enable if**. Put the blueprint down. All three are approved in STE. The game says "place" for putting an entity in the
world; STE does not approve place (v).
_Avoid_: build (v), place (v)

## Lanes

A lane is the game's transport line: each belt has two. The facts of a lane are stated on it in the configuration
(`belts[].lanes[]`), and each one is optional. See [Lane ends](../../clock-generator/docs/belt-pickup/lane-ends.md).

**Supply rate**:
The items per second that come onto an input lane where it starts. The configuration's `supply_rate`. Without it,
the supply rate is the capacity of the lane: on a turbo belt with stacks of 4, 120 items per second. STE: SUPPLY (n)
and RATE (n), approved.

**Lane role**:
What the build does with a lane. **Input**: an inserter takes the item of the lane from it, and no inserter drops that
item on it. **Output**: an inserter drops the item of the lane on it, and no inserter takes that item from it.
**Buffer**: inserters drop the item on it and take the item from it. The generator finds the role from the
inserters, item by item. The configuration does not state it. A lane with no item has the role of the other lane of
its belt. A project technical noun (STE rule 1.6): STE approves ROLE (n), and has no entry for lane.
_Avoid_: transport lane (a buffer lane)

**Lane end**:
What the items do at the downstream end of a lane: a **dead end**, an **infinite end**, or an **unknown end**. A
fact of the build: it does not change while the build runs. The configuration's `lane_end`, by its `kind`. A lane
that states no end gets one: from `overrides.backed_up_belts` if the configuration states it (deprecated: state the
`lane_end` of each lane), else from its **lane role**. The page converts a build that states `backed_up_belts` when
it loads it: each input or buffer lane that states no end gets the end that the field gave it, and the field goes. A project technical noun (STE rule 1.6): STE approves END (n), and has no entry for lane.

**Dead end**:
A lane end that stops the items. They stay on the lane until a hand takes them, so the lane is a standing queue. In the
configuration: `"lane_end": {"kind": "dead_end"}`. The end of an input or a buffer lane that states no end, if the
configuration does not state the deprecated `backed_up_belts`. A project technical noun (STE rule 1.6).

**Infinite end**:
The end of a lane that takes every item that reaches it, as an infinity chest does. On an input lane, the items that
no hand takes move along all the copies and then off the lane. In the configuration: `"lane_end": {"kind": "infinite"}`. The output
belt ends in an infinite end too. The end of an output lane that states no end, if the configuration does not
state the deprecated `backed_up_belts`, and the end of each export lane. A project technical noun (STE rule 1.6): STE has no entry for infinite.
_Avoid_: outlet, free outlet, passthrough

**Unknown end**:
The lane end of a lane when the configuration does not know its end. In the configuration:
`"lane_end": {"kind": "unknown"}`. The generator checks the clock as a dead end and as an infinite end. The clock must
hold under both. Only the Sidecar gives it, when it cannot see the end of a lane. It helps you find a problem. It is
never a default: a lane that states no end gets a dead end or an infinite end. The samples state the end of each lane. STE: UNKNOWN (adj) and END (n), approved.

**Lane sharing**:
Whether all copies take from one lane, or each copy has a lane of its own. **Shared**: the inserters of every copy
take from the lane. This is the default. **Per copy**: each copy has its own lane. The generator checks the inserters
of one copy on it. The configuration's `sharing`: `shared` or `per_copy`. A project technical noun (STE rule 1.6).
_Avoid_: shared by copies, one per copy

**Flow direction**:
The direction in which a belt flows. Both lanes of a belt flow in the same direction. The configuration's
`flow_direction` on the belt: 0 north, 4 east, 8 south, 12 west. Without it, the generator checks the belt flowing in
each direction along the copies. The clock must hold in both. STE: FLOW (n), FLOW (v) and DIRECTION (n), approved.
_Avoid_: items move (for the way the belt flows)

**Near lane**:
The lane, 1 or 2, from which an inserter takes first, when its sink takes items from both lanes. At a side pickup
(the inserter is adjacent to the belt), it is the lane nearest the inserter. At a front pickup of an underground end,
no lane is nearer: the mirroring of the inserter selects the lane. Where both lanes carry the item that the
inserter takes, the near lane gives it first. The far lane gives it only when the near lane has none in reach. The
configuration's `source.near_lane`. A project technical noun (STE rule 1.6): STE approves NEAR (adj), and has no
entry for lane.

**Output belt**:
The belts from the output inserters of the copies to the infinite end. The configuration's `output_belt`: a side
belt, and stretches of belt in tiles. The run of the copies moves the stacks on it, and an output blockage shuts its
infinite end. A project technical noun (STE rule 1.6): STE approves OUTPUT (n), and has no entry for belt.
_Avoid_: output line (the game's `output_lines` are transport lines)

**Side belt**:
The belt that the output inserter of a copy drops on. It side-loads onto the output belt. The configuration's
`output_belt.side_belt`. A project technical noun (STE rule 1.6): STE approves SIDE (n), and has no entry for belt.

**Join**:
A belt lane that goes onto another belt: a side load, or the splitter. At an output blockage, the belt lane is blocked
from draining to the belt it joins. No configuration field has this name. A Factorio word, used as a technical noun
(STE rule 1.6): the splitter "Splits and/or joins transport belts' cargo 1:1." STE does not approve join (v): BOND.

**Target full**:
The game's status of an inserter that cannot drop: the belt or chest that it drops into has no room
(`waiting_for_space_in_destination`). The site uses it in a reason next to **Underproduces**: "Output swings blocked:
target full". It is the reason when a join blocks the output swings of a copy. Not **Output full**, the game's status
of a machine whose own output is full. A Factorio word, used as a technical noun (STE rule 1.6): STE has no entry for
target.

## Clocks

**Clock**:
One set of combinators the generator made for a build and checked in the simulator. Its counter counts on the game's
virtual signal **Clock**, a related use of the word. Control theory: the controlling system (IEC 351-49-02). The installed clock
is open-loop control, and its method is pulse-width modulation.
_Avoid_: potential clock, alternative, candidate, solution, controller (bare; the game's input controllers and
**Ghost controller**)

**Recommended clock**:
The clock the generator ranks first for a build. While generation runs, the site calls it **Best so far**: the clock
that would be recommended if generation ended now.
_Avoid_: selected clock (for the generator's first-ranked clock), the pick

**Selected clock**:
The clock the user has chosen to see and copy. It is the recommended clock until the user chooses another one.

**Rank**:
The place of a clock in the generator's order for a build. Rank 1 is the recommended clock. A project technical noun:
the game and STE have no entry for it.

**Blueprint**:
A clock as a Factorio blueprint string, with its wiring, which the user takes into the game.
_Avoid_: export

**Sidecar**:
The Factorio mod that reads a build from the game for the generator.

**Export**:
What the sidecar does: it copies a build out of the game for the generator. Never the way into the game, which is a
blueprint. The game's word (**Export blueprint**).

**Recorder**:
A development Factorio mod that records every tick of a running build. Users never see it.

## Graph

**Graph edge**:
One inserter (or placer, loader) carrying one item from the node it takes from to the node it drops into. An inserter
carrying two items has two graph edges. A planner term: users never see it.
_Avoid_: edge (bare)

**Capacity group**:
The graph edges one inserter carries, which share its swings: together they cannot ask for more hands than the inserter
can swing.

**Shared source**:
A machine two or more inserters take from, whose output their enable windows must share.

## Strategies

**Strategy**:
One of several ways to do a job. The generator chooses the one that fits the case. This is the strategy pattern. The full form names the job (Enable Control Strategy, Belt strategy). The short form is used where the context is clear.

**Enable Control Strategy**:
How the clock controls one inserter or mining drill: the rule that places its enable windows. Each strategy is named after a practice with a similar timing problem. A router gives each entity its strategy. The site shows a strategy by its name, its tuning method and its selection.
_Avoid_: clocking strategy, clock type

**Belt strategy**:
How a belt works in the simulation: Normal or Export. It is not an Enable Control Strategy.

**Enable Control Strategy Router** (short form: **router**):
The rule above the strategies. It gives each inserter and mining drill of the clock an Enable Control Strategy. Or it gives the reason the entity stays always enabled. There are two: Direct and Coordinated Sources. An override other than Auto decides the entity's control before any strategy.

**Direct**:
The router that gives every inserter and mining drill of the clock the one chosen strategy. An entity the strategy does not control stays always enabled, with its reason.

**Coordinated Sources**:
The router that gives the inserters of each source the enable windows of another clock of the build. A source is a machine, belt or chest that inserters take from. All sources use the window cycle of the recommended clock. The generator sets the sources one at a time, from the output upstream. It keeps the setting with the smallest number of wakeups for the full clock. It is a router, not a strategy.

**Enable Control Strategy override** (short form: **override**):
The setting that overrides the Enable Control Strategy of one inserter or drill (the configuration's `overrides.enable_control`). Auto lets the generator choose the strategy. Always on, Clocked and Conditional decide the control instead: the router then gives no strategy.
_Avoid_: enable rule, enable control

**Tuning method**:
How the generator finds the enable windows. Calculated: the windows come from the numbers of the build. Observed: the windows are drawn around an unclocked run of the build. In control theory this is tuning (Åström and Murray 10.3, p.302). Calculated is tuning from a model (feedforward, IEC 351-47-09). Observed is tuning from the response of the plant with no controller: the process reaction curve (Janert 2013, p.82).

**Selection**:
How the generator gets the clock of a strategy. One version: it makes one clock. Best of N versions: it makes N clocks. The simulation keeps the one with the fewest wakeups that holds. Found by search: it moves the windows through many placements in the simulator. It keeps the best one that holds.

**Unclocked run**:
A run of the build with no clock: all inserters and drills stay enabled. The generator watches what they do. Time-Study Windows are drawn around it.

**Primitive grouped**:
Round-Robin Polling with a shorter window cycle: one output swing each output cycle, calculated straight from the numbers of the build. It is made when the usual window cycle is too long, or when no other clock holds. It tries the same versions and keeps the best one that holds.

## Windows

**Enable window**:
The ticks of the window cycle during which the clock makes an inserter's **Enable if** condition true. A stretch that
runs over the end of the window cycle is one enable window. **Enable if** is the game's name for the condition (2.1;
2.0 called it **Enable/disable**). Control theory: the manipulated variable (IEC 351-48-07), an on/off signal for each
inserter.
_Avoid_: wake window, active window, window (bare), enable range

**Hand**:
The items that an inserter holds. The game uses the word: the stack inserter's description says that inserters wait for
their hand to be full. A full hand is the most that the inserter holds of an item. A technical noun: STE has no entry.

**Swing**:
One move of an inserter from its pickup to its drop. The game's data names the arm swing of an inserter. A loss on a lane
is said in swings. It gives the swings that the inserter does not make. It compares them with its swings when no other copy
is on the lane. A technical noun: STE has no entry.
_Avoid_: a count of items or of crafts for a loss

**Missed swing**:
A swing that an inserter of a copy makes in the run of one copy alone and does not make in the run of the copies. A window
cycle in which the inserter makes fewer swings than alone has as many missed swings. A project technical noun (STE rule 1.6).

**Checked lane**:
A lane that the copies share, as the result gives it for one clock: one row, with what the copies take or drop together
and its state. The row says that the lane holds (the verb). Or it says that a copy has missed swings on it
(**Swings missed on copy N**). The other states are **join full**, **takes less**, **rate fits** (it fits by its
rate), **not checked** and **not run with the copies**. On a clock that is not stable on a shared lane, a lane that
holds is **not the cause**. A project technical noun (STE rule 1.6).
_Avoid_: Short (as the label of a row)

**Room for one more hand**:
Ticks that the generator adds at the end of each enable window of an inserter. It adds them where the inserter takes
from a lane that is not a dead end. They are the ticks that one more hand takes to fill at one lane stack a tick: 4
ticks for a hand of 16 from stacks of 4. On such a lane, an empty space or a take upstream can start a hand later than
the generator planned. Without the room, the window closes on a hand that is not full. A lane with an unknown end gets
the room. A side pickup of an item on both lanes of its belt gets no room. Its far lane gives what an empty space on
its near lane does not give. A project term, as the code says it (`laneHandRoomTicks`).
_Avoid_: belt slack, belt pickup slack, pickup slack, slack (bare)

**Window cycle**:
One complete sequence of all enable windows of a clock, after which the sequence starts again. STE: CYCLE (n), approved.
_Avoid_: periodicity, clock period, period (bare), cycle (bare)

**Output cycle**:
The time in which each output inserter makes its set number of swings at your setpoint. A window cycle is a whole number of output cycles.
_Avoid_: crafting cycle

**Window cycle time**:
The time of one window cycle, in ticks: a whole number of output cycles, which can be a fraction of a tick. The
number the site shows. STE: TIME (n), approved.
_Avoid_: clock period, period (bare), repeat interval, schedule length, LCM period

**Wraparound value**:
The N in the condition of a clock's counter (`signal-clock < N`): the counter counts 1 to N, then starts again at 1. It
is the window cycle time on a simple clock, and larger on a subtick clock or a clock with merged fuel clocks.
_Avoid_: counter length, period

**Subtick clock**:
A clock whose window cycle time is not a whole number of ticks. The project's word since factorio-scripts PR #68; also
used by abucnasty's community.
_Avoid_: fractional clock

**Window edge**:
An enable window's opening edge (switched on) or closing edge (switched off). The only kind of edge users see.
_Avoid_: edge (bare)

**Opening edge**:
The tick an enable window switches its inserter on.

**Closing edge**:
The tick an enable window switches its inserter off.
_Avoid_: falling edge, switch-off edge

## Control

**Design loop**:
The closed loop of the generator. The generator proposes clocks. The simulator measures how the build responds to
each clock. The generator then ranks or changes the clocks. The loop runs offline, before a clock is installed. Control theory:
closed-loop control (IEC 351-47-01), used for design; Janert p.125.

**Open-loop control**:
Control whose action is fixed before it starts and does not use a measurement of the output. The installed clock is
open-loop control: it reads nothing from the build. Control theory: IEC 351-47-02; Janert p.15-16.
_Avoid_: feedforward (for the clock; Janert's meaning is wider than the IEC's), "the clock reacts", "the clock adjusts"

**Pulse-width modulation** (**PWM**):
The method of the clock. It switches each inserter fully on and off in a fixed pattern that repeats every window
cycle. The average work of each inserter then meets the setpoint. Intended discrete control, set by the design loop.
Control theory: pulse-width modulation (Wikipedia); Janert's split-time controller, p.110.

**Duty cycle**:
The share of the window cycle during which the clock enables an inserter: the sum of its enable windows, divided by the
window cycle time. Not the utilization of a machine group.

**Full duty cycle**:
An inserter or drill whose swings take the whole window cycle, or all of it but its window's offset. Its enable windows
would have a duty cycle of 1, so the clock leaves it always enabled.
_Avoid_: busy

**Oscillation**:
An unintended swing of the output or of a stock. The PWM pattern of the clock does not cause it: it repeats with a
different period, or it grows. Control theory: Åström and Murray 1.5; Janert p.42.
_Avoid_: "the clock oscillates" (for its normal switching)

**Stable**:
A clock is stable when it holds its setpoint at steady state. It also has recovery after every disturbance trial:
the build goes back to its rate by itself. Control theory: asymptotic stability (Åström and Murray 4.3), tested by the
disturbance trials, not proved. STE: STABLE (adj) approved; *stability* (n) is a technical noun.
_Avoid_: survives backpressure loss

**Utilization**:
The crafts a machine group must make, divided by the crafts it can make, in the same time. 1 means that the machines
never stop. The code calls it `duty` (`feasibility/duty.ts`). A technical noun (STE rule 1.6): STE does not approve
utilization (n).
_Avoid_: machine duty, duty (bare)

## Starts

**Cold start**:
A start of a build with every machine, belt buffer and hand empty and the supplies full. The clock starts at the first
tick. The start the generator judges clocks from. Spike #689 measures whether the backpressure start should replace
it. The code's `cold_start`.
Control theory: a step response from rest (IEC 351-45-27; Janert p.82).
_Avoid_: empty start, unloaded start, cold startup

**Backpressure start**:
A start of a build in which every entity that can fill without the clock is full. The supply belts are saturated.
The machines that inserters without a clock fill, and their outputs, are full. The machines that only clocked inserters
fill are empty. A loop starts from its kick start. The clock starts at the first tick, when the **Clock
lock** is set to off. A user can always start a build this way. Planned as the judged start in place of the cold
start, when spike #689 shows that it costs no more.
Control theory has no single term: a step response from a saturated initial state (Janert p.28, p.101-103).
_Avoid_: loaded start, warm start, full backpressure startup

**Kick start**:
The items put into each machine whose recipe makes its own ingredient (pentapod eggs), before its clock starts, so
that the loop can run: such a loop cannot fill by itself. A noun only: give the loop its kick start. A loop of
machines that only feed each other gets no kick start, and the generator cannot start it. The configuration's `loop_seed_items`. Control theory: like integrator
preloading (Janert p.103).
_Avoid_: seed (the game's Yumako, Jellynut and Tree seed items, and the map seed), prime, bootstrap, kick-start (as a
verb)

**Backpressure**:
An inserter takes from a source: a belt lane, a machine or a chest. With backpressure, the source holds what the hand
needs at every swing. The inserter does not wait for items to be made or to arrive. Without backpressure, the inserter
cannot fill its hand in time. It then picks up less than a full hand. The two entries below are the belt case and the
machine case. A project technical noun (STE rule 1.6).
_Avoid_: backed-up, backed up

**Backpressure**, at a belt pickup:
The belt case of backpressure. The state of one lane at one tick: the lane in reach of the inserter is fully saturated
and does not move. A lane that is moving at that tick has no backpressure: the inserter waits for items to arrive. The
two lanes of a belt can be in different states. A lane can change its state from one tick to the next. A lane end is
not a state: it is a fact of the build.

**Backpressure**, at a machine:
The machine case of backpressure. When the inserter must pick up, the output slot of the machine holds a full hand. A
pickup of less than a full hand is not backpressure.

**Steady state**:
The condition after the startup period. The build repeats the same pattern in each window cycle, or in each whole
number of window cycles. For an on/off clock it is a periodic steady state: the output repeats, it is not
constant. A build with a loop may never repeat exactly: the generator then judges it on a sample of window cycles, and
does not prove the repeat. Control theory: Åström and Murray 5.3; Janert p.29, p.42.
_Avoid_: warm, warm state, settled (the game's *warm* is a temperature)

**Startup period**:
The time from a start (cold start or backpressure start) until steady state. Control theory: the initial transient;
Janert p.8, p.103.
_Avoid_: startup (bare; the game's mod **Startup** settings), initial transient, transient phase

**Settling time**:
The length of a startup period, in ticks or window cycles. Also the time to recovery after a disturbance. Control
theory: IEC 351-45-37; Janert p.93.

**Warm-up**:
The window cycles that the simulator runs after a start and before it measures (`warmup_periods`). It must be at least
as long as the startup period.
_Avoid_: warm-up (for the startup period of the build)

## Wakeups

**Sleep**:
The condition of an inserter that the game does not update until an alarm reaches it. An inserter in sleep is on one or
more wakeup lists. A noun only: the inserter goes to sleep (the engine's `goToSleep`); the inserter is in sleep. The
game also uses "Sleep" for the keyboard's Sleep key, and "asleep" for segmented units: not this meaning.
_Avoid_: asleep, awake, active, inactive, sleeping, idle

**Update list**:
The inserters the game updates every tick. An inserter leaves it when it goes to sleep, and comes back when an alarm
reaches it or the clock switches it on. The project's word; the engine says "linked" and `isActive`.
_Avoid_: active, awake

**Wakeup list**:
The inserters an entity alarms when something in it changes. An inserter in sleep is on the wakeup list of each entity
it waits on. The game alarms other entities the same way: any entity that puts its output straight into another
machine, like a mining drill or a recycler. The game's status **Target full** is "Used by inserters, mining drills, and
crafting machines using vector_to_place_result". The generator counts the wakeups of inserters only
([drills.md](../../clock-generator/docs/drills.md)), so **Sleep**, **Wakeup list**, **Wakeup** and **Alarm** are
defined for inserters. The game spells it "Wakeup list count" (debug tooltip) and `show-wakeup-lists` (debug setting).
_Avoid_: wake-up list, wake list, subscription

**Alarm**:
The signal an entity sends to the inserters on its wakeup list. The engine's word (`Inserter::alarm`, `deliverAlarm`,
`alarmWakeupList`, seen in the game's own symbols in profiler captures). A maintainer term: users never see it. Not the
programmable speaker's **Alarms** or the virtual signal **Alarm**.

**Wakeup**:
One time an alarm reaches an inserter in sleep. The game then checks whether the inserter can do something. This is
also true when the clock has switched the inserter off. The clock switching an inserter on is not a wakeup.
_Provisional_ (the switched-off case): observed on three builds in Factorio 2.1.24; cost not measured.
_Avoid_: wake-up, wake up (as a noun)

**Ghost wakeup**:
A wakeup that does nothing. The clock switched the inserter off while it was in sleep on a machine's wakeup list. The
machine's next alarm reaches it, the inserter finds that it is disabled, and it goes to sleep again.
_Provisional_: observed on three builds in Factorio 2.1.24; cost not measured. Name kept until that is measured.
_Avoid_: ghost wake-up

## Recovery

**Supply stop**:
A time when one item stops arriving from the belts or chests of a build.
_Avoid_: starved, starvation (the game's word for biter spawners), input loss

**Output blockage**:
A time when one product of a build is not taken away. STE: BLOCKAGE (n), approved.
_Avoid_: jammed, jam, output loss

**Recovery**:
The clock goes back to its rate by itself after a supply stop or an output blockage. The term is the noun, and the site
can also say that a clock recovers. Control theory: the disturbance response (IEC 351-46-13).
_Avoid_: get back

**Disturbance**:
An input from outside that pushes the build away from its setpoint: a supply stop, an output blockage, or a
productivity bonus. On a shared lane, the other copies take items too. The gaps that their pickups leave are a
disturbance to one copy. A maintainer term: users read supply stop, output blockage, recovery and gap. Control theory:
IEC 351-48-08; Janert p.113, p.278. Not the runtime API's segmented units that investigate "a disturbance".
_Avoid_: backpressure loss

**Disturbance trial**:
A supply stop or an output blockage that the generator applies to each clock. The trials show whether the clock is
stable. The code calls them backpressure losses (`backpressure_loss`).
_Avoid_: backpressure loss trial

## Statuses

The site gives each clock one status. It shows the status on the card of the selected clock. It also shows it in the
**Status** column of the clock tables. A stable clock has the status **Stable** (the entry **Stable**, under Control).
Each status below is a technical noun (STE rule 1.6). Write it as the site shows it. Do not use it as a verb in your
own text.

**Underproduces**:
The status of a clock that makes less than its setpoint. Next to it, the site gives the rate of the clock or the
reason. An example of a rate: "makes 180/s of 240/s". A project technical noun: the game and STE have no entry for
it. Do not write underproduce as a verb.
_Avoid_: Does not hold its rate (as the status), Misses the rate (as the status)

**Overproduces**:
The status of a clock that makes more than its setpoint. The site gives the rate of the clock next to it. The
generator accepts some rounded clocks as at their setpoint. They run at most 0.1% fast and do not have this status. A project technical noun: the game and STE have no entry for it. Do not write overproduce as a verb.

**Oscillates**:
The status of a clock that makes its setpoint on average, but not in each window cycle. The output of one or more window
cycles is off the expected output by more than the tolerance of one hand. The output is an **Oscillation**: it repeats
with a period that the clock does not set. Next to the status, the site gives the window cycles that are off and the
expected output, for example "makes 432 then 144 items a window cycle, 288 expected · repeats every 26 window cycles".
It gives the repeat only when the generator proves it. The boundary with **Steady state**: an output that repeats over
a whole number of window cycles is a steady state, and it is not constant. While each window cycle is within one hand of
the expected output, the clock does not have this status. A project technical noun. Do not write oscillate as a verb
for the clock.
_Avoid_: Underproduces (as the status of a clock that makes its setpoint on average)

**No recovery**:
The status of a clock that holds its setpoint at steady state. After one or more disturbance trials, the clock has no
recovery. A project technical noun: STE has no entry for recovery.

**Start-dependent**:
The status of a clock that holds its setpoint from some starts only. The generator runs the other starts only if the
configuration has `overrides.check_start_dependence`. A project technical noun: STE has no entry for dependent.
_Avoid_: Depends on how it is started (as the status)

## Changes

**Blast**:
A run that generates every sample and fixture and hashes each clock, compared between two heads. A **zero-change
blast** is one in which no job moves.
_Avoid_: blast radius

**Impact**:
What a merged pull request could break, for whom, and whether it can be undone. A process term (STE rule 1.6), used in
the pull request templates, CONTRIBUTING.md and maintainer topics, never in the user map. Not the game's damage type
**Impact**; STE does not approve impact (n).
_Avoid_: blast radius, merge danger

**Area**:
The part of the clock generator a changelog entry is about: `simulation` (how the game is modelled), `generation`
(which clocks are found and which is recommended), `blueprint`, or `ui` (everything else the user sees on the page).

## Publishing

**Job**:
One unit of a GitHub Actions workflow, named under the workflow's `jobs:` key (`release`, `production`, `preview`,
`publish-sidecar`, `tests`). A maintainer term. STE does not approve job (n) (WORK); the game uses "job" for
construction robot work: not this meaning.
_Avoid_: work (for a job)
