import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import type { WindowCycleChoice } from "../../data-types/build-plan";
import { loadConfigFromFile } from "../../config/loader";
import { productionScienceSharedPickup } from "../generate-blueprint-test-helpers";
import { planOfConfig, planOfSample } from "./plan-test-helpers";
import { swingCountsListed } from "./window-cycles";

/** A choice as [swings, listed as, window cycle ticks, kept or the rule that prunes it] */
const brief = (choice: WindowCycleChoice) => [choice.swings, choice.listed_as, "window_cycle_ticks" in choice ? choice.window_cycle_ticks : null,
    "kept" in choice ? "kept" : choice.pruned.rule];

describe("the output swing counts listed beside the main clock", () => {
    it("every lower count, and the higher ones up to the planned count plus 3, the farthest only as a multiple of the planned", () => {
        expect(swingCountsListed(4, 4, false, 160)).toEqual({ lower: [3, 2, 1], higher: [5, 6] });
        // backed off to 1 from 2: 2, 3, 4, and 5 is no multiple of 2
        expect(swingCountsListed(1, 2, false, 54)).toEqual({ lower: [], higher: [2, 3, 4] });
        expect(swingCountsListed(3, 3, false, 72)).toEqual({ lower: [2, 1], higher: [4, 5, 6] });
    });

    it("no higher count above a main period of 2,400 ticks, and no other count at all where the config forces one", () => {
        expect(swingCountsListed(4, 4, false, 2401)).toEqual({ lower: [3, 2, 1], higher: [] });
        expect(swingCountsListed(3, 3, true, 72)).toEqual({ lower: [], higher: [] });
    });
});

describe("the main-period choices of a build", () => {
    it("military science: 4 swings of 160 ticks a cycle, every hand whole; the counts around it from today's cycle plan", async () => {
        const { plan } = await planOfSample(ConfigPaths.MILITARY_SCIENCE_120);
        expect(plan.groups[0].window_cycles.map(brief)).toEqual([
            [4, "main", 160, "kept"],
            [5, "higher", 800, "kept"],
            [6, "higher", 480, "kept"],
            [3, "lower", 480, "kept"],
            [2, "lower", 160, "kept"],
            [1, "lower", 160, "kept"],
            [4, "fractional", 160, "kept"],
        ]);
    });

    it("pink science original plans 602 swings a cycle, 14,568,400 ticks a period: P-limit prunes it and every count down to 551, "
        + "and the main clock backs off to 550 swings, 242,000 ticks", async () => {
        const { plan } = await planOfSample(ConfigPaths.ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED);
        const window_cycles = plan.groups[0].window_cycles;
        expect(window_cycles.slice(0, 3).map(brief)).toEqual([
            [602, "planned", 14_568_400, "P-limit"],
            [601, "backed-off", 14_544_200, "P-limit"],
            [600, "backed-off", 2_904_000, "P-limit"],
        ]);
        expect(window_cycles[0]).toMatchObject({ pruned: { rule: "P-limit", terms: { window_cycle_ticks: 14_568_400, limit_ticks: 500_000 } } });
        expect(window_cycles.filter(choice => choice.listed_as === "backed-off")).toHaveLength(51);
        expect(brief(window_cycles.find(choice => choice.listed_as === "main")!)).toEqual([550, "main", 242_000, "kept"]);
        expect(plan.composition!.over_limit_action).toMatchObject({ action: "swing-backoff", rule: "P-limit", terms: { requested_swings: 602 } });
        // no higher count above 2,400 ticks; the lower ones whose window cycle is over the limit are pruned too
        expect(window_cycles.filter(choice => choice.listed_as === "higher")).toEqual([]);
        expect(window_cycles.filter(choice => choice.listed_as === "lower")).toHaveLength(549);
    });

    it("an alternative's count whose cycle the cycle plan refuses is listed with its reason, as its run fails today", async () => {
        const { plan } = await planOfSample(ConfigPaths.FLYING_ROBOT_FRAME_80);
        const fractional = plan.groups[0].window_cycles.find(choice => choice.listed_as === "fractional")!;
        expect(fractional).toMatchObject({ swings: null, fractional: true, pruned: { rule: "cycle-refused" } });
        expect("pruned" in fractional && fractional.pruned.rule === "cycle-refused" && fractional.pruned.terms.reason)
            .toMatch(/^Cannot satisfy fractional swing constraint/);
    });

    it("production science with one pickup for its two input items: whole swings are the main, and the fractional alternative is 3/2 swings a cycle", async () => {
        const { plan } = planOfConfig(productionScienceSharedPickup(await loadConfigFromFile(ConfigPaths.PRODUCTION_SCIENCE_120_TWO_BELTS)));
        const [main, ...others] = plan.groups[0].window_cycles;
        expect(main).toMatchObject({ swings: 1, fractional: false, listed_as: "main" });
        expect(plan.composition!.listed_from).toEqual({ swings: 1, planned: 1, higher_up_to_ticks: 2400 });
        expect(others.map(choice => [choice.listed_as, choice.swings])).toEqual([["higher", 2], ["higher", 3], ["fractional", 1.5]]);
        expect(others[2]).toMatchObject({ swings_exact: { numerator: 3, denominator: 2 }, fractional: true, window_cycle_ticks: 336, kept: true });
    });
});

describe("the composition into the main period", () => {
    it("metallurgic science: 256/3 ticks a cycle and 25 cycles for whole hands, but the config's lcm of 5 sets 1280/3 ticks", async () => {
        const { plan } = await planOfSample(ConfigPaths.METALLURGIC_SCIENCE_45);
        expect(plan.composition).toMatchObject({
            swings: 4,
            main_window_cycle: { exact: { numerator: 1280, denominator: 3 } },
            lcm_terms: { cycle_ticks: { numerator: 256, denominator: 3 }, group_cycles: [{ group: "group:1", cycles: 25 }], computed_lcm: 25,
                override_lcm: 5, effective_lcm: 5 },
            over_limit_action: { action: "none" },
        });
        // the config's lcm sets the group's window cycle too
        expect(plan.groups[0].window_cycles[0]).toMatchObject({ cycles: 5 });
    });
});
