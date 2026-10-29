/** One machine of probe.lua: a chest and an inserter that drops into it, and the trials the probe runs on it */
export interface LimitCase {
    name: string;
    entity: "assembling-machine-1" | "assembling-machine-2" | "assembling-machine-3" | "stone-furnace" | "steel-furnace" | "electric-furnace";
    /** Set on an assembling machine; a furnace takes its recipe from what it is given */
    recipe?: string;
    /** The item the inserter brings and the probe counts; the machine is given none of its other ingredients */
    ingredient: string;
    inserter: "inserter" | "stack-inserter";
    /** The machine is disabled by script: it cannot craft even if it had everything */
    inactive?: boolean;
    /** For each n the chest holds n items for a trial, so the hand is min(n, the inserter's capacity); 0 fills the chest */
    hands: number[];
    /** The stocks the probe sets at the start of each trial */
    stocks: number[];
    /** Trials from an empty machine in which the stock is set to each of these as soon as the inserter holds its hand */
    bumps?: number[];
    /** Modules put in the machine, which raise its crafting speed */
    modules?: {name: string; quality: string; count: number};
}

/** One game run: machines built side by side, the trials run one after the other, logged every tick */
export interface LimitRun {
    name: string;
    /** Force bonuses set before the run (the save has 3 and 11) */
    force?: {inserter_stack_size_bonus: number; bulk_inserter_capacity_bonus: number};
    scenarios: LimitCase[];
}

const range = (from: number, to: number) => Array.from({length: to - from + 1}, (_, k) => from + k);

/** The machine and recipe pairs, with the ingredient whose stock is swept and the largest stock of interest (the simulator's limit, plus a margin) */
interface Pair {
    key: string;
    entity: LimitCase["entity"];
    recipe?: string;
    ingredient: string;
    inactive?: boolean;
    modules?: LimitCase["modules"];
    /** The simulator's automated insertion limit for it: ceil(amount x multiplier), the multiplier from craft time and speed */
    simulator_limit: number;
}

const PAIRS: Pair[] = [
    {key: "am1-gear", entity: "assembling-machine-1", recipe: "iron-gear-wheel", ingredient: "iron-plate", inactive: true, simulator_limit: 6},
    {key: "am2-gear", entity: "assembling-machine-2", recipe: "iron-gear-wheel", ingredient: "iron-plate", inactive: true, simulator_limit: 6},
    {key: "am3-gear", entity: "assembling-machine-3", recipe: "iron-gear-wheel", ingredient: "iron-plate", inactive: true, simulator_limit: 8},
    {key: "am3-engine-pipe", entity: "assembling-machine-3", recipe: "engine-unit", ingredient: "pipe", inactive: true, simulator_limit: 4},
    {key: "am2-circuit", entity: "assembling-machine-2", recipe: "electronic-circuit", ingredient: "iron-plate", simulator_limit: 3},
    {key: "am2-circuit-inactive", entity: "assembling-machine-2", recipe: "electronic-circuit", ingredient: "iron-plate", inactive: true, simulator_limit: 3},
    {key: "am1-landfill", entity: "assembling-machine-1", recipe: "landfill", ingredient: "stone", inactive: true, simulator_limit: 150},
    {key: "stone-furnace-ore", entity: "stone-furnace", ingredient: "iron-ore", inactive: true, simulator_limit: 2},
    {key: "stone-furnace-ore-active", entity: "stone-furnace", ingredient: "iron-ore", simulator_limit: 2},
    {key: "steel-furnace-stone", entity: "steel-furnace", ingredient: "stone", inactive: true, simulator_limit: 4},
    {key: "stone-furnace-steel", entity: "stone-furnace", ingredient: "iron-plate", inactive: true, simulator_limit: 10},
    {key: "electric-furnace-ore", entity: "electric-furnace", ingredient: "iron-ore", inactive: true, simulator_limit: 2},
    // speed modules: the machine's crafting speed is 3.75 (+200%) and 7.5 (+500%), the craft takes 0.133 and 0.067 s
    {key: "am3-gear-speed", entity: "assembling-machine-3", recipe: "iron-gear-wheel", ingredient: "iron-plate", inactive: true,
        modules: {name: "speed-module-3", quality: "normal", count: 4}, simulator_limit: 20},
    {key: "am3-gear-legendary-speed", entity: "assembling-machine-3", recipe: "iron-gear-wheel", ingredient: "iron-plate", inactive: true,
        modules: {name: "speed-module-3", quality: "legendary", count: 4}, simulator_limit: 38},
    {key: "am3-pipe-legendary-speed", entity: "assembling-machine-3", recipe: "pipe", ingredient: "iron-plate", inactive: true,
        modules: {name: "speed-module-3", quality: "legendary", count: 4}, simulator_limit: 19},
];

/** Every stock up to a little past the limit; for a big limit, a sparse set and every stock within a hand of it */
function stocksFor(limit: number): number[] {
    if (limit <= 40) return range(0, limit + 3);
    return [0, 1, 25, 75, ...range(limit - 17, limit + 3)];
}

const scenarios = (hands: (inserter: LimitCase["inserter"]) => number[]): LimitCase[] =>
    PAIRS.flatMap(pair => (["inserter", "stack-inserter"] as const).map((inserter): LimitCase => ({
        name: `${pair.key}-${inserter}`, entity: pair.entity, ...(pair.recipe !== undefined && {recipe: pair.recipe}),
        ingredient: pair.ingredient, inserter, ...(pair.inactive && {inactive: true}), ...(pair.modules && {modules: pair.modules}),
        hands: hands(inserter), stocks: stocksFor(pair.simulator_limit),
        bumps: [pair.simulator_limit - 1, pair.simulator_limit, pair.simulator_limit + 2],
    })));

/** What the simulator says the limit is for each machine, by scenario name (without the inserter): see recordings.test.ts */
export const SIMULATOR_LIMITS: Record<string, number> = Object.fromEntries(PAIRS.map(pair => [pair.key, pair.simulator_limit]));

export const LIMIT_RUNS: LimitRun[] = [
    // the save's research: a basic inserter's hand is 4, a stack inserter's 16 (the hand of a legendary stack inserter)
    // (a stack inserter takes a smaller hand only with fewer bonuses: it waits for a full hand, so a chest with fewer items leaves it holding them)
    {name: "hand-large", scenarios: scenarios(inserter => inserter === "stack-inserter" ? [0] : [0, 2])},
    // 2 and 8
    {name: "hand-mid", force: {inserter_stack_size_bonus: 1, bulk_inserter_capacity_bonus: 3}, scenarios: scenarios(() => [0])},
    // no research: 1 and 5
    {name: "hand-small", force: {inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0}, scenarios: scenarios(() => [0])},
];
