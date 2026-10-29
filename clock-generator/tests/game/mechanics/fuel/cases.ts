/** One scenario of probe.lua: a burner on its own spot beside the build, its fuel and its supply */
export interface FuelCase {
    name: string;
    entity: "stone-furnace" | "steel-furnace" | "burner-mining-drill" | "captive-biter-spawner" | "biochamber";
    fuel: string;
    /** The recipe an assembling machine is set to */
    recipe?: string;
    /** Fuel items in the fuel slot at the start */
    count?: number;
    /** What is left of the burning item at the start, in MJ (the item is `fuel`) */
    remaining_mj?: number;
    /** work: supplied all run; idle: nothing to work on; passive: left alone; feed: an inserter from a chest of fuel; feed-idle: the same, nothing to work on */
    mode: "idle" | "work" | "passive" | "feed" | "feed-idle";
    /** The inserter type of a feed */
    inserter?: "inserter" | "fast-inserter" | "stack-inserter";
    /** Work stops at `gap` and resumes at `gap_end` (ticks); `gap_mode` is how it stops */
    gap?: number;
    gap_end?: number;
    gap_mode?: "ingredients" | "output" | "disabled";
    /** Ticks (as strings) at which `refuel_count` fuel items are put in the fuel slot */
    refuel?: Record<string, boolean>;
    refuel_count?: number;
    /** Stands where the drill of the scenario with this number (from 1) drops, which has no chest */
    at_drop_of?: number;
    no_chest?: boolean;
}

/** One game run: scenarios built side by side, logged every tick */
export interface FuelRun {
    name: string;
    ticks: number;
    /** Force bonuses set before the run: the inserters' hand sizes (the save has 3 and 11) */
    force?: {inserter_stack_size_bonus: number; bulk_inserter_capacity_bonus: number};
    /** Whether the save's mining productivity research stands; absent, it is put at 0 */
    productivity?: boolean;
    scenarios: FuelCase[];
}

const BIOFLUX = "biter-egg";

/** Each burner working steadily from a full fuel slot: the burn per tick, the swap of the burning item, the fuel's value */
const steady: FuelRun = {
    name: "steady", ticks: 6000, scenarios: [
        {name: "stone-coal", entity: "stone-furnace", fuel: "coal", count: 3, mode: "work"},
        {name: "stone-wood", entity: "stone-furnace", fuel: "wood", count: 6, mode: "work"},
        {name: "steel-coal", entity: "steel-furnace", fuel: "coal", count: 3, mode: "work"},
        {name: "steel-solid-fuel", entity: "steel-furnace", fuel: "solid-fuel", count: 2, remaining_mj: 0.0042, mode: "work"},
        {name: "drill-coal", entity: "burner-mining-drill", fuel: "coal", count: 4, mode: "work"},
        {name: "drill-wood", entity: "burner-mining-drill", fuel: "wood", count: 9, mode: "work"},
        {name: "spawner-bioflux", entity: "captive-biter-spawner", fuel: "bioflux", recipe: BIOFLUX, count: 3, mode: "work"},
        {name: "biochamber-nutrients", entity: "biochamber", fuel: "nutrients", recipe: "bioflux", count: 30, mode: "work"},
    ],
};

