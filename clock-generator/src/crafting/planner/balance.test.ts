import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import type { Config } from "../../config/schema";
import { fraction } from "../../data-types/fraction";
import type { MachineNode, PlannerFacts } from "../../data-types/planner-facts";
import { Entity } from "../../entities";
import { plannerGraphOf } from "../graph/build-graph";
import { madeTargetBalance } from "../sequence/cycle/cycle-transfers";
import { outputPathOf } from "../sequence/cycle/swing-counts";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
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
        const takers = outputPathOf(science, registry).feeders.map(it => it.entity_id.id);
        const seed = { counts: "made", item: "agricultural-science-pack", outputs: [{ machine: science.entity_id.id, takers, feeders: [] }], swings: fraction(1), hand: 16 } as const;
        expect(() => balanceOf(facts, plannerGraphOf(facts), seed)).not.toThrow();
        expect(() => balanceOf(eggs, plannerGraphOf(eggs), seed)).toThrow(LOOP_USES_ALL("machine:4"));
    });
});
