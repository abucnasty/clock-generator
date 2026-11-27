import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import Fraction from "../data-types/fraction";
import type { BlueprintEntityRead, RequestRead } from "./blueprint-entities";
import { decodeBlueprint } from "./decode";
import { COUNT_EMPTY_BEACONS, COUNT_NO_SPEED_BEACONS, ROUNDING, profileEntry, speedsOf } from "./speeds";
import type { SpeedData, SpeedResult, SpeedRow } from "./speeds";
import { worldOf } from "./world";
import type { WorldData } from "./world";

const ENGINE = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------- the data slices, built from the game data file

type DataFile = SpeedData & { entity_footprint: Record<string, { type: string; tile_width: number; tile_height: number }> };
const FILE = JSON.parse(fs.readFileSync(path.join(ENGINE, "resources", "data-filtered.json"), "utf8")) as DataFile;

/** The sections of the game data that the step reads */
function speedSlice(file: DataFile): SpeedData {
    return {
        quality: file.quality,
        module: file.module,
        beacon: file.beacon,
        crafting_machine: file.crafting_machine,
        rocket_silo: file.rocket_silo,
        "mining-drill": file["mining-drill"],
    };
}

/** The type and the size of each entity the step reads, as the world takes them */
function worldSlice(file: DataFile): WorldData {
    const names = [...Object.keys(file.crafting_machine), ...Object.keys(file.rocket_silo), ...Object.keys(file["mining-drill"]), ...Object.keys(file.beacon)];
    const rows: Record<string, { type: string; tile_width: number; tile_height: number }> = {};
    for (const name of names) rows[name] = file.entity_footprint[name];
    return rows;
}

const DATA = speedSlice(FILE);
const WORLD_DATA = worldSlice(FILE);

// ---------------------------------------------------------------- entities written in the test

function entity(entity_number: number, name: string, x: number, y: number, extra: Partial<BlueprintEntityRead> = {}): BlueprintEntityRead {
    return { entity_number, name, position: { x, y }, direction: 0, mirror: false, quality: "normal", requests: [], filters: [], use_filters: false, ...extra };
}

/** One request row for each module, in one inventory */
function modulesIn(inventory: number, items: [string, string?][]): RequestRead[] {
    return items.map(([item, quality = "normal"], stack) => ({ item, quality, inventory, stack }));
}

const times = <T>(count: number, value: T): T[] => Array.from({ length: count }, () => value);

const SPEED3: [string, string] = ["speed-module-3", "legendary"];
const LEGENDARY_BEACON = { quality: "legendary", requests: modulesIn(1, times(2, SPEED3)) };

function solve(entities: BlueprintEntityRead[], data: SpeedData = DATA, worldData: WorldData = WORLD_DATA): SpeedResult {
    return speedsOf(entities, worldOf(entities, worldData), data);
}

function rowOf(result: SpeedResult, entityNumber: number): SpeedRow {
    const row = result.rows.find(candidate => candidate.entity_number === entityNumber);
    if (!row) throw new Error(`no row for entity ${entityNumber}`);
    return row;
}

const fraction = (numerator: number, denominator = 1): string => new Fraction(numerator, denominator).toString();
const text = (value: Fraction | undefined): string | undefined => value?.toString();
const marks = (row: SpeedRow, field?: string): string[] => row.unread.filter(entry => field === undefined || entry.field === field).map(entry => `${entry.field}:${entry.reason}`);

// ---------------------------------------------------------------- the scaffolds and their reads

type ReadRow = {
    scaffold: string;
    entity_number: number;
    prototype: string;
    field: "crafting_speed" | "speed_bonus";
    read: number;
    read_id: string;
    derived: string;
    beacons: number[];
    productivity: string;
    cut_misses: boolean;
};
const READS = (JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "speeds", "speeds-reads.json"), "utf8")) as { rows: ReadRow[] }).rows;

const fractionOf = (written: string): string => {
    const [n, d] = written.split("/");
    return fraction(Number(n), Number(d));
};

const SOLVED = new Map<string, SpeedResult>();
function solveScaffold(scaffold: string): SpeedResult {
    const cached = SOLVED.get(scaffold);
    if (cached) return cached;
    const decoded = decodeBlueprint(fs.readFileSync(path.join(ENGINE, scaffold), "utf8"));
    if (decoded.kind !== "blueprint") throw new Error(`${scaffold} is no blueprint`);
    const result = solve(decoded.entities);
    SOLVED.set(scaffold, result);
    return result;
}

function allScaffolds(): string[] {
    const root = path.join(ENGINE, "resources", "config-samples");
    const found: string[] = [];
    for (const group of fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory())) {
        for (const sample of fs.readdirSync(path.join(root, group.name), { withFileTypes: true }).filter(e => e.isDirectory())) {
            for (const file of fs.readdirSync(path.join(root, group.name, sample.name)).filter(f => f.endsWith(".scaffold"))) {
                found.push(path.posix.join("resources", "config-samples", group.name, sample.name, file));
            }
        }
    }
    return found.sort();
}

