import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { fraction } from "../data-types/fraction";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { TargetProductionRate } from "./target-production-rate";

describe("a destroyed target whose takers' hands come out whole in a period its container holds", () => {
    it("keeps the plan that simulates its period at a rate whose feed hands last no whole ticks (the overbeaconed ore voider at 639.22)", async () => {
        const voider = await loadConfigFromFile(ConfigPaths.IRON_ORE_VOIDER_400_OVERBEACONED);
        const odd: Config = { ...voider, target_output: { ...voider.target_output, items_per_second: 639.22 } };
        const plan = CraftingCyclePlan.create(TargetProductionRate.fromConfig(odd.target_output), createEntityRegistryFromConfig(odd), odd, fraction(1), {});
        expect(plan.result_windows).toBeUndefined();
    });

    it("keeps the plan that simulates its period (the ore voider)", async () => {
        const voider = await loadConfigFromFile(ConfigPaths.IRON_ORE_VOIDER_400_EXACT_SPEED);
        const registry = createEntityRegistryFromConfig(voider);
        const plan = CraftingCyclePlan.create(TargetProductionRate.fromConfig(voider.target_output), registry, voider, fraction(1), voider.overrides ?? {});
        expect(plan.result_windows).toBeUndefined();
        expect(plan.total_duration_ticks.toDecimal()).toBe(12);
    });
});
