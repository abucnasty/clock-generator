/**
 * The over-the-hood fixtures (`over-hood-clock-fixtures.ts`: 2 families x 4 belt tiers x 2 mirroring states x moving/backed
 * up) whose clock the generation test still generates end to end; the other 23 of the 32 are checked without generating,
 * by over-hood-clock-mechanics.test.ts (the recorded first hands against the simulator's, and the recorded controls
 * against the fixture configs). Same-item mirrored and unmirrored cases pin one and the same clock, so only unmirrored
 * ones are generated. Each is the one case of a path through the generator that no sample takes:
 */
export const OVER_HOOD_GENERATED: ReadonlyMap<string, string> = new Map([
    ["over-hood-turbo-unmirrored-moving-different-items", "derived windows on a moving belt, turbo: the lane phases of a two-phase hand"],
    ["over-hood-turbo-unmirrored-backed-different-items", "ordinary clock for a backed-up belt (planned-belt-slack): the window-end trim that removed the extra pickup"],
    ["over-hood-turbo-mirrored-backed-different-items", "mirrored: the other preferred lane takes a period of its own (1120 against 960)"],
    ["over-hood-turbo-unmirrored-moving-same-item", "the same-item fixture on a moving belt (planned-belt-slack; both lanes carry the item)"],
    ["over-hood-express-mirrored-moving-different-items", "derived windows judged over their repeating cycle (the mirrored express clock that repeated 112 and 96)"],
    ["over-hood-fast-mirrored-moving-different-items", "a moving belt whose selected clock is made for the backed-up belt and holds"],
    ["over-hood-normal-unmirrored-moving-different-items", "normal tier, moving: a longer 960 tick period against 320 mirrored"],
    ["over-hood-normal-mirrored-backed-different-items", "normal tier, backed up, derived windows (period 320)"],
    ["over-hood-normal-unmirrored-backed-same-item", "the same-item fixture at the normal tier, backed up (period 160)"],
]);