const label = (row: ReadRow) => `${path.basename(row.scaffold, ".scaffold")}, ${row.prototype} ${row.entity_number} (read ${row.read})`;

describe("the 40 rows of the repository's scaffolds that a game read holds", () => {
    it("are 40, in 8 scaffolds", () => {
        expect(READS.length).toBe(40);
        expect(new Set(READS.map(row => row.scaffold)).size).toBe(8);
    });

    it.each(READS.map(row => [label(row), row] as const))("%s", (_, row) => {
        const result = rowOf(solveScaffold(row.scaffold), row.entity_number);
        const value = result[row.field];
        expect(value).toBeDefined();
        expect(Math.abs((value as Fraction).toDecimal() - row.read)).toBeLessThanOrEqual(1e-9 * Math.abs(row.read));
        expect(text(value)).toBe(fractionOf(row.derived));
        expect(result.beacons).toEqual(row.beacons);
        expect(result.productivity.toString()).toBe(fractionOf(row.productivity));
        expect(result.unread).toEqual([]);
    });
});

describe("the rows that rounding down misses", () => {
    const missed = READS.filter(row => row.cut_misses);

    it("are the two lithium cryogenic plants, the steel big mining drill, the recycler and productivity module foundry 8", () => {
        expect(missed.map(label).sort()).toEqual([
            "electromagnetic-240-recycler-belt-fed, recycler 68 (read 14.7805)",
            "lithium-plate-80-silo-chest, cryogenic-plant 12 (read 53.122)",
            "lithium-plate-80-silo-chest, cryogenic-plant 13 (read 53.122)",
            "productivity-module-80-chest-chain, foundry 54 (read 92.38799999999999)",
            "steel-plate-26-wagon-chest, big-mining-drill 1 (read 15.8244)",
        ]);
    });

    it.each(missed.map(row => [label(row), row] as const))("%s is read by rounding half up", (_, row) => {
        expect(ROUNDING).toEqual({ decimals: 4, tie: "half-up" });
        expect(text(solveScaffold(row.scaffold).rows.find(candidate => candidate.entity_number === row.entity_number)?.[row.field])).toBe(fractionOf(row.derived));
    });
});

describe("the repository's scaffolds as a whole", () => {
    const scaffolds = allScaffolds();

    it("are 34", () => {
        expect(scaffolds.length).toBe(34);
    });

    it.each(scaffolds)("%s: rows sorted by entity number, no request refused, the same twice", scaffold => {
        const first = solveScaffold(scaffold);
        const numbers = first.rows.map(row => row.entity_number);
        expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
        for (const row of first.rows) expect(marks(row).filter(entry => entry.includes("module-request"))).toEqual([]);
        const decoded = decodeBlueprint(fs.readFileSync(path.join(ENGINE, scaffold), "utf8"));
        if (decoded.kind !== "blueprint") throw new Error("no blueprint");
        expect(solve(decoded.entities)).toEqual(first);
    });
});

// ---------------------------------------------------------------- the cells of a recording of beacon mixes

type Cell = {
    id: string;
    group: string;
    note: string;
    machine: { name: string; quality: string; recipe: string | null; modules: [string, string][]; center: [number, number] };
    beacons: { quality: string; modules: [string, string][]; center: [number, number] }[];
    read: number;
    beacons_count: number;
    value_compared: boolean;
    expected_unread: string[];
};
const CELLS = (JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "speeds", "beacon-mix-cells.json"), "utf8")) as { cells: Cell[] }).cells;

function cellEntities(cell: Cell): BlueprintEntityRead[] {
    return [
        entity(1, cell.machine.name, cell.machine.center[0], cell.machine.center[1], {
            quality: cell.machine.quality,
            requests: modulesIn(4, cell.machine.modules),
            ...(cell.machine.recipe ? { recipe: cell.machine.recipe } : {}),
        }),
        ...cell.beacons.map((beacon, i) => entity(2 + i, "beacon", beacon.center[0], beacon.center[1], { quality: beacon.quality, requests: modulesIn(1, beacon.modules) })),
    ];
}

describe("the 73 cells of a recording of beacon mixes and qualities", () => {
    it("are 73, 71 of them compared in value", () => {
        expect(CELLS.length).toBe(73);
        expect(CELLS.filter(cell => cell.value_compared).length).toBe(71);
    });

    it.each(CELLS.map(cell => [`${cell.id}: ${cell.note}`, cell] as const))("%s", (_, cell) => {
        const row = rowOf(solve(cellEntities(cell)), 1);
        expect(row.beacons.length).toBe(cell.beacons_count);
        expect(row.unread.filter(entry => entry.field === "crafting_speed").map(entry => entry.reason)).toEqual(cell.expected_unread);
        const value = (row.crafting_speed as Fraction).toDecimal();
        if (cell.value_compared) expect(Math.abs(value - cell.read)).toBeLessThanOrEqual(1e-9 * cell.read);
    });

    it("T21 has an even tie and Q15 an epic beacon with legendary modules: marked, and not compared", () => {
        expect(CELLS.find(cell => cell.id === "T21")).toMatchObject({ value_compared: false, expected_unread: ["rounding-tie"] });
        expect(CELLS.find(cell => cell.id === "Q15")).toMatchObject({ value_compared: false, expected_unread: ["quality"] });
    });
});

