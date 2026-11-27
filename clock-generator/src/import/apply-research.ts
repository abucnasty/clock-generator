/**
 * Research on a build: the one place that writes the five fields that research gives a value to, and the check that finds a
 * value that was edited by hand since.
 *
 * A build keeps the values that the generator reads: a machine's, a drill's and a rocket silo's `productivity`, an inserter's
 * `stack_size` and the `stack_size` of each belt lane. `applyResearch` writes them from the final numbers of a research
 * profile and from the base, which holds what each entity has apart from research. The numbers it used and the base are the
 * build's `research` block, so a build that was imported once can take another profile without its blueprint. Nothing here
 * rounds, and nothing writes a row that the base does not name.
 */
import type { Config } from "../config/schema";
import type { ResearchBase, ResearchBlock, ResearchBonuses } from "../config/research-block";
import type { FactorioData } from "../data/factorio-data-types";

/** The parts of a config that research changes */
export type ResearchBuild = Pick<Config, "machines" | "drills" | "inserters" | "belts" | "chests">;

/** The research that is put on a build: the profile's name and template, and its numbers */
export type ResearchChoice = Pick<ResearchBlock, "profile" | "template" | "bonuses">;

export type { ResearchBase, ResearchBlock, ResearchBonuses };

/** The most that a belt holds in one stack, whatever the bonus */
const BELT_STACK_MAX = 4;
/** The most that a recipe gives, as a multiple of 1, where its data names none */
const DEFAULT_MAXIMUM_PRODUCTIVITY = 3;
/** The inserter prototype of an inserter that names none */
const DEFAULT_INSERTER = "stack-inserter";
/** Productivity values that differ by less than this are the same value */
const PRODUCTIVITY_TOLERANCE = 1e-6;

/** The entities that research changes, by the name that the results use */
export type ResearchKind = "machine" | "drill" | "silo" | "inserter" | "belt";

/** Why a row is left as it is */
export type OutsideReason =
    | "its id is not in the base"
    | "it is an inserter with no id"
    | "its recipe differs from its base row"
    | "its recipe is not in the data"
    | "its prototype is not in the data";

/** A value that is not what the research gives */
export interface ResearchEdit {
    kind: "machine" | "drill" | "silo" | "inserter" | "lane";
    id: number;
    /** For a lane, its place in the belt's `lanes`: 1 or 2 */
    lane?: 1 | 2;
    expected: number;
    actual: number;
}

/** A row that research leaves as it is: it is not the base's, so the check cannot say what research gives it */
export interface ResearchOutside {
    kind: ResearchKind;
    /** Absent for an inserter that has none */
    id?: number;
    reason: OutsideReason;
}

export type ResearchDifferences = { recorded: false } | { recorded: true; edited: ResearchEdit[]; outside: ResearchOutside[] };

type Row = Record<string, unknown>;

interface Write {
    kind: ResearchEdit["kind"];
    id: number;
    lane?: 1 | 2;
    /** What the build holds now, where the field is there */
    actual: number | undefined;
    /** What it holds when the field is absent: the rule of the schema */
    absent: number;
    expected: number;
    put: (next: Draft) => void;
}

interface Draft {
    machines: Row[];
    drills?: { configs: Row[] };
    inserters: Row[];
    belts: Row[];
    chests?: Row[];
}

const byId = <T extends { id: number }>(rows: readonly T[]): Map<number, T> => {
    const map = new Map<number, T>();
    for (const row of rows) if (!map.has(row.id)) map.set(row.id, row);
    return map;
};

/** The most that a recipe's total may be, in percent */
function capOf(data: FactorioData, recipe: string): number {
    const maximum = data.recipe[recipe]?.maximum_productivity;
    return 100 * (typeof maximum === "number" ? maximum : DEFAULT_MAXIMUM_PRODUCTIVITY);
}