/** Idle machines, machines that stop and start, machines that run out of fuel and get it back, a drill into a furnace */
const stops: FuelRun = {
    name: "stops", ticks: 3000, scenarios: [
        {name: "stone-idle", entity: "stone-furnace", fuel: "coal", count: 3, remaining_mj: 1, mode: "idle"},
        {name: "drill-disabled-from-start", entity: "burner-mining-drill", fuel: "coal", count: 3, remaining_mj: 1, mode: "idle", gap: 0, gap_mode: "disabled"},
        {name: "stone-no-ingredients", entity: "stone-furnace", fuel: "coal", count: 3, mode: "work", gap: 600, gap_end: 900, gap_mode: "ingredients"},
        {name: "steel-no-ingredients", entity: "steel-furnace", fuel: "coal", count: 3, mode: "work", gap: 600, gap_end: 900, gap_mode: "ingredients"},
        {name: "stone-full-output", entity: "stone-furnace", fuel: "coal", count: 3, mode: "work", gap: 600, gap_end: 900, gap_mode: "output"},
        {name: "steel-full-output", entity: "steel-furnace", fuel: "coal", count: 3, mode: "work", gap: 600, gap_end: 900, gap_mode: "output"},
        {name: "drill-full-chest", entity: "burner-mining-drill", fuel: "coal", count: 3, mode: "work", gap: 600, gap_end: 900, gap_mode: "output"},
        {name: "drill-disabled", entity: "burner-mining-drill", fuel: "coal", count: 3, mode: "work", gap: 600, gap_end: 900, gap_mode: "disabled"},
        {name: "stone-disabled", entity: "stone-furnace", fuel: "coal", count: 3, mode: "work", gap: 600, gap_end: 900, gap_mode: "disabled"},
        {name: "biochamber-disabled", entity: "biochamber", fuel: "nutrients", recipe: "bioflux", count: 10, mode: "work", gap: 600, gap_end: 900, gap_mode: "disabled"},
        {name: "spawner-disabled", entity: "captive-biter-spawner", fuel: "bioflux", recipe: BIOFLUX, count: 3, mode: "work", gap: 650, gap_end: 900, gap_mode: "disabled"},
        {name: "spawner-full-output", entity: "captive-biter-spawner", fuel: "bioflux", recipe: BIOFLUX, count: 3, mode: "work", gap: 650, gap_end: 1300, gap_mode: "output"},
        {name: "biochamber-no-ingredients", entity: "biochamber", fuel: "nutrients", recipe: "bioflux", count: 10, mode: "work", gap: 550, gap_end: 900, gap_mode: "ingredients"},
        {name: "stone-runout", entity: "stone-furnace", fuel: "coal", count: 0, remaining_mj: 0.1, mode: "work", refuel: {"300": true}, refuel_count: 1},
        {name: "steel-runout", entity: "steel-furnace", fuel: "coal", count: 0, remaining_mj: 0.1, mode: "work", refuel: {"300": true}, refuel_count: 1},
        {name: "drill-runout", entity: "burner-mining-drill", fuel: "coal", count: 0, remaining_mj: 0.1, mode: "work", refuel: {"300": true}, refuel_count: 1},
        {name: "spawner-runout", entity: "captive-biter-spawner", fuel: "bioflux", recipe: BIOFLUX, count: 0, remaining_mj: 0.3, mode: "work", refuel: {"500": true}, refuel_count: 1},
        {name: "biochamber-runout", entity: "biochamber", fuel: "nutrients", recipe: "bioflux", count: 0, remaining_mj: 0.5, mode: "work", refuel: {"300": true}, refuel_count: 1},
        {name: "drill-into-furnace", entity: "burner-mining-drill", fuel: "coal", count: 3, mode: "work", no_chest: true},
        {name: "furnace-fed-by-drill", entity: "stone-furnace", fuel: "coal", count: 3, mode: "passive", at_drop_of: 19},
    ],
};

const fed = (name: string, entity: FuelCase["entity"], fuel: string, extra: Partial<FuelCase> = {}): FuelCase =>
    ({name, entity, fuel, mode: "feed", ...extra});

/** An inserter feeding each burner from a chest, at a hand size: how many items the fuel slot takes */
const feedScenarios = (): FuelCase[] => [
    fed("stone-coal", "stone-furnace", "coal"),
    fed("stone-coal-idle", "stone-furnace", "coal", {mode: "feed-idle"}),
    fed("stone-coal-fast", "stone-furnace", "coal", {inserter: "fast-inserter"}),
    fed("stone-coal-stack", "stone-furnace", "coal", {inserter: "stack-inserter"}),
    fed("stone-tree-seed", "stone-furnace", "tree-seed"),
    fed("stone-rocket-fuel", "stone-furnace", "rocket-fuel"),
    fed("steel-wood", "steel-furnace", "wood"),
    fed("steel-solid-fuel", "steel-furnace", "solid-fuel"),
    fed("drill-coal", "burner-mining-drill", "coal"),
    fed("drill-tree-seed", "burner-mining-drill", "tree-seed"),
    fed("drill-solid-fuel", "burner-mining-drill", "solid-fuel"),
    fed("spawner-bioflux", "captive-biter-spawner", "bioflux", {recipe: BIOFLUX}),
    fed("spawner-bioflux-stack", "captive-biter-spawner", "bioflux", {recipe: BIOFLUX, inserter: "stack-inserter"}),
    fed("biochamber-nutrients", "biochamber", "nutrients", {recipe: "bioflux"}),
    fed("biochamber-nutrients-idle", "biochamber", "nutrients", {recipe: "bioflux", mode: "feed-idle"}),
];

/** A drill with the save's mining productivity research: its fuel use against the items it makes */
const productive: FuelRun = {
    name: "drill-productivity", ticks: 1200, productivity: true, scenarios: [
        {name: "drill-coal", entity: "burner-mining-drill", fuel: "coal", count: 3, mode: "work"},
        {name: "drill-into-furnace", entity: "burner-mining-drill", fuel: "coal", count: 3, mode: "work", no_chest: true},
        {name: "furnace-fed-by-drill", entity: "stone-furnace", fuel: "coal", count: 3, mode: "passive", at_drop_of: 2},
    ],
};

export const FUEL_RUNS: FuelRun[] = [
    steady,
    stops,
    productive,
    {name: "feed-hand-1", ticks: 900, force: {inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0}, scenarios: feedScenarios()},
    {name: "feed-hand-4", ticks: 900, scenarios: feedScenarios()},
];