describe("the rules written once", () => {
    it("count every beacon in reach, an empty one and one with efficiency modules included, and round half up to 4 decimals", () => {
        expect(COUNT_EMPTY_BEACONS).toBe(true);
        expect(COUNT_NO_SPEED_BEACONS).toBe(true);
        expect(ROUNDING).toEqual({ decimals: 4, tie: "half-up" });
    });
});

// ---------------------------------------------------------------- one case for each row of the unread table

/** A machine at tiles 0 to 2 with a beacon at tiles 5 to 7 beside it */
const AT_MACHINE = { x: 1.5, y: 1.5 };
const beaconAt = (n: number, x: number, y: number, extra: Partial<BlueprintEntityRead> = {}) => entity(n, "beacon", x, y, extra);

describe("rounding-tie", () => {
    it("marks an even tie: 3 normal beacons with 2 normal speed modules 3 on an assembling machine 3 (raw multiplier 3.59785)", () => {
        const beacons = [0, 1, 2].map(i => beaconAt(2 + i, 6.5, 1.5 + (i - 1) * 3, { requests: modulesIn(1, times(2, ["speed-module-3"])) }));
        const result = solve([entity(1, "assembling-machine-3", AT_MACHINE.x, AT_MACHINE.y), ...beacons]);
        const row = rowOf(result, 1);
        expect(row.beacons).toEqual([2, 3, 4]);
        // half up: 3.5979, and 1.25 times that
        expect(text(row.crafting_speed)).toBe(fraction(4497375, 1000000));
        expect(marks(row)).toEqual(["crafting_speed:rounding-tie"]);
    });

    it("does not mark an odd tie: 9.23875 is read as 92.388", () => {
        const row = READS.find(candidate => candidate.scaffold.includes("productivity-module-80") && candidate.entity_number === 54);
        expect(row).toBeDefined();
        const result = rowOf(solveScaffold((row as ReadRow).scaffold), 54);
        expect(text(result.crafting_speed)).toBe(fractionOf((row as ReadRow).derived));
        expect(result.unread).toEqual([]);
    });
});

describe("beacon-mix", () => {
    const standing = (extra: BlueprintEntityRead[]) => solve([entity(1, "assembling-machine-3", AT_MACHINE.x, AT_MACHINE.y), ...extra]);

    it("marks a beacon with modules of two names, and of two qualities", () => {
        const names = standing([beaconAt(2, 6.5, 1.5, { requests: modulesIn(1, [["speed-module-3"], ["speed-module-2"]]) })]);
        expect(marks(rowOf(names, 1), "crafting_speed")).toEqual(["crafting_speed:beacon-mix"]);
        const qualities = standing([beaconAt(2, 6.5, 1.5, { requests: modulesIn(1, [["speed-module-3"], ["speed-module-3", "legendary"]]) })]);
        expect(marks(rowOf(qualities, 1), "crafting_speed")).toContain("crafting_speed:beacon-mix");
    });

    it("marks beacons of two qualities and beacons whose modules differ", () => {
        const two = (a: Partial<BlueprintEntityRead>, b: Partial<BlueprintEntityRead>) => standing([beaconAt(2, 6.5, 0.5, a), beaconAt(3, 6.5, 3.5, b)]);
        const speed3 = { requests: modulesIn(1, times(2, ["speed-module-3"] as [string])) };
        expect(marks(rowOf(two({ ...speed3 }, { ...speed3, quality: "rare" }), 1), "crafting_speed")).toContain("crafting_speed:beacon-mix");
        expect(marks(rowOf(two(speed3, { requests: modulesIn(1, times(2, ["speed-module-2"] as [string])) }), 1), "crafting_speed")).toContain("crafting_speed:beacon-mix");
    });

    it("does not mark an empty slot, an empty beacon or an efficiency-only beacon, which all count in the one number of beacons", () => {
        const speed3 = { requests: modulesIn(1, times(2, ["speed-module-3"] as [string])) };
        const withEmptySlot = standing([beaconAt(2, 6.5, 0.5, speed3), beaconAt(3, 6.5, 3.5, { requests: modulesIn(1, [["speed-module-3"]]) })]);
        const withEmpty = standing([beaconAt(2, 6.5, 0.5, speed3), beaconAt(3, 6.5, 3.5)]);
        const withEfficiency = standing([beaconAt(2, 6.5, 0.5, speed3), beaconAt(3, 6.5, 3.5, { requests: modulesIn(1, times(2, ["efficiency-module-3"] as [string])) })]);
        for (const result of [withEmptySlot, withEmpty, withEfficiency]) {
            expect(rowOf(result, 1).beacons).toEqual([2, 3]);
            expect(marks(rowOf(result, 1), "crafting_speed")).not.toContain("crafting_speed:beacon-mix");
        }
        // one speed beacon and one empty beacon: n is 2, the entry 0.7071, so the multiplier is 1 + 1.5 x 0.7071 = 2.06065, an even tie read as 2.0607
        const one = standing([beaconAt(2, 6.5, 0.5, { requests: modulesIn(1, times(2, ["speed-module-3"] as [string])) }), beaconAt(3, 6.5, 3.5)]);
        expect(text(rowOf(one, 1).crafting_speed)).toBe(fraction(2575875, 1000000));
    });

    it("on a drill marks an empty slot, no speed effect, a mix, and beacons that differ; a full legendary beacon is not marked", () => {
        const drill = (extra: BlueprintEntityRead[]) => solve([entity(1, "electric-mining-drill", AT_MACHINE.x, AT_MACHINE.y, { quality: "legendary" }), ...extra]);
        const full = drill([beaconAt(2, 6.5, 1.5, LEGENDARY_BEACON)]);
        expect(rowOf(full, 1).unread).toEqual([]);
        // 1 + 2 modules x 1.25 x 2.5 = 7.25, so the bonus is 6.25
        expect(text(rowOf(full, 1).speed_bonus)).toBe(fraction(25, 4));
        const oneModule = drill([beaconAt(2, 6.5, 1.5, { quality: "legendary", requests: modulesIn(1, [SPEED3]) })]);
        expect(marks(rowOf(oneModule, 1))).toEqual(["speed_bonus:beacon-mix"]);
        const efficiency = drill([beaconAt(2, 6.5, 1.5, { quality: "legendary", requests: modulesIn(1, times(2, ["efficiency-module-3", "legendary"] as [string, string])) })]);
        expect(marks(rowOf(efficiency, 1))).toContain("speed_bonus:beacon-mix");
        const empty = drill([beaconAt(2, 6.5, 1.5, { quality: "legendary" })]);
        expect(marks(rowOf(empty, 1))).toContain("speed_bonus:beacon-mix");
        const differ = drill([beaconAt(2, 6.5, 0.5, LEGENDARY_BEACON), beaconAt(3, 6.5, 3.5, { quality: "legendary", requests: modulesIn(1, times(2, ["speed-module-2", "legendary"] as [string, string])) })]);
        expect(marks(rowOf(differ, 1))).toContain("speed_bonus:beacon-mix");
    });
});

