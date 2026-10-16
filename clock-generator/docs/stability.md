# Stability: backpressure loss and active inserter windows

This page was split out of GOALS.md on 2026-10-15; GOALS.md holds the goals.

## Backpressure Loss

A clock must always recover. When any item of a build stops arriving for a while, or its output stops being taken, the machines run dry or fill up, and when the item comes back the build has to return to its target rate under the same clock by itself. Nobody should have to restart a build because one input ran out.

A clock that does this survives backpressure loss, and one that does not cannot survive backpressure loss. This is what "stable" has meant in this project: a stable clock is one that survives backpressure loss. A clock that only makes its target rate from a clean start, with every machine full of ingredients and emptied of products, does not meet goal 1.

Builds are classified the same way. Some builds cannot survive backpressure loss whatever the clock, such as a loop of machines that does not start again once it has run dry. That is a limit of the build, and it is fine to say so and to give such a build the clocks it can have, as long as they are named for what they are.

Decided on 2026-10-10, after a clock for the advanced circuit build that makes its 704 a period from a clean start made 608 and 624 in the game: one of its two plants held products when the clock started, and never caught up.

### How a clock is tried for it

The generator tries every clock that holds its expected output, in the simulator. A loss is one item that stops arriving from the belts and infinity chests of the build, or one output that is no longer taken away. Each loss is cut at four places in the clock period, and at each it lasts a quarter, a half, three quarters and all of the time the build takes to stop. The build has stopped when nothing was moved, crafted or burned for a whole period; a loss ends after 200 periods at the latest. When the item is back the build has 40 periods to be at exactly its expected output again, and has to stay there. The slowest clock of the samples that gets back takes 19. The trials are the same for every build and every clock, and are defined in `clock-generator/src/crafting/backpressure-loss.ts`.

A clock that holds its expected output and does not get back from a loss is not stable. It is listed as a clock with no recovery, with the losses that break it, and it is only selected when no clock of the build survives. On the samples the selection changed for two builds: agricultural science, whose selected clock did not get back from a loss of nutrients, and military science, where every clock but the one without belt pickup slack is broken by a loss of coal. No clock of the metallurgic science sample gets back from a loss of tungsten ore, so that build keeps its clocks under that name; its selected clock holds its output and does not get back from that loss, and comes before the plain 1-swing clock at the same rate, which does not hold at all (see "Wake-ups", two clocks equally near the target).

One kind of build is left out of this. Where a build has a deadlock risk (see "Two inserters that bring the same item"), its clocks are tried and their verdicts shown, and the verdict does not decide which is selected.

This can cost wake-ups: goal 1 comes first. The clock selected for agricultural science then had 3,950 a minute where the one before had 2,543. Since the rules of issue 152 (2026-10-14, "When a waiting inserter acts") batched swings gets back from every loss on that build and is selected again, at 3,651.

Fluids are not cut, as the simulator leaves them out. None of this has been checked in the game: the harness cannot cut a supply.

The trials do not catch the clock that led to this rule. The advanced circuit clock with windows of 4 ticks gets back from all 48 of its trials in the simulator, and made 608 and 624 of 704 in the game. That is a known gap. The trials are not to be changed until they fail that one clock: a check that is tuned to a build is no longer a check for any build.

## Active Inserter Windows

An active inserter window is defined as a period where an inserter receives a signal from a decider combinator telling it to be enabled. During that window it has the ability to actively do work and transfer materials from a source to a sink.


### Active Inserter Windows Definition of Good

A good clock output reduces an active inserter window to run just in time to transfer the items the machine needs to keep on crafting to meet the target production rate. This means that many times the inserter will transfer multiple times back to back to meet the transfer goal. Reducing the duration of an active window can lead to instability. The measure for a good active inserter window is when the inserter can pick up the items it needs in the least number of ticks. The output from a machine has also another special consideration which is that it should attempt to pick up the full stack size whenever possible. If it cannot do this, it should minimize the amount of time sitting idle over the machine, picking up the output one craft at a time.

