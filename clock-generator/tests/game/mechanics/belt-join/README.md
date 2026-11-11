# Belt join

A join is a belt lane that goes onto another belt: by a side load, or by a splitter. The engine's join model
([src/entities/belt/join/](../../../../src/entities/belt/join/join-model.ts)) moves every stack on the lines of a join
each tick, fed with put-on events only: where and when a stack comes onto a line. This family records joins of turbo
belts with stacks of 4 in the game and sets the model against them, every stack's line and position in every tick.
Recorded in Factorio 2.1.24 ([cases](cases.ts), [probe](probe.lua)).

The probe builds every copy by script, side by side, from six shapes: a straight belt, an underground exit and an
underground entrance with a side belt onto them from each side, a turned belt onto an exit with a stack inserter that
drops onto it, a splitter with eight belts on each side, and a splitter whose left output is a loop back onto its right
output. Nothing moves for the first 120 ticks after the build. After that the probe builds, removes and clears nothing on
a belt: script inserts feed the lanes, and an end is shut by its chest (the chest keeps what comes and its slots are
full) and opened by emptying the chest.

## The rules

Positions are in 1/256 tile, the distance to the downstream end of the stack's line (the game's convention). A line is
one transport line of one piece; each belt has one for each lane. The numbers are in
[join-rules.ts](../../../../src/entities/belt/join/join-rules.ts), each with the copies it is measured on.

1. **Movement.** Each tick the lines move one at a time, downstream first: from each end, a line, then the lines that
   feed it in-line, then the senders that land on it. A stack moves 32 toward its line's end, but keeps 64 behind the
   stack ahead on its path and never moves back. Past the end it goes onto the next line, at that line's length less
   the rest of its step.
2. **Landing.** A side head whose step takes it past its line's end lands at the first spot at or behind
   S - 32 + p (p its position before the tick) that is 64 clear of the receiving lane's stacks, only if that spot is at
   most S + 63; else it stands at its line's end. The stacks behind it wait. S, the side-load point: 67 onto a straight
   belt from its downstream side, 188 from its upstream side, 67 onto an underground exit from its downstream side, 60
   onto an underground entrance from its upstream side. A spot past the receiving line's back end is on the line before it.
3. **The contest.** A stack of the receiving lane at or past S goes first, also when it is behind the head's spot.
4. **Hood.** The other sender lane onto an exit or an entrance is shut by the hood: it stands at its line's end.
5. **Ends.** A loader takes a stack in the tick its position would be below 32. A shut end holds its front stack at 0.
   An end changed by the script in a tick acts from the next tick; a shut loader that opens holds its stacks one tick
   more and takes its front stack at the end of that tick.
6. **Put-ons.** A script's insert is put on before the tick's movement; an inserter's drop after it, where the stack
   is first seen.

### The splitter

Written from the splitter copies of the 600-tick log of 2026-11-11 (landing-rules/recording/full: `s5-RR-*`,
`s5-LL-*`, `s6-*`) before this family's run. Its lines: an input line of 179 and an output line of 128 for each side
and lane. A splitter with "none" for either priority is not modelled: the model refuses it.

1. **A lane crosses in one tile and leaves on the same lane.** A head whose step takes it past its input line's end
   comes onto the output line at 256 - 179 = 77 less the rest of its step: 63 from 18. Read: the eight one-lane copies
   (`s5-RR-in-*`, `s5-LL-in-*`), 64 of 64 stacks.
2. **Output priority.** The head goes onto the output that has the priority when that output takes it. Read: the same
   eight copies, every stack onto the side with the priority.
3. **The other output only when the one with the priority cannot take the stack.** Read: `s5-RR-pref-blocked` and
   `s5-LL-pref-blocked` (the first stack onto the other output at tick 140, after one at 127 at tick 138), `s6-loader-off`
   tick 43.
4. **When an output takes a stack.** Its spot is 64 behind the output's last stack if its own spot is nearer than that,
   at most the output's back end (127). The output takes it only when that spot is behind its last stack and at most 64
   behind the head's own spot. Read: `s5-RR-both-full` tick 70 (127 behind a stack at 63), `s5-RR-pref-blocked` ticks 136
   and 138 (64 behind 0; 127 behind 64), `s6-loader-off` ticks 41 to 56 (taken at 64, 80, 112 and 127; refused at 127,
   79 behind a head's spot of 48).
5. **Input priority.** On each lane the input that has the priority moves first; the other input's head comes after it
   and is put behind it. Read: `s5-RR-both-full` and `s5-LL-both-full` tick 70.
6. **Both inputs full, both outputs free: each input keeps its own output.** It follows from 4 and 5: after the first
   pair, the output with the priority has its last stack at 127 when the other input's head comes. Read: the two
   `both-full` copies from tick 72.
7. **One usable output: the other input stands.** It follows from 4 and 5. Read: `s6-loader-off` after its loader is
   built again (tick 260): the right input drains while the loop and the left input wait.
8. **A head that no output takes stands at its input line's end;** the stacks behind it keep 64 behind it. The stacks
   on an input line are not held by the stacks on the outputs. Read: `s6-loader-off` tick 55; `s5-RR-both-full`.

Set against the game on the read-from copies (every stack, every tick, on the logged lines): 17 of 18 agree, all 600
ticks (`s6-loader-off` up to tick 40, where the 600-tick log removed its loader). `s5-LL-both-full` differs first at tick
64, 64 ticks after its build: a stack on the right input's lane 2 is one step (32) further on than the model has it as
it comes onto the splitter, the kind of difference at a cut between two lines named under Limits.

## Limits

- **Two sender lanes onto one lane of a straight belt** are not modelled away from the loop's shape: in the second
  scaffold run of 2026-11-11, 22 of 86 copies with both sender lanes onto one lane still differ; the loop's two lanes
  agree.
- **For up to about 90 ticks after a build** the game can place a stack one step off at a cut between two of its lines
  (28 of 96 freshly built held-out copies of the first scaffold run differ by one step at a cut or at a landing next to
  one, and come back to the model's rows within about 85 ticks). This family waits 120 ticks before any stream.
- **The boundary of the contest:** see the run below.
- Turbo belts with stacks of 4 only; a loader removed or built while the run goes is not modelled.

## Run it again

The game test is outside CI: run it again only when the Factorio version changes. Its offline replay
([recordings.test.ts](recordings.test.ts)) runs in `npm test`.

```bash
npm test -- tests/game/mechanics/belt-join/recordings.test.ts
# a new recording (Factorio and the harness save configured, see ../../README.md); the kept copies are written to the directory
JOIN_CAPTURE_DIR=.scratch/belt-join/run-01 npm run test:game -- tests/game/mechanics/belt-join/join.game.test.ts
```