describe("quality", () => {
    it("marks a row whose qualities fit no read: everything uncommon", () => {
        const result = solve([
            entity(1, "assembling-machine-3", AT_MACHINE.x, AT_MACHINE.y, { quality: "uncommon" }),
            beaconAt(2, 6.5, 1.5, { quality: "uncommon", requests: modulesIn(1, times(2, ["speed-module-3", "uncommon"] as [string, string])) }),
        ]);
        expect(marks(rowOf(result, 1))).toEqual(["crafting_speed:quality"]);
    });

    it("does not mark one group at another quality: a rare machine with normal beacons and modules, an epic beacon with normal modules", () => {
        const normalBeacon = (quality: string) => beaconAt(2, 6.5, 1.5, { quality, requests: modulesIn(1, times(2, ["speed-module-3"] as [string])) });
        expect(rowOf(solve([entity(1, "assembling-machine-3", 1.5, 1.5, { quality: "rare" }), normalBeacon("normal")]), 1).unread).toEqual([]);
        expect(rowOf(solve([entity(1, "assembling-machine-3", 1.5, 1.5), normalBeacon("epic")]), 1).unread).toEqual([]);
    });

    it("marks an epic beacon that holds legendary modules", () => {
        const result = solve([entity(1, "assembling-machine-3", 1.5, 1.5, { quality: "legendary" }), beaconAt(2, 6.5, 1.5, { quality: "epic", requests: modulesIn(1, times(2, SPEED3)) })]);
        expect(marks(rowOf(result, 1))).toEqual(["crafting_speed:quality"]);
    });

    it("marks the productivity too where an own productivity module is part of the unread combination", () => {
        const result = solve([
            entity(1, "assembling-machine-3", 1.5, 1.5, { quality: "uncommon", requests: modulesIn(4, [["productivity-module-3", "uncommon"]]) }),
            beaconAt(2, 6.5, 1.5, { quality: "uncommon", requests: modulesIn(1, times(2, ["speed-module-3", "uncommon"] as [string, string])) }),
        ]);
        expect(marks(rowOf(result, 1))).toEqual(["crafting_speed:quality", "productivity:quality"]);
    });

    it("on a drill marks a beacon or a module of any quality but legendary", () => {
        const normalOwn = solve([entity(1, "electric-mining-drill", 1.5, 1.5, { requests: modulesIn(2, [["speed-module-3"]]) })]);
        expect(marks(rowOf(normalOwn, 1))).toEqual(["speed_bonus:quality"]);
        const epicBeacon = solve([entity(1, "electric-mining-drill", 1.5, 1.5), beaconAt(2, 6.5, 1.5, { quality: "epic", requests: modulesIn(1, times(2, ["speed-module-3", "epic"] as [string, string])) })]);
        expect(marks(rowOf(epicBeacon, 1))).toEqual(["speed_bonus:quality"]);
    });

    it("lists a quality the game data does not hold, and marks the row", () => {
        const result = solve([entity(1, "assembling-machine-3", 1.5, 1.5, { quality: "mythic" })]);
        expect(result.problems).toEqual([{ entity_number: 1, problem: "unknown-quality" }]);
        expect(marks(rowOf(result, 1))).toEqual(["crafting_speed:quality"]);
    });
});

