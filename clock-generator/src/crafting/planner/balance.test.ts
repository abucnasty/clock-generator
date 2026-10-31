import { describe, expect, it } from "vitest";
import fs from "fs";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile, parseConfig } from "../../config/loader";
import type { Config } from "../../config/schema";
import { Duration } from "../../data-types/duration";
import Fraction, { fraction } from "../../data-types/fraction";
import type { MachineNode, PlannerFacts } from "../../data-types/planner-facts";
import { Entity } from "../../entities";
import { plannerGraphOf } from "../graph/build-graph";
import { madeTargetBalance } from "../sequence/cycle/cycle-transfers";
import { outputPathOf } from "../sequence/cycle/swing-counts";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { validateConfig } from "../plan/validate-config";
import { TargetProductionRate } from "../target-production-rate";
import { balanceBuildOf, balanceOf, LOOP_USES_ALL, periodCyclesOf } from "./balance";

/** The balance of a sample at so many output swings a cycle, with the cycle's exact ticks */
async function balanceAt(file: string, swings: number) {
    const config = await loadConfigFromFile(file) as Config;
    const registry = createEntityRegistryFromConfig(config);
    const target = TargetProductionRate.fromConfig(config.target_output);
    const machines = registry.getAll().filter(Entity.isMachine).filter(it => it.output.item_name === target.machine_production_rate.item);
    const ticks = fraction(16).divide(target.machine_production_rate.amount_per_tick.divide(machines.length)).multiply(swings);
    return { config, machines, ticks, balance: madeTargetBalance(machines, registry, config, fraction(swings), 16, ticks.toDecimal()) };
}

describe("the balance equations of accumulator 640", () => {
    // per copy 320/9 accumulators a second from two electromagnetic plants; iron from one foundry into both plants and both
    // battery plants, copper from another into the battery plants, batteries from each battery plant into one plant
    it("give the smallest period of whole hands: 486 ticks, 288 accumulators, hands of 9, 12, 30, 10 and 10", async () => {
        const { ticks, balance } = await balanceAt(ConfigPaths.ACCUMULATOR_640, 1);
        expect(ticks.toString()).toBe("54");
        const cycles = periodCyclesOf(balance.transfers);
        expect(ticks.multiply(cycles).toString()).toBe("486");
        const hands = Object.fromEntries(balance.transfers.map(it => [it.entity, it.total.multiply(cycles).toString()]));
        expect(hands).toEqual({
            // output, iron into each accumulator plant, batteries into each, iron into each battery plant, copper into each
            "inserter:1": "9", "inserter:2": "9",
            "inserter:3": "12", "inserter:4": "12",
            "inserter:6": "30", "inserter:8": "30",
            "inserter:5": "10", "inserter:7": "10",
            "inserter:9": "10", "inserter:10": "10",
        });
        // 9 hands of 16 out of each plant
        const made = ["machine:1", "machine:2"].reduce((sum, machine) => sum.add(balance.made.get(machine)!), fraction(0));
        expect(made.multiply(cycles).toString()).toBe("288");
        // every hand of a period is whole; the crafts need not be: 4/3 of the battery plants' a cycle at +200% productivity
        expect(balance.transfers.every(it => it.items.every(item => item.hands.multiply(cycles).getDenominator === 1))).toBe(true);
    });
});

describe("a loop of machines that uses up everything it makes", () => {
    // agricultural science: the two pentapod egg machines feed each other an egg a craft; set to give back 1 egg a craft,
    // as no recipe of the game gives back exactly what it takes
    it("is the named check: no amount of crafting meets the target", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE) as Config;
        const registry = createEntityRegistryFromConfig(config);
        const { facts } = balanceBuildOf(config);
        const eggs: PlannerFacts = {
            ...facts,
            nodes: facts.nodes.map(node => node.kind === "machine" && node.production.recipe_or_resource === "pentapod-egg"
                ? { ...node, yield: { ...node.yield, results: node.yield.results.map(result => ({ ...result, expected_per_craft: 1, per_craft: { numerator: 1, denominator: 1 } })) } } as MachineNode
                : node),
        };
        const science = registry.getAll().filter(Entity.isMachine).find(it => it.output.item_name === "agricultural-science-pack")!;
        const takers = outputPathOf(science, registry).feeders.map(it => ({ entity: it.entity_id.id, hand: 16 }));
        const seed = { counts: "made", item: "agricultural-science-pack", outputs: [{ machine: science.entity_id.id, takers, feeders: [] }],
            swings: fraction(1), hand: 16, idle_fillers: new Map() } as const;
        expect(() => balanceOf(facts, plannerGraphOf(facts), seed)).not.toThrow();
        expect(() => balanceOf(eggs, plannerGraphOf(eggs), seed)).toThrow(LOOP_USES_ALL("machine:4"));
    });
});

