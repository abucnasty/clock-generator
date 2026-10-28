import fs from "fs";
import path from "path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { fraction } from "../../data-types/fraction";
import type * as Facts from "../../data-types/planner-facts";
import { buildTraits, InserterTraits } from "../../entities/traits/build-traits";
import { EnergyTrait } from "../../entities/traits/energy";
import { HandTrait } from "../../entities/traits/hand";
import { InputLimitsTrait } from "../../entities/traits/input-limits";
import { LaneTrait } from "../../entities/traits/lane";
import { LoopTrait } from "../../entities/traits/loop";
import { OutputBlockTrait } from "../../entities/traits/output-block";
import { PlacementTrait } from "../../entities/traits/placement";
import { ProductionTrait } from "../../entities/traits/production";
import { ratioOf } from "../../entities/traits/ratio";
import { SpoilageTrait } from "../../entities/traits/spoilage";
import { StorageTrait } from "../../entities/traits/storage";
import { YieldTrait } from "../../entities/traits/yield";
import { toPlannerFacts } from "./to-planner-facts";

const SNAPSHOTS = path.join(__dirname, "__snapshots__");

/** The facts as the snapshot keeps them */
const jsonOf = (facts: Facts.PlannerFacts) => `${JSON.stringify(facts, null, 2)}\n`;

async function factsOf(file: string): Promise<Facts.PlannerFacts> {
    return toPlannerFacts(await loadConfigFromFile(file) as Config);
}

/**
 * Of each sample, the edges whose drop spot (`sink.drop.lane`) is not the lane the trait rounds their hand to: none yet.
 * The simulator drops on the spot (belt-drop-logic dropOffToLane) with a hand rounded to the other lane (inserterHands),
 * and the facts count the drop floor on the spot, so a sample that has one changes the graph and the floors: list it
 * here on purpose, as "<edge>: <rounding lane> -> <drop lane>".
 */
const MOVED_DROPS: Readonly<Record<string, readonly string[]>> = {};

describe("the planner facts", () => {
    it("carry the traits field for field: the light types are the traits' types", () => {
        expectTypeOf<Facts.ProductionFacts>().toEqualTypeOf<ProductionTrait>();
        expectTypeOf<Facts.YieldFacts>().toEqualTypeOf<YieldTrait>();
        expectTypeOf<Facts.InputLimitsFacts>().toEqualTypeOf<InputLimitsTrait>();
        expectTypeOf<Facts.OutputBlockFacts>().toEqualTypeOf<OutputBlockTrait>();
        expectTypeOf<Facts.PlacementFacts>().toEqualTypeOf<PlacementTrait>();
        expectTypeOf<Facts.StorageFacts>().toEqualTypeOf<StorageTrait>();
        expectTypeOf<Facts.LaneFacts>().toEqualTypeOf<LaneTrait>();
        expectTypeOf<Facts.EnergyFacts>().toEqualTypeOf<EnergyTrait>();
        expectTypeOf<Facts.SpoilageFacts>().toEqualTypeOf<SpoilageTrait>();
        expectTypeOf<Facts.LoopFacts>().toEqualTypeOf<LoopTrait>();
        // an edge's hand is the inserter's, with its hand of the edge's item
        expectTypeOf<keyof Facts.EdgeHandFacts>().toEqualTypeOf<keyof HandTrait>();
    });

    describe.each(Object.entries(ConfigPaths))("of %s", (key, file) => {
        it("match the snapshot, are plain data and come out the same each time", async () => {
            const facts = await factsOf(file);
            const json = jsonOf(facts);
            // JSON-safe: no class instance, no undefined field, no NaN
            expect(JSON.parse(json)).toStrictEqual(facts);
            // deterministic: built again from the config read again, byte for byte the same
            expect(jsonOf(await factsOf(file))).toBe(json);
            await expect(json).toMatchFileSnapshot(path.join(SNAPSHOTS, `${key}.facts.json`));
        });

        it("hold together: edges between nodes, one per carried item, ceilings from floors", async () => {
            const config = await loadConfigFromFile(file) as Config;
            const facts = toPlannerFacts(config);
            const traits = buildTraits(config);
            const nodes = new Map(facts.nodes.map(node => [node.key, node]));
            expect(nodes.size, "node keys are unique").toBe(facts.nodes.length);
            expect(new Set(facts.edges.map(edge => edge.key)).size, "edge keys are unique").toBe(facts.edges.length);
            for (const edge of facts.edges) {
                expect(nodes.has(edge.from), `${edge.key} from ${edge.from}`).toBe(true);
                expect(nodes.has(edge.to), `${edge.key} to ${edge.to}`).toBe(true);
            }
            const inserters = Object.values(traits).filter((t): t is InserterTraits => t.kind === "inserter");
            const inserter_edges = facts.edges.filter(edge => edge.via === "inserter");
            const moved_drops: string[] = [];
            expect(inserter_edges.map(edge => edge.key)).toEqual(inserters.flatMap(t => t.hand.items.map(item => `${t.entity}/${item}`)));
            for (const edge of inserter_edges) {
                const t = traits[edge.entity] as InserterTraits;
                const index = t.hand.items.indexOf(edge.item);
                expect(edge.hand.by_item).toBe(t.hand.by_item[index].hand);
                expect(edge.floor.pickup).toBe(t.timing.by_item[index].floor.pickup);
                if (edge.floor.cycle === null) {
                    expect(edge.ceiling).toBeNull();
                } else {
                    expect(edge.floor.cycle).toBe(edge.floor.pickup! + 2 * edge.rotation_ticks + edge.floor.drop!);
                    expect(edge.ceiling).toEqual(ratioOf(fraction(edge.hand.by_item * 60).divide(edge.floor.cycle)));
                }
                // the floor where the edge drops on the lane the trait rounds its hand to is the trait's
                if (edge.to === (t.timing.by_item[index].sink_lane ?? edge.to)) {
                    expect(edge.floor.drop).toBe(t.timing.by_item[index].floor.drop);
                    expect(edge.ceiling).toEqual(t.throughput.by_item[index].items_per_second_ceiling);
                } else {
                    moved_drops.push(`${edge.key}: ${t.timing.by_item[index].sink_lane} -> ${edge.to}`);
                }
            }
            expect(moved_drops, "drops on another lane than the rounding lane, listed in MOVED_DROPS").toEqual(MOVED_DROPS[key] ?? []);
            // a capacity group per inserter, its edges those of the inserter
            expect(facts.capacity_groups.map(group => group.edges.map(edge => edge.edge)))
                .toEqual(inserters.filter(t => t.hand.items.length > 0).map(t => t.hand.items.map(item => `${t.entity}/${item}`)));
        });
    });

    it("keep no snapshot of a sample that is gone", () => {
        const keys = new Set(Object.keys(ConfigPaths).map(key => `${key}.facts.json`));
        const files = fs.existsSync(SNAPSHOTS) ? fs.readdirSync(SNAPSHOTS).filter(file => file.endsWith(".facts.json")) : [];
        expect(files.filter(file => !keys.has(file))).toEqual([]);
        expect(Object.keys(MOVED_DROPS).filter(key => !(key in ConfigPaths))).toEqual([]);
    });
});