describe("effect-limit", () => {
    it("marks a total below -0.8: 8 productivity modules 3 in a cryogenic plant give the lowest speed, a fifth of its base", () => {
        const result = solve([entity(1, "cryogenic-plant", 2.5, 2.5, { requests: modulesIn(4, times(8, ["productivity-module-3"] as [string])) })]);
        const row = rowOf(result, 1);
        expect(text(row.crafting_speed)).toBe(fraction(2, 5));
        expect(row.productivity.toString()).toBe(fraction(80));
        expect(marks(row)).toEqual(["crafting_speed:effect-limit"]);
    });
});

describe("receiver-flags", () => {
    it("marks a machine that ignores the beacons around it: assembling machine 1", () => {
        const result = solve([entity(1, "assembling-machine-1", 1.5, 1.5), beaconAt(2, 6.5, 1.5, LEGENDARY_BEACON)]);
        const row = rowOf(result, 1);
        expect(text(row.crafting_speed)).toBe(fraction(1, 2));
        expect(row.beacons).toEqual([2]);
        expect(marks(row)).toEqual(["crafting_speed:receiver-flags", "productivity:receiver-flags"]);
    });

    it("does not mark a furnace that has no module and no beacon", () => {
        const result = solve([entity(1, "stone-furnace", 1, 1), entity(2, "steel-furnace", 11, 11)]);
        expect(rowOf(result, 1).unread).toEqual([]);
        expect(rowOf(result, 2).unread).toEqual([]);
    });
});

describe("allowed-effects", () => {
    it("a burner mining drill takes no effect from a beacon: bonus 0", () => {
        const result = solve([entity(1, "burner-mining-drill", 1, 1), beaconAt(2, 5.5, 1.5, LEGENDARY_BEACON)]);
        const row = rowOf(result, 1);
        expect(text(row.speed_bonus)).toBe("0");
        expect(marks(row)).toEqual(["speed_bonus:allowed-effects"]);
    });

    it("a rocket silo with a normal quality module 3: the quality effect is dropped and the speed effect -0.05 is kept", () => {
        const result = solve([entity(1, "rocket-silo", 4.5, 4.5, { requests: modulesIn(4, [["quality-module-3"]]) })]);
        const row = rowOf(result, 1);
        expect(text(row.crafting_speed)).toBe(fraction(19, 20));
        expect(marks(row)).toEqual(["crafting_speed:allowed-effects"]);
    });

    it("an oil refinery with speed modules 3 drops their quality effect and keeps their speed", () => {
        const result = solve([entity(1, "oil-refinery", 2.5, 2.5, { requests: modulesIn(4, times(2, ["speed-module-3"] as [string])) })]);
        const row = rowOf(result, 1);
        expect(text(row.crafting_speed)).toBe(fraction(2));
        expect(marks(row)).toEqual(["crafting_speed:allowed-effects"]);
    });

    it("a beacon with productivity modules passes no productivity, and marks every row it reaches", () => {
        const productivityBeacon = (n: number, x: number) => beaconAt(n, x, 1.5, { quality: "legendary", requests: modulesIn(1, times(2, ["productivity-module-3", "legendary"] as [string, string])) });
        const result = solve([
            entity(1, "assembling-machine-3", 1.5, 1.5),
            productivityBeacon(2, 6.5),
            entity(3, "biochamber", 101.5, 1.5),
            productivityBeacon(4, 106.5),
        ]);
        const am = rowOf(result, 1);
        // the speed effect -0.15 passes: 2 modules x -0.15 x 2.5 = -0.75, so the multiplier is 0.25 and the speed 1.25 x 0.25
        expect(text(am.crafting_speed)).toBe(fraction(5, 16));
        expect(am.productivity.toString()).toBe("0");
        expect(marks(am)).toEqual(["crafting_speed:allowed-effects", "productivity:allowed-effects"]);
        const bio = rowOf(result, 3);
        expect(text(bio.crafting_speed)).toBe(fraction(1, 2));
        expect(bio.productivity.toString()).toBe(fraction(50));
        // the consumption effect passes: 2 modules x 0.8 x 2.5 = 4, so +400%
        expect(text(bio.energy_consumption_bonus)).toBe(fraction(400));
        expect(marks(bio)).toEqual([
            "crafting_speed:allowed-effects",
            "productivity:allowed-effects",
            "energy_consumption_bonus:allowed-effects",
            "energy_consumption_bonus:consumption-not-read",
        ]);
    });

    it("a legendary beacon with 2 legendary speed modules 3 reaching an assembling machine 3 marks nothing", () => {
        const row = rowOf(solve([entity(1, "assembling-machine-3", 1.5, 1.5), beaconAt(2, 6.5, 1.5, LEGENDARY_BEACON)]), 1);
        // 1 + 2 x 1.25 x 2.5 = 7.25
        expect(text(row.crafting_speed)).toBe(fraction(145, 16));
        expect(row.unread).toEqual([]);
    });

    it("a machine whose list holds no effect takes none from a beacon", () => {
        const result = solve([entity(1, "captive-biter-spawner", 1.5, 1.5), beaconAt(2, 6.5, 1.5, LEGENDARY_BEACON)]);
        const row = rowOf(result, 1);
        expect(text(row.crafting_speed)).toBe("1");
        expect(marks(row)).toEqual(["crafting_speed:allowed-effects"]);
    });
});