/** A sample's config as written, to make a fixture from */
const rawOf = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * Inserters that carry nothing: no filter, and their sink takes none of what their source gives. They have no edge of the
 * graph, yet the plan has always counted them: a container's fillers share what is taken from it among all of them, and
 * an inserter with no filter that takes the target out of its machine is one of its output inserters, with its own hand.
 * The figures are the demand walk's, which the balance replaced.
 */
describe("the balance with inserters that carry nothing", () => {
    const FIXTURES = {
        // stone bricks direct insert, and an inserter from the furnace into a buffer chest that takes only stone
        stone_bricks_and_an_empty_taker: () => {
            const it = rawOf(ConfigPaths.STONE_BRICKS_DIRECT_INSERT);
            it.chests = [{ type: "buffer-chest", id: 1, storage_size: 10, item_filter: "stone" }];
            it.inserters.push({ source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16 });
            return it;
        },
        // the steel wagon, and an inserter into its cargo wagon from a belt of copper plate, which the wagon takes none of
        steel_wagon_and_an_empty_filler: () => {
            const it = rawOf(ConfigPaths.STEEL_CARGO_WAGON);
            it.belts.push({ id: 2, type: "turbo-transport-belt", lanes: [{ ingredient: "copper-plate", stack_size: 4 }] });
            it.inserters.push({ id: 6, source: { type: "belt", id: 2 }, sink: { type: "chest", id: 2 }, prototype: "stack-inserter", quality: "legendary", stack_size: 16 });
            return it;
        },
    };

    const planOf = async (raw: unknown, fractional: boolean) => {
        const config = await parseConfig(JSON.stringify(raw)) as Config;
        const run = fractional ? { ...config, overrides: { ...config.overrides, use_fractional_swings: true } } as Config : config;
        try {
            const validation = validateConfig(run);
            return {
                lcm: validation.used_lcm,
                period: validation.period_ticks,
                transfers: validation.transfer_plan.entities.map(entity =>
                    `${entity.entity_id} ${entity.item_transfers.map(it => `${it.item_name} ${it.numerator}/${it.denominator}`).join(", ")}`),
            };
        } catch (error) {
            return { refused: (error as Error).message };
        }
    };

    it("an empty output inserter takes its share of the output swings, in its own hand", async () => {
        expect(await planOf(FIXTURES.stone_bricks_and_an_empty_taker(), false)).toEqual({
            lcm: 1, period: 144, transfers: ["inserter:1 stone-brick 3/1", "inserter:2 stone-brick 3/1", "drill:1 stone 8/1"],
        });
        expect(await planOf(FIXTURES.stone_bricks_and_an_empty_taker(), true)).toEqual({
            lcm: 16, period: 2448, transfers: ["inserter:1 stone-brick 51/16", "inserter:2 stone-brick 51/16", "drill:1 stone 17/2"],
        });
    });

    it("an empty filler of a container counts among its fillers", async () => {
        const plan = await planOf(FIXTURES.steel_wagon_and_an_empty_filler(), false);
        expect(plan).toMatchObject({
            lcm: 18,
            transfers: ["inserter:3 steel-plate 38/1", "inserter:2 steel-plate 38/1", "inserter:1 iron-plate 95/2",
                "inserter:4 iron-plate 95/6", "inserter:5 iron-ore 95/9"],
        });
        expect((plan as { period: number }).period).toBeCloseTo(25255.384615384617, 6);
        expect(await planOf(FIXTURES.steel_wagon_and_an_empty_filler(), true)).toEqual({
            refused: "Cannot satisfy fractional swing constraint: sub-cycle 0 requires 47 swings, but maximum allowed is 4 due to insertion limits. "
                + "Total swings: 765, cycle multiplier: 16.",
        });
    });
});

