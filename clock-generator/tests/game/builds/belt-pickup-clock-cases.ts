/**
 * The belt pickup fixtures (`pickup-clock-speed-coverage.ts`) whose clock the generation test still generates end to
 * end; the other 39 of the 48 are checked without generating, by belt-pickup-clock-mechanics.test.ts (the recorded
 * figures against the simulator's) and, for the different-items family, by the cold-start generation tests, which
 * generate the selection their recorded runs name. Each is the one case of a path through the generator that no sample
 * takes:
 */
export const BELT_PICKUP_GENERATED: ReadonlyMap<string, string> = new Map([
    ["electromagnetic-turbo-straight-belt-moving", "ordinary clock for a moving belt (planned-belt-slack), the default of the fast tiers"],
    ["electromagnetic-turbo-underground-entrance-backed", "ordinary clock for a backed-up belt (planned-belt-slack)"],
    ["electromagnetic-normal-straight-belt-moving", "swings-1: a moving belt that refills a stack slower than the hand takes one"],
    ["electromagnetic-fast-underground-entrance-moving", "fractional swing count on a moving underground pickup"],
    ["electromagnetic-express-underground-entrance-moving", "no clock recovers from every lane phase: a cautious verdict (recovery phases)"],
    ["electromagnetic-normal-underground-entrance-moving", "a moving normal-tier underground fails lane phases: the verdict names them"],
    ["electromagnetic-normal-underground-entrance-backed", "the backed-up clock found where the moving-planned one was recorded (#460)"],
    ["same-item-turbo-straight-belt-moving", "the same-item fixture on its straight-belt config (both lanes carry the item)"],
    ["same-item-normal-underground-entrance-backed", "the same-item fixture on its underground config, normal tier, backed up"],
]);