describe("module-request", () => {
    it("marks an item that is no module in the module inventory", () => {
        const row = rowOf(solve([entity(1, "assembling-machine-3", 1.5, 1.5, { requests: [{ item: "iron-plate", quality: "normal", inventory: 4, stack: 0 }] })]), 1);
        expect(marks(row)).toEqual(["crafting_speed:module-request", "productivity:module-request"]);
        expect(text(row.crafting_speed)).toBe(fraction(5, 4));
    });

    it("marks a module in another inventory and does not count it", () => {
        const row = rowOf(solve([entity(1, "assembling-machine-3", 1.5, 1.5, { requests: modulesIn(3, [["speed-module-3"]]) })]), 1);
        expect(marks(row)).toEqual(["crafting_speed:module-request", "productivity:module-request"]);
        expect(text(row.crafting_speed)).toBe(fraction(5, 4));
    });

    it("marks more modules than slots, and counts the first ones", () => {
        const row = rowOf(solve([entity(1, "assembling-machine-3", 1.5, 1.5, { requests: modulesIn(4, times(5, ["speed-module-3"] as [string])) })]), 1);
        expect(marks(row)).toEqual(["crafting_speed:module-request", "productivity:module-request"]);
        expect(text(row.crafting_speed)).toBe(fraction(15, 4));
    });

    it("marks a beacon that holds a request the game cannot fill, on every row it reaches", () => {
        const row = rowOf(solve([entity(1, "assembling-machine-3", 1.5, 1.5), beaconAt(2, 6.5, 1.5, { requests: [{ item: "iron-plate", quality: "normal", inventory: 1, stack: 0 }] })]), 1);
        expect(marks(row)).toEqual(["crafting_speed:module-request", "productivity:module-request"]);
    });

    it("leaves out an item that is no module outside the module inventory (a burner's fuel)", () => {
        const row = rowOf(solve([entity(1, "biochamber", 1.5, 1.5, { requests: [{ item: "nutrients", quality: "normal", inventory: 1, stack: 0 }] })]), 1);
        expect(marks(row).filter(entry => entry.includes("module-request"))).toEqual([]);
    });

    it("counts the modules of a rocket silo in whatever inventory they stand, and ignores a silo's other items", () => {
        const row = rowOf(
            solve([
                entity(1, "rocket-silo", 4.5, 4.5, {
                    requests: [
                        { item: "speed-module-3", quality: "normal", inventory: 1, stack: 0 },
                        { item: "iron-plate", quality: "normal", inventory: 2, stack: 0 },
                    ],
                }),
            ]),
            1,
        );
        expect(text(row.crafting_speed)).toBe(fraction(3, 2));
        expect(marks(row).filter(entry => entry.includes("module-request"))).toEqual([]);
    });
});

describe("consumption-not-read", () => {
    const biochamber = (requests: RequestRead[]) => rowOf(solve([entity(1, "biochamber", 2.5, 2.5, { requests })]), 1);

    it("marks the energy consumption of a machine that burns nutrients, with speed modules and with efficiency modules", () => {
        const speed = biochamber(modulesIn(4, times(4, ["speed-module-3"] as [string])));
        // 4 x 0.7 = 2.8
        expect(text(speed.energy_consumption_bonus)).toBe(fraction(280));
        expect(marks(speed, "energy_consumption_bonus")).toEqual(["energy_consumption_bonus:consumption-not-read"]);
        const efficiency = biochamber(modulesIn(4, [["efficiency-module-3"]]));
        expect(text(efficiency.energy_consumption_bonus)).toBe(fraction(-50));
        expect(marks(efficiency, "energy_consumption_bonus")).toEqual(["energy_consumption_bonus:consumption-not-read"]);
        const tooMuch = biochamber(modulesIn(4, times(2, ["efficiency-module-3"] as [string])));
        expect(text(tooMuch.energy_consumption_bonus)).toBe(fraction(-80));
        expect(marks(tooMuch, "energy_consumption_bonus")).toEqual(["energy_consumption_bonus:effect-limit", "energy_consumption_bonus:consumption-not-read"]);
    });

    it("gives no consumption field to a machine that burns nothing else", () => {
        expect(rowOf(solve([entity(1, "assembling-machine-3", 1.5, 1.5)]), 1).energy_consumption_bonus).toBeUndefined();
    });
});

