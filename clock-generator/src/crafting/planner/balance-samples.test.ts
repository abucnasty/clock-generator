import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ConfigPaths, isExpectedRefusal } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import type { Config } from "../../config/schema";
import { Duration } from "../../data-types/duration";
import Fraction, { fraction } from "../../data-types/fraction";
import type { MachineNode } from "../../data-types/planner-facts";
import { Entity, handSizeFor } from "../../entities";
import { demandOf } from "../feasibility/demand";
import { destroyedTargetBalance, madeTargetBalance, transfersOfBalance } from "../sequence/cycle/cycle-transfers";
import { buildOutputInsertersOf, destroyedTargetCrafts, EntityTransferCountMap } from "../sequence/cycle/swing-counts";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { TargetProductionRate } from "../target-production-rate";
import { Balance, balanceBuildOf, DRILL_ITEMS_PER_SWING } from "./balance";
import { destroyedTargetBasisOf } from "./result-windows";

const SNAPSHOTS = path.join(__dirname, "__snapshots__");

/** Output swings a cycle the balance is checked at: whole, and fractions as fractional swings plan them */
const MADE_SWINGS = [fraction(1), fraction(2), fraction(3), fraction(7, 3), fraction(5, 2)];

/** A transfer map as lines, in its order: what the oracle compares and records */
function linesOf(map: EntityTransferCountMap): string[] {
    return map.entries_array().map(([id, it]) => [
        id.id,
        it.item_transfers.map(transfer => `${transfer.item_name} ${transfer.transfer_count}`).join(", "),
        `total ${it.total_transfer_count}`,
        ...(it.needed_transfer_count === undefined ? [] : [`needed ${it.needed_transfer_count}`]),
        `hand ${it.stack_size}`,
    ].join(" | "));
}

/** The lines of a run, or the error it throws */
function outcomeOf(run: () => EntityTransferCountMap): string[] {
    try {
        return linesOf(run());
    } catch (error) {
        return [`refused: ${(error as Error).message}`];
    }
}

/** A count of a sample the balance is checked at: its exact ticks, the balance, and the demand walk's transfers */
interface Case {
    readonly label: string;
    readonly ticks: Fraction;
    readonly balance: () => Balance;
    readonly old: () => EntityTransferCountMap;
}

/** The counts of a sample: output swings a cycle, or hands of a destroyed target brought into each machine */
function casesOf(config: Config): Case[] {
    const registry = createEntityRegistryFromConfig(config);
    const target = TargetProductionRate.fromConfig(config.target_output);
    const item = target.machine_production_rate.item;
    if (target.counts === "destroyed") {
        const basis = destroyedTargetBasisOf(target, registry, config.overrides ?? {});
        const machines = [...basis.machines];
        const craftsOf = (machine: typeof machines[number], brought: Fraction) => destroyedTargetCrafts(machine, registry, item, brought);
        return [...new Set([basis.base_hands, 1, 2 * basis.base_hands])].map(hands => ({
            label: `hands ${hands}`,
            ticks: basis.ticks_per_hand.multiply(hands),
            balance: () => destroyedTargetBalance(machines, registry, config, item, fraction(hands), craftsOf),
            old: () => EntityTransferCountMap.createForDestroyedTarget(machines, registry, item, fraction(hands)),
        }));
    }
    const machines = registry.getAll().filter(Entity.isMachine).filter(it => it.output.item_name === item);
    const stack = handSizeFor(buildOutputInsertersOf(machines[0], registry)[0], item);
    const ticks_per_swing = fraction(stack).divide(target.machine_production_rate.amount_per_tick.divide(machines.length));
    return MADE_SWINGS.map(swings => {
        const ticks = ticks_per_swing.multiply(swings);
        const cycle_ticks = Duration.ofTicks(ticks.toDecimal()).ticks;
        return {
            label: `swings ${swings}`,
            ticks,
            balance: () => madeTargetBalance(machines, registry, config, swings, stack, cycle_ticks),
            old: () => EntityTransferCountMap.create(machines, registry, swings, stack, cycle_ticks),
        };
    });
}

const samples = Object.entries(ConfigPaths).filter(([key]) => !isExpectedRefusal(key));

