/**
 * The cold-start runs (`pickup-clock-start-controls.json`) whose clock the generation test still generates, to see that the
 * selection makes the clock the run was recorded on. The other runs are checked without generating:
 * pickup-clock-cold-start-mechanics.test.ts builds the clock from the run's stored windows and compares its hash with the
 * recorded one, and with the pin of the same fixture in pickup-clock-controls.json; the runs of a fixture belt-pickup-clock
 * generates (belt-pickup-clock-cases.ts) are checked on that generation. Each is the one run of a path through the generator
 * that neither of those takes:
 */
export const COLD_START_GENERATED: ReadonlyMap<string, string> = new Map([
    ["turbo-underground-exit-backed-l1", "the clock for a backed-up belt (planned-belt-slack) on an underground exit"],
    ["over-hood-turbo-unmirrored-backed-different-items", "an over-the-hood exit clock, unmirrored"],
]);