describe("reach", () => {
    // a recycler is 2 tiles wide and 4 tall facing north; facing east it is 4 wide and 2 tall
    const recycler = (direction: number) => entity(1, "recycler", 10, 10, { direction });
    const beacon = (x: number) => beaconAt(2, x, 9.5, LEGENDARY_BEACON);

    it("reaches a recycler facing east that a beacon reaches only when the recycler is turned", () => {
        expect(rowOf(solve([recycler(4), beacon(15.5)]), 1).beacons).toEqual([2]);
    });

    it("does not reach a recycler facing north across a shared edge of the reach", () => {
        expect(rowOf(solve([recycler(0), beacon(15.5)]), 1).beacons).toEqual([]);
    });

    it("does not reach a recycler facing east across a shared edge, one tile further out", () => {
        expect(rowOf(solve([recycler(4), beacon(16.5)]), 1).beacons).toEqual([]);
    });
});

describe("the beacon profile", () => {
    /** A silo in the middle of 128 normal beacons of one speed module each, with a reach of 15 tiles */
    const reaching = structuredClone(DATA);
    reaching.beacon.beacon.supply_area_distance = 15;
    const SILO = entity(1, "rocket-silo", 0.5, 0.5);
    const grid = (count: number, module = "speed-module"): BlueprintEntityRead[] => {
        const found: BlueprintEntityRead[] = [];
        for (let i = -6; i < 6 && found.length < count; i += 1) {
            for (let j = -6; j < 6 && found.length < count; j += 1) {
                const x = i * 3 + 1.5;
                const y = j * 3 + 1.5;
                if (Math.abs(x - 0.5) < 6 && Math.abs(y - 0.5) < 6) continue;
                found.push(beaconAt(2 + found.length, x, y, { requests: modulesIn(1, [[module]]) }));
            }
        }
        return found;
    };

    /** The profile entry of n beacons as a whole number of ten-thousandths: the integer square root of 10^8 / n */
    const entryOf = (n: number): bigint => {
        let low = 0n;
        let high = 10000n;
        const target = 10n ** 8n / BigInt(n);
        while (low < high) {
            const mid = (low + high + 1n) / 2n;
            if (mid * mid <= target) low = mid;
            else high = mid - 1n;
        }
        return low;
    };

    it("gives the entry of each of the 100 beacon counts as its 4-decimal fraction", () => {
        for (let n = 1; n <= 100; n += 1) {
            const e = entryOf(n);
            // each beacon: 1.5 x 0.2 = 0.3; the multiplier in ten-thousandths is 10000 + 3 n e / 10, rounded half up
            const scaled = 10000n + (3n * BigInt(n) * e + 5n) / 10n;
            const row = rowOf(solve([SILO, ...grid(n)], reaching), 1);
            expect(row.beacons.length).toBe(n);
            expect(text(row.crafting_speed)).toBe(new Fraction(Number(scaled), 10000).toString());
        }
    });

    it("reads each of the 100 entries of the data file as its 4-decimal fraction, float noise snapped", () => {
        const profile = FILE.beacon.beacon.profile ?? [];
        expect(profile.length).toBe(100);
        profile.forEach((value, index) => {
            const read = profileEntry(value);
            // read.n / read.d equals entryOf(n) / 10000, for example 7071/10000 and 4472/10000, not 0.44719999999999993
            expect(read.n * 10000n, `entry ${index + 1}`).toBe(entryOf(index + 1) * read.d);
        });
    });

    it("rounds a beacon sum that lands on an exact tie only when the noisy entry of 5 beacons is snapped to 4 decimals", () => {
        // 5 beacons of one module of speed 0.0625 and an effectivity of 1: the sum is 0.3125, and 0.4472 x 0.3125 = 0.13975 is a tie at the fifth decimal.
        // The entry in the data file is 0.44719999999999993, which gives 0.139749999999999978 and the rounded value 1.1397 where the cut gives 1.1398.
        const tie: SpeedData = {
            ...reaching,
            beacon: { ...reaching.beacon, beacon: { ...reaching.beacon.beacon, distribution_effectivity: 1 } },
            module: { ...reaching.module, "tie-speed-module": { category: "speed", effect: { speed: 0.0625 } } },
        };
        const row = rowOf(solve([SILO, ...grid(5, "tie-speed-module")], tie), 1);
        expect(row.beacons.length).toBe(5);
        expect(text(row.crafting_speed)).toBe(fraction(11398, 10000));
        expect(row.unread).toEqual([]);
    });

    it("reads the entry of 100 for a count past 100", () => {
        const e = entryOf(100);
        const scaled = 10000n + (3n * 105n * e + 5n) / 10n;
        const row = rowOf(solve([SILO, ...grid(105)], reaching), 1);
        expect(row.beacons.length).toBe(105);
        expect(text(row.crafting_speed)).toBe(new Fraction(Number(scaled), 10000).toString());
    });

    it("reads a profile that the data leaves out as one entry of 1", () => {
        const noProfile = structuredClone(DATA);
        delete noProfile.beacon.beacon.profile;
        const row = rowOf(solve([entity(1, "assembling-machine-3", 1.5, 1.5), beaconAt(2, 6.5, 0.5, { requests: modulesIn(1, [["speed-module"], ["speed-module"]]) }), beaconAt(3, 6.5, 3.5, { requests: modulesIn(1, [["speed-module"], ["speed-module"]]) })], noProfile), 1);
        // 2 beacons x 2 modules x 0.2 x 1.5 = 1.2, so the multiplier is 2.2 and the speed 1.25 x 2.2
        expect(text(row.crafting_speed)).toBe(fraction(11, 4));
    });

    it("passes no effect through a beacon whose data leaves out allowed_effects, and marks the speed", () => {
        // BeaconPrototype's allowed_effects defaults to "No effects are allowed" (api-015-005)
        const noAllowed = structuredClone(DATA);
        delete noAllowed.beacon.beacon.allowed_effects;
        const row = rowOf(solve([entity(1, "assembling-machine-3", 1.5, 1.5), beaconAt(2, 6.5, 0.5, { requests: modulesIn(1, [["speed-module"], ["speed-module"]]) }), beaconAt(3, 6.5, 3.5, { requests: modulesIn(1, [["speed-module"], ["speed-module"]]) })], noAllowed), 1);
        expect(text(row.crafting_speed)).toBe(fraction(5, 4));
        expect(row.unread).toContainEqual({ field: "crafting_speed", reason: "allowed-effects" });
    });
});

