import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { fraction } from "../../data-types/fraction";
import { CraftingCyclePlan } from "../sequence/cycle/crafting-cycle";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { TargetProductionRate } from "../target-production-rate";
import { buildPlanOfConfig } from "./plan-build";
import { planOfSample } from "./plan-test-helpers";
import { resultWindowsDecisionOf } from "./result-windows";

const sampleOf = async (key: keyof typeof ConfigPaths) => await loadConfigFromFile(ConfigPaths[key]) as Config;

describe("the result windows' decision of a target that counts an item destroyed", () => {
    it("the ore voider: 5 hands of 16 ore last 12 ticks, and the hands it gives back come out whole: whole hands, the windows not asked", async () => {
        const { plan } = await planOfSample(ConfigPaths.REAL_OWNER_ORE_VOIDER_EXACT_SPEED);
        expect(plan.result_windows).toMatchObject({ kind: "whole-hands", hands: 5,
            terms: { base_hands: 5, cycle_ticks: 12, whole_hands_fit: true, windows_feasible: null } });
    });

    it("a target that counts an item made has no such decision", async () => {
        expect((await planOfSample(ConfigPaths.LOGISTIC_SCIENCE)).plan.result_windows).toBeNull();
    });

    it("the cycle plan made with the decision is the one made without it", async () => {
        for (const key of ["REAL_OWNER_ORE_VOIDER_EXACT_SPEED"] as const) {
            const config = await sampleOf(key);
            const registry = createEntityRegistryFromConfig(config);
            const target = TargetProductionRate.fromConfig(config.target_output);
            const decision = resultWindowsDecisionOf(target, registry, config, config.overrides ?? {});
            const given = CraftingCyclePlan.create(target, registry, config, fraction(1), config.overrides ?? {}, decision);
            const made = CraftingCyclePlan.create(target, registry, config, fraction(1), config.overrides ?? {});
            expect(given).toEqual(made);
        }
    });
});

describe("the plan a generation reads", () => {
    it("is made once per config object, for a target that counts an item destroyed, and its decision is the plan's", async () => {
        const config = await sampleOf("REAL_OWNER_ORE_VOIDER_EXACT_SPEED");
        const registry = createEntityRegistryFromConfig(config);
        const plan = buildPlanOfConfig(config, registry);
        expect(buildPlanOfConfig(config, registry)).toBe(plan);
        expect(plan!.result_windows).toEqual((await planOfSample(ConfigPaths.REAL_OWNER_ORE_VOIDER_EXACT_SPEED)).plan.result_windows);
        // nothing reads a made target's plan yet
        const made = await sampleOf("LOGISTIC_SCIENCE");
        expect(buildPlanOfConfig(made, createEntityRegistryFromConfig(made))).toBeNull();
    });
});

describe("the duty in the plan", () => {
    it("processing units with a belt export: machine 4 (electronic circuits) at 12750/13111, in the one group with every other machine group", async () => {
        const { plan } = await planOfSample(ConfigPaths.PROCESSING_UNITS_BELT_EXPORT);
        expect(plan.groups).toHaveLength(1);
        expect(plan.groups[0].duty.find(duty => duty.producer === "machine:electronic-circuit")).toEqual({
            producer: "machine:electronic-circuit", members: ["machine:4"],
            crafts_needed: { numerator: 102, denominator: 1 }, crafts_capacity: { numerator: 13111, denominator: 125 },
            duty: { numerator: 12750, denominator: 13111 },
        });
        expect(plan.groups[0].duty).toHaveLength(6);
    });
});
