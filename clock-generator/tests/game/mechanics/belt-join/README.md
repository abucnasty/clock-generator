# Belt join

A join is a belt lane that goes onto another belt: by a side load, or by a splitter. The engine's join model
([src/entities/belt/join/](../../../../src/entities/belt/join/join-model.ts)) moves every stack on the lines of a join
each tick. It is fed with put-on events only: where and when a stack comes onto a line. This family records joins of
turbo belts with stacks of 4 in the game. It sets the model against them: every stack's line and position in every tick.
Recorded in Factorio 2.1.24 ([cases](cases.ts), [probe](probe.lua)).

The probe builds every copy by script, side by side, from six shapes:

- a straight belt, an underground exit and an underground entrance, each with a side belt onto it from each side;
- a turned belt onto an exit, with a stack inserter that drops onto it;
- a splitter with eight belts on each side;
- a splitter whose left output is a loop back onto its right output.

Nothing moves for the first 120 ticks after the build. After that the probe builds, removes and clears nothing on a
belt. Script inserts feed the lanes. An end is shut by its chest: the chest keeps what comes, and its slots are full.
The end opens when the probe empties the chest.

## The rules

Positions are in 1/256 tile: the distance to the downstream end of the stack's line (the game's convention). A line is
one transport line of one entity. Each belt has one line for each lane. The numbers are in
[join-rules.ts](../../../../src/entities/belt/join/join-rules.ts), each with the copies it is measured on.

1. **Movement.** Each tick the lines move one at a time, downstream first. From each end: a line, then the lines that
   feed it in-line, then the senders that land on it. A stack moves 32 toward its line's end. It keeps 64 behind the
   stack ahead on its path, and it never moves back. Past the end it goes onto the next line, at that line's length
   less the rest of its step.
2. **Landing.** A side head lands when its step takes it past its line's end. Its natural spot is S - 32 + p, with p
   its position before the tick. It lands there, or at the first spot behind it that is 64 clear of the receiving
   lane's stacks. It lands only if that spot is at most S + 63. Else it stands at its line's end, and the stacks behind
   it wait. A spot past the receiving line's back end is on the line before it.
3. **The side-load point S.** 67 onto a straight belt from its downstream side, and 188 from its upstream side. 67
   onto an underground exit from its downstream side. 60 onto an underground entrance from its upstream side.
4. **The contest.** A stack of the receiving lane at or past S goes first, also when it is behind the head's spot.
5. **Hood.** The hood shuts the other sender lane onto an exit or an entrance: it stands at its line's end.
6. **Ends.** A loader takes a stack in the tick its position would be below 32. A shut end holds its front stack at 0.
   An end that the script changes in a tick acts from the next tick. A shut loader that opens holds its stacks one tick
   more. It takes its front stack at the end of that tick.
7. **Put-ons.** A script's insert is put on before the tick's movement. An inserter's drop is put on after it, where
   the stack is first seen.

### The splitter

Written before this family's run from a 600-tick recording of 2026-11-11 (outside the repository). Its splitter copies:
a splitter with eight belts on each side and both priorities right, or both left, and the loop shape with both
priorities right. Its lines: an input line of 179 and an output line of 128 for each side and lane. The model refuses a
splitter with "none" for a priority.

1. **A lane crosses in one tile and leaves on the same lane.** The head comes onto the output line at 256 - 179 = 77
   less the rest of its step: 63 from 18. Read: the eight copies with one input lane fed, 64 of 64 stacks.
2. **Output priority.** The head goes onto the output that has the priority when that output takes it. Read: the
   same eight copies.
3. **The other output only when the one with the priority cannot take the stack.** Read: the two copies with the end
   of that output shut. The first stack onto the other output came at tick 140, after one at 127 at tick 138.
