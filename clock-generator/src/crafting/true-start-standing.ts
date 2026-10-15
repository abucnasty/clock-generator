/**
 * How far the true-start method (true-starts.ts, the series' recount method) can be trusted on a machine, from the
 * recordings it was checked on. Each machine of the recordings was laid against its input balance (its item
 * ingredients' counts, with the items dropped into it in the same tick), which is the yardstick: a craft consumes its
 * ingredients (scripts/true-start-accuracy.js, recorded 2026-10-14 and 15 on the advanced circuit, accumulator, low
 * density structure and agricultural science scaffolds). The miss line is 5 a minute or 5%, whichever is larger.
 *
 * - "checked": the method's starts equalled the input balance's on this recipe and machine, and the machine's crafting
 *   progress a tick (delta) and productivity are inside the range recorded.
 * - "known miss": the method was beyond the miss line on this kind of machine.
 * - "not checked": no recording covers it, or it is outside the recorded range, or its ingredients are fluids only
 *   (no yardstick).
 * The simulator's true starts are its own count, not this method, and have no standing here.
 */

export type TrueStartStanding = "checked" | "not checked" | "known miss";

/** What the method read a machine's true starts with */
export interface TrueStartMethodInput {
    /** The machine's prototype name, such as "electromagnetic-plant" */
    machine_name: string;
    recipe: string;
    /** Crafting progress a working tick */
    delta: number;
    /** The productivity bonus, 1.5 for +150% */
    productivity_bonus: number;
}

/** The productivity recorded on the checked machines: +50% to +300% */
const CHECKED_PRODUCTIVITY = { min: 0.5, max: 3 };

/** Recipes and machines on which the method equalled the input balance, with the range of delta checked */
const CHECKED: readonly { recipe: string; machine_name: string; delta: { min: number; max: number } }[] = [
    // exact tick for tick: 0.278 (advanced circuit), 0.3641 (battery), 0.2077 (accumulator), 0.286 (LDS); the range
    // recorded over these, 0.2077 to 0.3641, holds for each of them (the reviewer session, 2026-10-15)
    { recipe: "advanced-circuit", machine_name: "electromagnetic-plant", delta: { min: 0.207, max: 0.365 } },
    { recipe: "battery", machine_name: "cryogenic-plant", delta: { min: 0.207, max: 0.365 } },
    { recipe: "accumulator", machine_name: "electromagnetic-plant", delta: { min: 0.207, max: 0.365 } },
    { recipe: "casting-low-density-structure", machine_name: "foundry", delta: { min: 0.207, max: 0.365 } },
    // exact at delta 1.025 (the advanced circuit scaffold's plant)
    { recipe: "plastic-bar", machine_name: "cryogenic-plant", delta: { min: 0.207, max: 1.03 } },
];

/** Kinds of machine on which the method was beyond the miss line */
const KNOWN_MISSES: readonly { describe: string; matches: (m: TrueStartMethodInput) => boolean }[] = [
    {
        // -4.5% unclocked and -6.5% clocked at delta 1.958 (the low density structure scaffold's plant)
        describe: "plastic in a cryogenic plant near delta 2 (-4.5% to -6.5%)",
        matches: m => m.recipe === "plastic-bar" && m.machine_name === "cryogenic-plant" && m.delta >= 1.9 && m.delta <= 2.1,
    },
    {
        // nutrients from bioflux +100% in every run, agricultural science -5.8% unclocked; spoilage and the burning of
        // nutrients are untested candidates, not causes
        describe: "every biochamber (nutrients from bioflux read double; agricultural science -5.8% unclocked)",
        matches: m => m.machine_name === "biochamber",
    },
];

/** The method's standing on one machine */
export function trueStartStandingOf(machine: TrueStartMethodInput): TrueStartStanding {
    if (KNOWN_MISSES.some(miss => miss.matches(machine))) {
        return "known miss";
    }
    const checked = CHECKED.some(it => it.recipe === machine.recipe && it.machine_name === machine.machine_name
        && machine.delta >= it.delta.min && machine.delta <= it.delta.max
        && machine.productivity_bonus >= CHECKED_PRODUCTIVITY.min && machine.productivity_bonus <= CHECKED_PRODUCTIVITY.max);
    return checked ? "checked" : "not checked";
}

/** The worse of two standings: a known miss over not checked over checked */
export function worseStanding(a: TrueStartStanding | null, b: TrueStartStanding | null): TrueStartStanding | null {
    const order: TrueStartStanding[] = ["checked", "not checked", "known miss"];
    if (a === null) return b;
    if (b === null) return a;
    return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

/** The known misses, in words, for the caveat */
export const TRUE_START_KNOWN_MISSES: readonly string[] = KNOWN_MISSES.map(miss => miss.describe);
