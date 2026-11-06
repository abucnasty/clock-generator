---
$schema: urn:oasis:names:tc:dita:xsd:reference.xsd
id: glossary
---

# Glossary

The words of the clock generator, for its documentation, its site and its code. The clock generator plans circuit
clocks for Factorio builds: when each inserter is enabled in a repeating window cycle, so that the build makes its target
output with as few wakeups as possible.

Each term is checked against two sources, in this order:

1. **Factorio 2.1.24**: the strings the player sees, the runtime API, the debug view and the engine's names.
2. **ASD-STE100 Issue 9** (Simplified Technical English): the dictionary and its rules for technical nouns and
   technical verbs.

A term that is in the game and approved in STE is used as both define it. A term that is only in the game is the
game's word, used as a technical noun (STE rule 1.6). Where the game uses the word for a different thing, or STE does
not approve it, the entry says so. A term in neither source is the project's own technical noun.

_Avoid_ lists the words that the term replaces. Do not use them in documentation, on the site or in new code.

## Builds

**User**:
A person who makes clocks with the clock generator.
_Avoid_: player

**Build**:
A group of entities in the game, of any number, that together make a target output. One build is one unit. A noun
only (STE rule 1.7). The game uses "build" only as a verb. STE does not approve build (n), and its alternative,
STRUCTURE, is the game's item **Low density structure**.
_Avoid_: module (the game's module items), blueprint (for a build), setup, structure, cell, build (as a verb)

**Entity**:
One thing in the game: a machine, inserter, belt, chest or drill. The game's word.
_Avoid_: object, piece

**Target output**:
The product a build must make and its rate in items per second. The site's **Target Output** panel.
_Avoid_: target rate, goal

**Copies**:
How many identical builds the user puts in the game; can be partial (0.5, 2.25). The site's **Copies** field. STE:
COPY (n), approved.
_Avoid_: units (as the count)

**Configuration**:
A build, with its target output, copies and enable rules: what the generator works from, what the site saves, and what
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

## Clocks

**Clock**:
One set of combinators the generator made for a build and checked in the simulator. Its counter counts on the game's
virtual signal **Clock**, a related use of the word.
_Avoid_: potential clock, alternative, candidate, solution

**Recommended clock**:
The clock the generator ranks first for a build. While generation runs, the site calls it **Best so far**: the clock
that would be recommended if generation ended now.
_Avoid_: selected clock (for the generator's first-ranked clock), the pick

**Selected clock**:
The clock the user has chosen to see and copy. It is the recommended clock until the user chooses another one.

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
The rule an inserter's enable windows are placed by, chosen for that inserter among the strategies that apply to its
source, its sink and its place in the graph.

## Windows

**Enable window**:
The ticks of the window cycle during which the clock makes an inserter's **Enable if** condition true. A stretch that
runs over the end of the window cycle is one enable window. **Enable if** is the game's name for the condition (2.1;
2.0 called it **Enable/disable**).
_Avoid_: wake window, active window, window (bare), enable range

**Belt slack**:
The ticks that an inserter stays enabled after its last pickup from a moving belt. A pickup that starts late can then
still fill its hand. A project technical noun (STE rule 1.6): STE does not approve slack. The site shows
it as "+4 ticks belt slack".
_Avoid_: belt pickup slack, pickup slack, slack (bare)

**Window cycle**:
One complete sequence of all enable windows of a clock, after which the sequence starts again. STE: CYCLE (n), approved.
_Avoid_: periodicity, clock period, period (bare), cycle (bare)

**Window cycle time**:
The time of one window cycle, in ticks: a whole number of crafting cycles, which can be a fraction of a tick. The
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
One time an alarm reaches an inserter in sleep, so that the game checks whether it can do something, also when the clock
has switched the inserter off. The clock switching an inserter on is not a wakeup.
_Provisional_ (the switched-off case): observed on three builds in Factorio 2.1.24; cost not measured.
_Avoid_: wake-up, wake up (as a noun)

**Ghost wakeup**:
A wakeup that does nothing: the clock switched the inserter off while it was in sleep on a machine's wakeup list, so the
machine's next alarm reaches it only for the inserter to find that it is disabled and go to sleep again.
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
The clock goes back to its rate by itself after a supply stop or an output blockage. A noun only: write "the clock goes
back to its rate", not "recovers" (STE does not approve recover (v)).
_Avoid_: recovers, recover, get back

**Backpressure loss**:
A supply stop or an output blockage, as the trials make them. A maintainer term: users never see it.
_Avoid_: backpressure recovery, backpressure (bare)

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