4. **When an output takes a stack.** The spot is 64 behind the output's last stack, or the head's own spot if that is
   further on. The output takes the stack at a spot on the line (127 at most), however far behind the head's own spot.
   A spot past the back end moves to the back end, 127. That occurs only when the head's own spot is at most 64 before
   127 and 127 is behind the last stack. Else the output does not take the stack. Read: the copies with both inputs
   full (127 behind a stack at 63). The shut-output copies (64 behind 0; 127 behind 64). The loop copy whose loader was
   removed at tick 40 (taken at 64, 80, 112 and 127; not taken past the back end from a spot of 48). The smoke of this
   family's run changed this rule before the full run: in `splitter-one-output` at tick 402, a head at 0 (its own spot
   45) went to 127, behind a stack at 63.
   **The back end is only for the input with the priority** (written after the run of 2026-11-11, before its follow-up
   run). A spot past the back end moves to the back end only for the head of the input that has the input priority.
   The head of the other input goes onto the other output when the output with the priority cannot take it at a spot
   on its line. Read: `splitter-output-shut` at tick 262 (input priority left, output priority right, the right output
   shut, a right input's head at 18 went onto the left output at 63). The 600-tick recording's heads that moved to 127
   past the back end were all of the input with the priority: the shut-output copy with both priorities right (tick
   138), and the loop copy (the right input, ticks 49, 54 and 56).
5. **Input priority.** On each lane, the head of the input that has the priority goes first. The other input's head
   comes after it, behind it. Read: the copies with both inputs full, tick 70.
6. **Both inputs full, both outputs free: each input keeps its own output.** This follows from 4 and 5. After the
   first pair, the output with the priority has a stack at 127 when the other input's head comes. Read: the copies with
   both inputs full, from tick 72.
7. **One usable output: the other input stands.** This follows from 4 and 5. Read: the loop copy after its loader was
   built again (tick 260). The right input drains while the loop and the left input wait.
8. **A head that no output takes stands at its input line's end.** The stacks behind it keep 64 behind it. The stacks
   on an input line are not held by the stacks on the outputs. Read: the loop copy, tick 55; the copies with both
   inputs full.

The model against the game on these copies (every stack, every tick, on the logged lines): 17 of 18 agree for all 600
ticks (the loop copy up to tick 40, before its loader was removed). The copy with both inputs full and both priorities
left differs first at tick 64, 64 ticks after its build. There, a stack that comes onto the splitter's right input is
one step (32) further on than in the model: the difference at a cut that Limits names.

## The run of 2026-11-11

Factorio 2.1.24, 37 copies, 720 ticks after the build, about 11 seconds a run. The model's rows of every copy were
stored before the smoke. They were stored again after the smoke changed the splitter's rule 4, before the full run.
The full run was made twice, for one fault of the probe: it read the line lengths in the tick of the build. In that tick
the game still gives an entrance's tunnel line one tile. The two logs are the same, byte for byte.

- **Fed with the recorded put-ons, the model gives the game's rows in every tick on 35 of 37 copies:** all 9
  boundary copies, and 26 of the 28 other copies.
- **The boundary of the contest is the side-load point, as the model has it.** Onto a straight belt, a line stack at
  68, 69 or 70 at a side head's first chance yields to the head (side-load point 67). So does one at 189 or 190
  (side-load point 188). Onto an exit, a line stack at 64, 65, 66 and 67 goes first. Each copy has 6 contests, all as the
  model gives them.
- **The splitter's rules on copies they were not read from:** rules 1, 2, 5 and 6 agree on the four copies with the
  other priorities, each lane and both inputs full. Rule 4's move to the back end is refuted for the input without the
  priority (`splitter-output-shut`, below). Rules 7 and 8, and an end opened behind a splitter, rest on
  `splitter-one-output`, which the smoke read.
- **`splitter-output-shut` differs from tick 262.** The right input has no priority; its head is at 18. The right
  output has the priority and holds stacks at 0 and 64 behind its shut end. The model puts the head at the back end,
  127, as the game did for the input with the priority in the 600-tick recording. The game puts it onto the left output
  at 63. Not kept. Not established: whether the back end is only for the input with the priority.
- **`loop-shut-end` differs from tick 137.** The first stack onto the splitter's left input, from the turned belt, is
  one step (32) further on than in the model, 137 ticks after the build. Not kept.
- **Kept:** 29 copies, 87 KB as `.json.zst` (zstd level 19 through Node's `zlib`). They are 21 of the 22 copies of
  the first group of cases.ts, the five other splitter copies, and three boundary copies: the first stack behind each point
  (`boundary-belt-68`, `boundary-belt-189`) and the stack at the exit's point (`boundary-exit-67`). The offline replay
  of all of them takes about a quarter of a second.

## Limits

- **Two sender lanes onto one lane of a straight belt** are not modelled away from the loop's shape. In the second
  scaffold run of 2026-11-11, 22 of 86 copies with both sender lanes onto one lane still differ. The loop's two lanes
  agree.
- **For up to about 90 ticks after a build**, the game can put a stack one step off at a cut between two of its lines.
  In the first scaffold run of 2026-11-11, 28 of 96 new held-out copies differ by one step at a cut or at a landing
  next to one. They come back to the model's rows within about 85 ticks. This family waits 120 ticks before any stream.
  At the cut onto a splitter's input it was seen later: 64 and 137 ticks after the build (`loop-shut-end`). So the
  bound of about 90 ticks is not established.
- **The boundary run** measured the straight belt from both sides (67 and 68; 188 and 189) and the exit from one side
  (67 and below). Not measured: a line stack from 68 to 70 onto an exit, and any contest onto an entrance.
- **The splitter:** the shut output with the head of the input that has no priority (`splitter-output-shut`, above).
  The model refuses a splitter with "none" for a priority.
- Turbo belts with stacks of 4 only. The model has no loader that is removed or built while the run goes.

## Run it again

The game test is outside CI: run it again only when the Factorio version changes. Its offline replay
([recordings.test.ts](recordings.test.ts)) runs in `npm test`.

```bash
npm test -- tests/game/mechanics/belt-join/recordings.test.ts
# a new recording (Factorio and the harness save configured, see ../../README.md); every copy's kept form is written to the directory
JOIN_CAPTURE_DIR=.scratch/belt-join/run-01 npm run test:game -- tests/game/mechanics/belt-join/join.game.test.ts
```

The game test fails when a kept copy differs from the model. When the game still agrees, copy the files of the kept
copies (`kept: true` in cases.ts) from the directory into recordings/.