/** A crafting machine's total: the research is added to the base, then the total is held between 0 and the recipe's cap */
const craftingTotal = (data: FactorioData, recipe: string, base: number, bonuses: ResearchBonuses): number =>
    Math.min(capOf(data, recipe), Math.max(0, base + (bonuses.recipes[recipe]?.productivity_bonus ?? 0)));

/** The hand of an inserter of that prototype: 1, the prototype's own bonus, and the research of its kind */
function handOf(data: FactorioData, prototype: string, bulkBonus: number, otherBonus: number): number | null {
    const spec = data.inserter[prototype];
    if (spec === undefined) return null;
    return 1 + (spec.stack_size_bonus ?? 0) + (spec.bulk ? bulkBonus : otherBonus);
}

const laneStack = (bonuses: ResearchBonuses): number => Math.min(BELT_STACK_MAX, 1 + bonuses.belt_stack_size_bonus);

/** The values research gives, and the rows it leaves as they are */
function plan(build: ResearchBuild, base: ResearchBase, bonuses: ResearchBonuses, data: FactorioData): { writes: Write[]; outside: ResearchOutside[] } {
    const writes: Write[] = [];
    const outside: ResearchOutside[] = [];
    const total = data.inserter_research;

    const machineBase = byId(base.machines);
    (build.machines as unknown as Row[]).forEach((machine, index) => {
        const id = machine.id as number;
        const row = machineBase.get(id);
        const recipe = machine.recipe as string;
        if (row === undefined) return void outside.push({ kind: "machine", id, reason: "its id is not in the base" });
        if (row.recipe !== recipe) return void outside.push({ kind: "machine", id, reason: "its recipe differs from its base row" });
        if (data.recipe[recipe] === undefined) return void outside.push({ kind: "machine", id, reason: "its recipe is not in the data" });
        writes.push({
            kind: "machine", id, actual: machine.productivity as number, absent: 0, expected: craftingTotal(data, recipe, row.productivity, bonuses),
            put: next => { next.machines[index] = { ...next.machines[index], productivity: craftingTotal(data, recipe, row.productivity, bonuses) }; },
        });
    });

    const drillBase = byId(base.drills);
    ((build.drills?.configs ?? []) as unknown as Row[]).forEach((drill, index) => {
        const id = drill.id as number;
        const row = drillBase.get(id);
        if (row === undefined) return void outside.push({ kind: "drill", id, reason: "its id is not in the base" });
        // a drill's research and modules add up without a cap
        const expected = Math.max(0, row.productivity + bonuses.mining_drill_productivity_bonus);
        writes.push({
            kind: "drill", id, actual: drill.productivity as number, absent: 0, expected,
            put: next => { next.drills!.configs[index] = { ...next.drills!.configs[index], productivity: expected }; },
        });
    });

    const siloBase = byId(base.silos);
    ((build.chests ?? []) as unknown as Row[]).forEach((chest, index) => {
        if (chest.type !== "rocket-silo") return;
        const id = chest.id as number;
        const row = siloBase.get(id);
        if (row === undefined) return void outside.push({ kind: "silo", id, reason: "its id is not in the base" });
        if (data.recipe[row.recipe] === undefined) return void outside.push({ kind: "silo", id, reason: "its recipe is not in the data" });
        const expected = craftingTotal(data, row.recipe, row.productivity, bonuses);
        writes.push({
            kind: "silo", id, actual: chest.productivity as number | undefined, absent: 0, expected,
            put: next => { next.chests![index] = { ...next.chests![index], productivity: expected }; },
        });
    });

    const inserterBase = byId(base.inserters);
    (build.inserters as unknown as Row[]).forEach((inserter, index) => {
        const id = inserter.id as number | undefined;
        if (id === undefined) return void outside.push({ kind: "inserter", reason: "it is an inserter with no id" });
        const row = inserterBase.get(id);
        if (row === undefined) return void outside.push({ kind: "inserter", id, reason: "its id is not in the base" });
        const prototype = (inserter.prototype as string | undefined) ?? DEFAULT_INSERTER;
        const hand = handOf(data, prototype, bonuses.bulk_inserter_capacity_bonus, bonuses.inserter_stack_size_bonus);
        if (hand === null) return void outside.push({ kind: "inserter", id, reason: "its prototype is not in the data" });
        const expected = row.stack_size ?? hand;
        writes.push({
            kind: "inserter", id, actual: inserter.stack_size as number | undefined, expected,
            absent: handOf(data, prototype, total.bulk_inserter_capacity_bonus, total.inserter_stack_size_bonus)!,
            put: next => { next.inserters[index] = { ...next.inserters[index], stack_size: expected }; },
        });
    });

    const beltBase = byId(base.belts);
    (build.belts as unknown as Row[]).forEach((belt, index) => {
        const id = belt.id as number;
        if (!beltBase.has(id)) return void outside.push({ kind: "belt", id, reason: "its id is not in the base" });
        const expected = laneStack(bonuses);
        (belt.lanes as Row[]).forEach((lane, place) => {
            writes.push({
                kind: "lane", id, lane: (place + 1) as 1 | 2, actual: lane.stack_size as number, absent: expected, expected,
                put: next => {
                    const lanes = (next.belts[index].lanes as Row[]).slice();
                    lanes[place] = { ...lanes[place], stack_size: expected };
                    next.belts[index] = { ...next.belts[index], lanes };
                },
            });
        });
    });

    return { writes, outside };
}