describe("problems and totality", () => {
    it("lists a beacon whose footprint is not square, and leaves it out", () => {
        const world: WorldData = { ...WORLD_DATA, beacon: { type: "beacon", tile_width: 3, tile_height: 2 } };
        const result = solve([entity(1, "assembling-machine-3", 1.5, 1.5), beaconAt(2, 6.5, 1, LEGENDARY_BEACON)], DATA, world);
        expect(result.problems).toEqual([{ entity_number: 2, problem: "beacon-not-square" }]);
        expect(rowOf(result, 1).beacons).toEqual([]);
    });

    it("lists an entity the world could not place, and an entity the data has no row for", () => {
        const world: WorldData = { ...WORLD_DATA, "assembling-machine-3": { type: "assembling-machine" } };
        expect(solve([entity(1, "assembling-machine-3", 1.5, 1.5)], DATA, world)).toEqual({ rows: [], problems: [{ entity_number: 1, problem: "not-placed" }] });
        const data = structuredClone(DATA);
        delete (data.crafting_machine as Record<string, unknown>)["assembling-machine-3"];
        expect(solve([entity(1, "assembling-machine-3", 1.5, 1.5)], data)).toEqual({ rows: [], problems: [{ entity_number: 1, problem: "no-data" }] });
    });

    it("makes no row for an entity that is no machine, drill or silo, nor for a pumpjack or a lab", () => {
        const result = solve([entity(1, "pumpjack", 1.5, 1.5), entity(2, "iron-chest", 10.5, 10.5), entity(3, "beacon", 20.5, 20.5)]);
        expect(result).toEqual({ rows: [], problems: [] });
    });

    it("gives the same result for the same input, in any order of the entities, with rows sorted by entity number", () => {
        const entities = [
            entity(7, "assembling-machine-3", 101.5, 1.5),
            beaconAt(5, 106.5, 1.5, LEGENDARY_BEACON),
            entity(3, "electric-mining-drill", 1.5, 1.5),
            beaconAt(9, 6.5, 1.5, LEGENDARY_BEACON),
            entity(1, "rocket-silo", 50.5, 50.5),
        ];
        const forward = solve(entities);
        expect(solve(entities)).toEqual(forward);
        expect(solve([...entities].reverse())).toEqual(forward);
        expect(forward.rows.map(row => row.entity_number)).toEqual([1, 3, 7]);
    });

    it("does not throw on an empty paste, on repeated numbers, or on data with no sections", () => {
        expect(solve([])).toEqual({ rows: [], problems: [] });
        expect(() => solve([entity(1, "assembling-machine-3", 1.5, 1.5), entity(1, "beacon", 6.5, 1.5)])).not.toThrow();
        const bare = { quality: {}, module: {}, beacon: {}, crafting_machine: {}, rocket_silo: {}, "mining-drill": {} } as SpeedData;
        expect(() => solve([entity(1, "assembling-machine-3", 1.5, 1.5), entity(2, "beacon", 6.5, 1.5)], bare)).not.toThrow();
    });
});
