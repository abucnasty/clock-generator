# Working rules

This page was split out of GOALS.md on 2026-10-15; GOALS.md holds the goals.

## Working Rules

Decided on 2026-10-10, after a day in which each recording of the game led to another rule for the simulator and the work on goal 2 did not start.

1. The simulator is the judge of a clock, because it is the only judge that ships with the generator. The game is what the simulator is calibrated against.
2. A difference between the simulator and the game is chased only when it changes whether a clock is stable, or which clock is selected, on some sample. Any other difference gets a line in `resources/config-samples/README.md` and is left.
3. Margin comes before precision. A clock has to recover from losses and hold with its windows a tick off, so that a modelling error of one tick does not decide whether it works.
4. Scaffold tests are a regression check. They do not decide whether a change ships.
5. The generator is built from general patterns. A sample, a scaffold or a clock someone made by hand is evidence and a benchmark, never the target. A build the generator cannot clock is a gap to record, not a reason to change the build.
6. The time spent searching at generation does not grow: no new search dimension, no more start phases, no more trials. A new idea has to be a rule that builds or rejects a clock from the config and the plan, with the simulator confirming it.

