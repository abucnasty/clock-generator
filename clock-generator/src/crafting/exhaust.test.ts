import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigSchema, type Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { fraction } from "../data-types/fraction";
import { Entity } from "../entities";
import { RecipeMetadata } from "../entities/machine/recipe/recipe-metadata";
import { OutputCyclePlan } from "./sequence/cycle/output-cycle";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { TargetProductionRate } from "./target-production-rate";
import { SIMULATION_BUDGET_TICKS } from "./plan/clock-window-cycle-limit";
import { EXHAUST_CHECK_WINDOW_CYCLES, EXHAUST_WINDOW_CYCLE_BUDGET_TICKS, sharedHandRefusal } from "./exhaust";
import { exhaustDecisionOf } from "./planner/exhaust";

describe("a destroyed target whose takers' hands come out whole in a period its container holds", () => {
    it("keeps the plan that simulates its period at a rate whose feed hands last no whole ticks (the overbeaconed ore voider at 639.22)", async () => {
        const voider = await loadConfigFromFile(ConfigPaths.IRON_ORE_VOIDER_400_OVERBEACONED);
        const odd: Config = { ...voider, setpoint: { ...voider.setpoint, items_per_second: 639.22 } };
        const plan = OutputCyclePlan.create(TargetProductionRate.fromConfig(odd.setpoint), createEntityRegistryFromConfig(odd), odd, fraction(1), {});
        expect(plan.exhaust).toBeUndefined();
    });

    it("keeps the plan that simulates its period (the ore voider)", async () => {
        const voider = await loadConfigFromFile(ConfigPaths.IRON_ORE_VOIDER_400_EXACT_SPEED);
        const registry = createEntityRegistryFromConfig(voider);
        const plan = OutputCyclePlan.create(TargetProductionRate.fromConfig(voider.setpoint), registry, voider, fraction(1), voider.overrides ?? {});
        expect(plan.exhaust).toBeUndefined();
        expect(plan.total_duration_ticks.toDecimal()).toBe(12);
    });
});

describe("the simulator budgets", () => {
    it("fit the check periods of the longest result windows period in one simulated run", () => {
        // 20 check window cycles x 24,000 ticks = 480,000 < 500,000
        expect(EXHAUST_CHECK_WINDOW_CYCLES * EXHAUST_WINDOW_CYCLE_BUDGET_TICKS).toBe(480_000);
        expect(EXHAUST_CHECK_WINDOW_CYCLES * EXHAUST_WINDOW_CYCLE_BUDGET_TICKS).toBeLessThan(SIMULATION_BUDGET_TICKS);
    });
});

describe("an inserter taking several of a placed machine's results", () => {
    const shared = ["processing-unit", "low-density-structure"];
    const scrapResults = RecipeMetadata.fromRecipeName("scrap-recycling").outputs.map(output => output.name);
    const says = (where: string) => `Inserter 7 takes processing unit and low density structure out of ${where}. `
        + "An inserter that holds part of a hand of one of them takes only more of that one, so the others pile up in "
        + `${where}, and once it is full the one it waits for cannot come in: the build stops for good. Give each result an `
        + "inserter of its own. An inserter whose filters the clock sets by signal would not wait; such a clock is not planned yet.";

    function recycler(type: "rocket-silo" | "cargo-wagon" | "car" | "tank", peer = false, combined = true) {
        const supply = { type: "infinity-chest", id: 11, item_filter: [{ item_name: "scrap", request_count: 100 }] };
        const target = { type, id: 14, ...(type === "rocket-silo" && { recipe_quality: "uncommon" }) };
        const sink = { type: "infinity-chest", id: 15, item_filter: [], remove_unfiltered_items: true };
        const separate = (combined ? scrapResults.filter(item => !shared.includes(item)) : scrapResults)
            .map((item, index) => ({ id: 20 + index, source: { type: "chest", id: 14 }, sink: { type: "chest", id: 15 }, filters: [item] }));
        return ConfigSchema.parse({
            setpoint: { item: "scrap", items_per_second: 2, copies: 1, counts: "destroyed" },
            machines: [{ id: 1, recipe: "scrap-recycling", productivity: 0, crafting_speed: 0.5, prototype: "recycler",
                result_target: { type: "chest", id: 14 } }],
            belts: [],
            chests: [supply, target, sink, ...(peer ? [{ ...target, id: 16 }] : [])],
            inserters: [
                { id: 2, source: { type: "chest", id: 11 }, sink: { type: "machine", id: 1 }, filters: ["scrap"] },
                ...separate,
                ...(combined ? [{ id: 7, source: { type: "chest", id: 14 }, sink: { type: "chest", id: 15 }, filters: shared }] : []),
            ],
        });
    }

    it.each([
        ["rocket-silo", false, "the rocket silo"],
        ["cargo-wagon", false, "the cargo wagon"],
        ["cargo-wagon", true, "the cargo wagon (cargo wagon 14)"],
        ["car", true, "the car (car 14)"],
        ["tank", false, "the tank"],
    ] as const)("names the planner's %s target (alike peer: %s)", (type, peer, where) => {
        const config = recycler(type, peer);
        const registry = createEntityRegistryFromConfig(config);
        expect(() => exhaustDecisionOf(TargetProductionRate.fromConfig(config.setpoint), registry, config, {}))
            .toThrow(new Error(says(where)));
    });

    it("keeps the numbered fallback without a target entity and gives no refusal for separate takers", () => {
        const registry = createEntityRegistryFromConfig(recycler("cargo-wagon"));
        const entities = registry.getAll().filter(entity => entity.entity_id.id !== "chest:14");
        expect(sharedHandRefusal(entities.filter(Entity.isMachine)[0], { getAll: () => entities })).toBe(says("chest 14"));
        const separate = createEntityRegistryFromConfig(recycler("rocket-silo", false, false));
        expect(sharedHandRefusal(separate.getAll().filter(Entity.isMachine)[0], separate)).toBeNull();
    });
});