/**
 * Demands a cycle of today's plan carries less of than the feasibility demand needs, by sample, as `demand: carried <
 * needed`. A container that several inserters fill with different items passes on each item to an even share among all
 * of them, not among those that carry the item: the iron plate filler of the steel wagon hub plans half the plates the
 * steel furnace takes, and so the iron furnace half the ore it needs (the simulator judges the clock).
 */
const KNOWN_SHORT: Record<string, readonly string[]> = {
    STEEL_CARGO_WAGON: ["input:machine:iron-plate#iron-ore: 65/6 < 65/3"],
};

describe("the balance equations of a cycle", () => {
    describe.each(samples)("of %s", (key, file) => {
        it("give every transfer the demand walk gives, in its order, and are recorded", async () => {
            const config = await loadConfigFromFile(file) as Config;
            const registry = createEntityRegistryFromConfig(config);
            const recorded: Record<string, string[]> = {};
            for (const run of casesOf(config)) {
                const balanced = outcomeOf(() => transfersOfBalance(run.balance(), registry));
                expect(balanced, run.label).toEqual(outcomeOf(run.old));
                recorded[run.label] = balanced;
            }
            await expect(`${JSON.stringify({ sample: key, ...recorded }, null, 2)}\n`)
                .toMatchFileSnapshot(path.join(SNAPSHOTS, `${key}.balance.json`));
        });

        it("carry at least what the feasibility demand needs on the edges of every demand", async () => {
            const config = await loadConfigFromFile(file) as Config;
            const { facts, graph } = balanceBuildOf(config);
            const run = casesOf(config)[0];
            const balance = run.balance();
            const machine = new Map(facts.nodes.flatMap(node => node.kind === "machine" ? [[node.key, node] as const] : []));
            const perCraft = (node: MachineNode, item: string) => {
                const result = node.yield.results.find(it => it.item === item)!;
                return fraction(result.per_craft.numerator, result.per_craft.denominator);
            };
            const main = (node: MachineNode) => node.yield.results.find(it => it.main)!.item;
            // items a cycle of an edge: its hands (every entry of its item) times its hand, or what its placer makes of it
            const carriedOn = (edge: typeof graph.edges[number]): Fraction => {
                const placer = machine.get(edge.entity);
                if (edge.via === "placement" && placer !== undefined) {
                    const made = balance.made.get(placer.key) ?? fraction(0);
                    return made.divide(perCraft(placer, main(placer))).multiply(perCraft(placer, edge.item));
                }
                const transfer = balance.transfers.find(it => it.entity === edge.entity);
                const hands = (transfer?.items ?? []).filter(it => it.item === edge.item).reduce((sum, it) => sum.add(it.hands), fraction(0));
                return hands.multiply(edge.hand ?? DRILL_ITEMS_PER_SWING);
            };
            // fuel brought by an inserter of its own has a clock of its own: the cycle does not plan it
            const ownFuel = (demand: ReturnType<typeof demandOf>["demands"][number]) => demand.kind === "input"
                && demand.edges.every(edge => {
                    const sink = machine.get(edge.to);
                    return sink?.energy.fuel?.item === edge.item && !sink.production.inputs.some(input => input.item === edge.item)
                        && graph.edges.filter(other => other.entity === edge.entity).every(other => other.item === edge.item);
                });
            const short: string[] = [];
            for (const demand of demandOf(facts, graph).demands) {
                if (ownFuel(demand)) continue;
                const per_second = demand.edges.reduce((sum, edge) => sum.add(carriedOn(edge)), fraction(0)).multiply(60).divide(run.ticks);
                if (per_second.subtract(demand.amount).getNumerator < 0) short.push(`${demand.key}: ${per_second} < ${demand.amount}`);
            }
            expect(short).toEqual(KNOWN_SHORT[key] ?? []);
        });
    });

    it("keeps no record of a sample that is gone", () => {
        const keys = new Set(samples.map(([key]) => key));
        const files = fs.existsSync(SNAPSHOTS) ? fs.readdirSync(SNAPSHOTS).filter(file => file.endsWith(".balance.json")) : [];
        expect(files.filter(file => !keys.has(file.replace(/\.balance\.json$/, "")))).toEqual([]);
    });
});
