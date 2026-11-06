/**
 * The belt pickup fixtures (`pickup-clock-speed-coverage.ts`) whose record job (`pickup-<name>`) has a
 * per-job check, beside the in-game recording of its clock (turbo only: the game tests sweep the turbo tier); the other 9 of the 12 are checked without generating, by belt-pickup-clock-mechanics.test.ts (the recorded
 * figures against the simulator's) and, for the different-items family, by pickup-clock-cold-start-mechanics.test.ts,
 * which builds the clock their recorded runs name from its stored windows and compares it with the pin. Each is the one case of a path through the generator that no sample
 * takes:
 */
export const BELT_PICKUP_GENERATED: ReadonlyMap<string, string> = new Map([
    ["electromagnetic-turbo-straight-belt-moving", "ordinary clock for a moving belt (planned-belt-slack), the default of the fast tiers"],
    ["electromagnetic-turbo-underground-entrance-backed", "ordinary clock for a backed-up belt (planned-belt-slack)"],
    ["same-item-turbo-straight-belt-moving", "the same-item fixture on its straight-belt config (both lanes carry the item)"],
]);