/**
 * The machine rows are solved loop by loop, the consumers first, where the demand walk eliminated all of them at once. In
 * exact fractions the two are the same; where the walk's elimination grew past what a fraction holds (machine:4 and
 * machine:5 of cell 02 listed in the other order) it was rounded, and the balance is not.
 */
describe("the balance's machine rows, solved loop by loop", () => {
    /** The transfers of a sample's config with its machines in reverse order, by entity, at so many output swings */
    const transfersAt = async (file: string, swings: Fraction, reversed: boolean): Promise<Map<string, Fraction>> => {
        const raw = rawOf(file);
        if (reversed) raw.machines.reverse();
        const config = await parseConfig(JSON.stringify(raw)) as Config;
        const registry = createEntityRegistryFromConfig(config);
        const target = TargetProductionRate.fromConfig(config.target_output);
        const machines = registry.getAll().filter(Entity.isMachine).filter(it => it.output.item_name === target.machine_production_rate.item);
        const ticks = fraction(16).divide(target.machine_production_rate.amount_per_tick.divide(machines.length)).multiply(swings);
        const balance = madeTargetBalance(machines, registry, config, swings, 16, Duration.ofTicks(ticks.toDecimal()).ticks);
        return new Map(balance.transfers.map(it => [it.entity, it.total]));
    };

    it("are exact on cell 02 in either order of its machines, where the demand walk's were rounded", async () => {
        const reversed = await transfersAt(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02, fraction(97, 13), true);
        const listed = await transfersAt(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02, fraction(97, 13), false);
        // the walk gave 184996821348687/9740259739640 in the reversed order
        expect(reversed.get("inserter:6")!.toString()).toBe("2716/143");
        expect([...reversed].map(([entity, total]) => `${entity} ${total}`).sort())
            .toEqual([...listed].map(([entity, total]) => `${entity} ${total}`).sort());
    });

    it("are rounded only where the exact figure does not fit a fraction: within a double's step of it", async () => {
        // processing units with a belt export, its machines reversed, 119/25 output swings: the export's hands come from the
        // cycle's ticks as a decimal (114.24), and the copper plate of the cables asked for both ways has a denominator of
        // 56 bits exactly, past a safe integer
        const transfers = await transfersAt(ConfigPaths.PROCESSING_UNITS_BELT_EXPORT, fraction(119, 25), true);
        const exportHands = transfers.get("inserter:12")!;
        // made a cycle: processing units 16 x 119/25; advanced circuits half of that; circuits 5 times it plus the export;
        // cables 16/11 of an advanced circuit and 6/5 of a circuit; copper plate 2/11 of a cable, in hands of 16
        type Q = [bigint, bigint];
        const q = (n: number | bigint, d: number | bigint = 1): Q => [BigInt(n), BigInt(d)];
        const add = (a: Q, b: Q): Q => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
        const mul = (a: Q, b: Q): Q => [a[0] * b[0], a[1] * b[1]];
        const units = q(1904, 25);
        const circuits = add(mul(q(5), units), mul(q(16), q(exportHands.getNumerator, exportHands.getDenominator)));
        const cables = add(mul(mul(units, q(1, 2)), q(16, 11)), mul(circuits, q(6, 5)));
        const exact = mul(cables, q(2, 11 * 16));
        const planned = transfers.get("inserter:11")!;
        expect(planned.getDenominator).toBeLessThanOrEqual(2 ** 43);
        // |planned - exact| / exact, under a double's relative step
        const difference = add(q(planned.getNumerator, planned.getDenominator), mul(exact, q(-1)));
        const relative = Number(difference[0] * 10n ** 30n / difference[1]) / 1e30 / (Number(exact[0]) / Number(exact[1]));
        expect(Math.abs(relative)).toBeLessThan(2 ** -52);
    });
});
