import { describe, it, expect } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateClockForConfig } from "./generate-clock";
import { planClockAlternatives } from "./generate-blueprint";
import { leanPeriodItems } from "./lean-period";
import type { SerializableTransferPlan } from "./sequence/cycle/swing-counts";
import { quiet } from "./generate-blueprint-test-helpers";

/** A plan whose inserters move the given items in hands per cycle with the given denominators */
function planOf(inserters: Array<Record<string, number>>): SerializableTransferPlan {
    return {
        computed_lcm: 0,
        entities: inserters.map((hands, index) => ({
            entity_id: `inserter:${index + 1}`,
            entity_type: "inserter" as const,
            entity_number: index + 1,
            stack_size: 2,
            item_transfers: Object.entries(hands).map(([item_name, denominator]) => ({ item_name, numerator: 1, denominator })),
        })),
    };
}

describe("the items whose hands set the period of a plan", () => {
    it("names the item whose hands need more cycles than the rest", () => {
        const plan = planOf([{ iron: 1 }, { copper: 2 }, { coal: 8 }]);
        expect(leanPeriodItems(plan)).toEqual([{ item: "coal", lcm: 8, lcm_without: 2 }]);
    });

    it("names every item that sets the period when two do not divide each other", () => {
        const plan = planOf([{ iron: 2 }, { copper: 3 }]);
        expect(leanPeriodItems(plan)).toEqual([
            { item: "copper", lcm: 6, lcm_without: 2 },
            { item: "iron", lcm: 6, lcm_without: 3 },
        ]);
    });

    it("names only the item that sets the period, and nothing when no item does", () => {
        // 4 is a multiple of 2 and 1: dropping the item with 2 changes nothing, dropping 4 leaves 2 so only it is named
        expect(leanPeriodItems(planOf([{ iron: 4 }, { copper: 2 }, { stone: 1 }]))).toEqual([{ item: "iron", lcm: 4, lcm_without: 2 }]);
        // every item with the same denominator, and plans with whole hands only
        expect(leanPeriodItems(planOf([{ iron: 3 }, { copper: 3 }]))).toEqual([]);
        expect(leanPeriodItems(planOf([{ iron: 1 }, { copper: 1 }]))).toEqual([]);
        expect(leanPeriodItems(planOf([]))).toEqual([]);
    });

    it("looks at the item across all its inserters, not at one of them", () => {
        // coal is 8 on one inserter and 2 on another: leaving coal out takes both
        const plan = planOf([{ coal: 8 }, { coal: 2 }, { iron: 1 }]);
        expect(leanPeriodItems(plan)).toEqual([{ item: "coal", lcm: 8, lcm_without: 1 }]);
    });

    it("counts the item of an inserter that moves several", () => {
        const plan = planOf([{ iron: 1, coal: 4 }, { copper: 2 }]);
        expect(leanPeriodItems(plan)).toEqual([{ item: "coal", lcm: 4, lcm_without: 2 }]);
    });

    it("leaves out the items the config already leaves out of the period, and does not offer them again", () => {
        const plan = planOf([{ coal: 8 }, { iron: 3 }, { copper: 1 }]);
        expect(leanPeriodItems(plan, ["coal"])).toEqual([{ item: "iron", lcm: 3, lcm_without: 1 }]);
        expect(leanPeriodItems(plan, ["coal", "iron"])).toEqual([]);
    });

    it("reads a real plan: only the jelly of the Gleba rocket fuel sample sets its period", async () => {
        const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        const result = generateClockForConfig({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger: quiet, verify_as_built: false });
        expect(leanPeriodItems(result.serializable_transfer_plan)).toEqual([{ item: "jelly", lcm: 4, lcm_without: 2 }]);
        // and what the plan says is the period is the lcm the detection found
        expect(result.computed_lcm).toBe(4);
    });

    it("lists a clock for the shorter period of each such item, the search for it waiting for the others", async () => {
        const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        const plan = planClockAlternatives(config, { logger: quiet });
        expect(plan.context.lean_period_items).toEqual([{ item: "jelly", lcm: 4, lcm_without: 2 }]);
        const lean = plan.tasks.filter(task => task.id.includes("lean"));
        expect(lean.map(task => [task.id, task.only_when_needed])).toEqual([["planned-lean-jelly", false], ["derived-lean-jelly", true]]);
        expect(lean.map(task => task.label)).toEqual([
            "Batched swings, shorter period (jelly not in the period)",
            "Observed windows, shorter period (jelly not in the period)",
        ]);
    });

    it("lists none when the config sets the cycles of the period itself", async () => {
        const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        const plan = planClockAlternatives({ ...config, overrides: { ...config.overrides, lcm: 4 } }, { logger: quiet });
        expect(plan.context.lean_period_items).toEqual([]);
        expect(plan.tasks.filter(task => task.id.includes("lean"))).toEqual([]);
    });
});
