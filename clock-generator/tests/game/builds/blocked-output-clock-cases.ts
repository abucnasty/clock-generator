/**
 * The blocked-output fixtures (`blocked-output-clock-fixtures.ts`, 16 = 4 belt tiers x belt stack size 1-4) whose clock
 * the generation test still generates end to end; the other 13 are checked without generating, by
 * blocked-output-clock-mechanics.test.ts (the recorded controls and the drop figures of the game against the simulator,
 * which runs a plain clock of the case through the block and the release). The generator takes two paths on these
 * fixtures: a clock of one hand of 16 a period (stack sizes 1, 2 and 4), selected as even-hands or, where both have no
 * wake-ups and the planned-belt-slack clock ties with it, as that (seven fixtures), and the shifted-swings clock of 1,440
 * ticks (stack size 3, where the hand is 15). Each is the one case of a path through the generator that no sample takes;
 * the first two also keep their earlier selection, the even-hands clock, as a `previous` the generation test finds still made:
 */
export const BLOCKED_OUTPUT_GENERATED: ReadonlyMap<string, string> = new Map([
    ["blocked-output-normal-stack-1", "planned-belt-slack, the longest drop (a hand of 16 single items takes 112 ticks on the normal belt): five gears a second are two thirds of the lane"],
    ["blocked-output-turbo-stack-4", "planned-belt-slack, the shortest drop (four stacks of four): the lane has room to spare"],
    ["blocked-output-normal-stack-3", "shifted-swings: a hand of 15 that makes the period 1,440 ticks"],
]);
