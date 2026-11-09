/**
 * The over-the-hood fixtures (`over-hood-clock-fixtures.ts`: 2 families x the turbo tier x 2 mirroring states x moving/backed
 * up) whose clock the record generates (job `overhood-<name>`; that every inserter and drill has exactly one route, an always-on one with its reason, is a property of every job, `entity-routes-total`); the other 4 of the 8 are checked without generating,
 * by over-hood-clock-mechanics.test.ts (the recorded first hands against the simulator's, and the recorded controls
 * against the fixture configs). Same-item mirrored and unmirrored cases pin one and the same clock, so only unmirrored
 * ones are generated. Each is the one case of a path through the generator that no sample takes:
 */
export const OVER_HOOD_GENERATED: ReadonlyMap<string, string> = new Map([
    ["over-hood-turbo-unmirrored-moving-different-items", "derived windows on a moving belt, turbo: the lane phases of a two-phase hand"],
    ["over-hood-turbo-unmirrored-backed-different-items", "ordinary clock for a backed-up belt (planned-belt-slack): the window-end trim that removed the extra pickup"],
    ["over-hood-turbo-mirrored-backed-different-items", "mirrored: the other preferred lane takes a period of its own (1120 against 960)"],
    ["over-hood-turbo-unmirrored-moving-same-item", "the same-item fixture on a moving belt (planned-belt-slack; both lanes carry the item)"],
]);
