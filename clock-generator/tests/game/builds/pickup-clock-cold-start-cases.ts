/**
 * The cold-start runs (`pickup-clock-start-controls.json`) whose clock the generation test still generates, to see that the
 * selection makes the clock the run was recorded on. The other runs are checked without generating:
 * pickup-clock-cold-start-mechanics.test.ts builds the clock from the run's stored windows and compares its hash with the
 * recorded one, and with the pin of the same fixture in pickup-clock-controls.json; the runs of a fixture belt-pickup-clock
 * generates (belt-pickup-clock-cases.ts) are checked on that generation. Each is the one run of a path through the generator
 * that neither of those takes:
 */
export const COLD_START_GENERATED: ReadonlyMap<string, string> = new Map([
    ["normal-straight-belt-backed-l2", "the side cell reflected to near lane 2 (belt-pickup-clock generates near lane 1 only), on a straight belt"],
    ["normal-underground-exit-moving-l2", "an underground exit (belt-pickup-clock generates the straight belt and the entrance), reflected, where the swings-1 clock fails lane phases"],
    ["fast-underground-exit-moving-l1", "the fractional swing count on an underground exit"],
    ["express-underground-exit-moving-l2", "no clock recovers from every lane phase (the cautious verdict) on a reflected exit"],
    ["turbo-underground-exit-backed-l1", "the clock for a backed-up belt (planned-belt-slack) on an underground exit"],
    ["over-hood-turbo-unmirrored-backed-different-items", "an over-the-hood exit clock, unmirrored"],
    ["over-hood-fast-mirrored-backed-different-items", "an over-the-hood exit clock, mirrored"],
]);