/**
 * Puts the research on the build: writes the five fields of each row that the base names, from the choice's numbers, and
 * gives the block that says so. It writes a machine's and a silo's productivity as the game pays it (the base and the
 * recipe's research, held between 0 and the recipe's cap, 3 where its data names none), a drill's as the sum without a cap,
 * an inserter's hand as the base states it or as its prototype and the research give it, and every lane of a belt as 1 and
 * the belt bonus, at most 4. A recipe that the choice does not name has 0. A row is left as it is where the rules of
 * `researchDifferences` list it as outside. The build and the base are not changed.
 */
export function applyResearch<T extends ResearchBuild>(build: T, base: ResearchBase, choice: ResearchChoice, data: FactorioData): { build: T; block: ResearchBlock } {
    const next: Draft = {
        machines: (build.machines as unknown as Row[]).slice(),
        ...(build.drills !== undefined && { drills: { ...build.drills, configs: (build.drills.configs as unknown as Row[]).slice() } }),
        inserters: (build.inserters as unknown as Row[]).slice(),
        belts: (build.belts as unknown as Row[]).slice(),
        ...(build.chests !== undefined && { chests: (build.chests as unknown as Row[]).slice() }),
    };
    for (const write of plan(build, base, choice.bonuses, data).writes) write.put(next);
    return { build: { ...build, ...next } as unknown as T, block: { profile: choice.profile, template: choice.template, bonuses: choice.bonuses, base } };
}

/**
 * Finds the values that were edited by hand since the research was put on: each value of the build that differs from what
 * `applyResearch` gives it from the build's own block, and each row that research leaves as it is. A config with no block
 * has none recorded. A value that is absent counts as the rule of the schema gives it: an inserter's hand is what all the
 * research gives, a silo's productivity is 0.
 */
export function researchDifferences(config: ResearchBuild & { research?: ResearchBlock }, data: FactorioData): ResearchDifferences {
    const block = config.research;
    if (block === undefined) return { recorded: false };
    const { writes, outside } = plan(config, block.base, block.bonuses, data);
    const edited: ResearchEdit[] = writes
        .map(write => ({ write, actual: write.actual ?? write.absent }))
        .filter(({ write, actual }) => !(Math.abs(actual - write.expected) < PRODUCTIVITY_TOLERANCE))
        .map(({ write, actual }) => ({
            kind: write.kind, id: write.id, ...(write.lane !== undefined && { lane: write.lane }), expected: write.expected, actual,
        }));
    return { recorded: true, edited, outside };
}
