import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { fraction } from "../data-types/fraction";
import { Entity, Machine } from "../entities";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { TargetProductionRate } from "./target-production-rate";
import { binomialQuantile } from "./random-margins";
import { LATE_AFTER_PERIODS } from "./backpressure-loss";
import { MAX_SIMULATION_TICKS } from "./plan/plan-run";
import {
    RESULT_WINDOWS_CHECK_PERIODS, RESULT_WINDOWS_LONGEST_PERIOD_TICKS, RESULT_WINDOWS_RECOVERY_PERIODS, resultGrouping, resultWindowRanges,
    resultWindowsPlan,
} from "./result-windows";

// The scrap silo sample: a recycler on scrap at +300% productivity, 2 scrap a second destroyed (one hand of 16 every
// 480 ticks, 16 crafts a feed cycle), its twelve results into a rocket silo of uncommon recipe that lifts 1,000,000,
// one filter stack inserter (hand 16, 24 ticks a hand) for each result
let config: Config;
beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.RECYCLING_SCRAP_SILO);
});

function machineOf(of: Config) {
    const registry = createEntityRegistryFromConfig(of);
    return { registry, machine: registry.getAll().find(Entity.isMachine) as Machine };
}

/** One inserter for the processing units, low density structure and holmium ore, in place of their three */
function withRareResultsOnOneInserter(of: Config): Config {
    const rare = ["processing-unit", "low-density-structure", "holmium-ore"];
    const inserters = of.inserters.filter(it => !rare.includes(it.filters?.[0] ?? "") || it.filters?.[0] === rare[0])
        .map(it => it.filters?.[0] === rare[0] ? { ...it, filters: rare } : it);
    return { ...of, inserters };
}

describe("windows for results that come by small chances, by arithmetic", () => {
    it("are planned where no period the silo holds makes the takers' hands whole", () => {
        const { registry } = machineOf(config);
        const plan = CraftingCyclePlan.create(TargetProductionRate.fromConfig(config.target_output), registry, fraction(1), config.overrides ?? {});
        expect(plan.result_windows).toHaveLength(1);
        // the cycle is the whole period: 12 hands of scrap, 5760 ticks
        expect(plan.total_duration_ticks.toDecimal()).toBe(5760);
        expect(plan.entity_transfer_map.get(registry.getAll().filter(Entity.isInserter).find(it => it.filtered_items.has("scrap"))!.entity_id)!
            .total_transfer_count.toDecimal()).toBe(12);
    });

    it("take the longest period whose results the silo holds at its worst moment in all but 1 in 740 periods, the openings in turn", () => {
        const { registry, machine } = machineOf(config);
        const plan = resultWindowsPlan({ machine, registry, cycle_ticks: 480, crafts_per_cycle: 16, kind: "staggered" });
        expect([plan.period, plan.cycles, plan.crafts]).toEqual([5760, 12, 192]);
        // just before the gears' opening, when every other result has been there part of the period: under 1,000,000
        expect(plan.container.before_opening_of).toEqual(["iron-gear-wheel"]);
        expect(plan.container.at_level).toBeLessThanOrEqual(1_000_000);
        expect(plan.container.at_level).toBeGreaterThan(975_000);
        // a cycle more and it does not
        const longer = resultWindowsPlan({ machine, registry, cycle_ticks: 480, crafts_per_cycle: 16, kind: "staggered", cycles: 13 });
        expect(longer.container.headroom === null || longer.container.headroom < 0).toBe(true);
        expect(plan.windows.map(it => it.opening)).toEqual(Array.from({ length: 12 }, (_, index) => index * 480));
    });

    it("give each result the hands of its count at that share with a part hand held over, or the backlog's share where that is more", () => {
        const { registry, machine } = machineOf(config);
        const plan = resultWindowsPlan({ machine, registry, cycle_ticks: 480, crafts_per_cycle: 16, kind: "staggered" });
        const gears = plan.windows.find(it => it.items[0] === "iron-gear-wheel")!;
        // 768 rolls at 1/5: 153.6 gears on average, 188 in all but 1 in 740 periods; with up to 15 held, 13 hands of 16
        expect(gears.expected_items).toBeCloseTo(153.6, 6);
        expect(gears.items_at_level).toBe(binomialQuantile(768, 0.2));
        expect(gears.items_at_level).toBe(188);
        expect(gears.counted).toBe("one roll");
        expect([gears.hands, gears.window_ticks]).toEqual([13, 12 * 24 + 1]);
        // copper cable: 38 at that share, but a silo full of cable (4,000) and a stack in the recycler are 4,200 to take
        // within 32 periods: 23.04 + 131.25 and 15 held over, 11 hands
        const cable = plan.windows.find(it => it.items[0] === "copper-cable")!;
        expect([cable.items_at_level, cable.backlog_items, cable.hands]).toEqual([38, 4200, 11]);
        // holmium ore: 17 at that share, a backlog of 500 and 50: 3 hands
        const holmium = plan.windows.find(it => it.items[0] === "holmium-ore")!;
        expect([holmium.items_at_level, holmium.backlog_items, holmium.hands, holmium.window_ticks]).toEqual([17, 550, 3, 49]);
    });

    it("open all together for the longest window where they share one, on the longest period the silo holds a whole period of every result in", () => {
        const { registry, machine } = machineOf(config);
        const plan = resultWindowsPlan({ machine, registry, cycle_ticks: 480, crafts_per_cycle: 16, kind: "shared" });
        expect(plan.period).toBe(4320);
        expect(new Set(plan.windows.map(it => it.opening))).toEqual(new Set([0]));
        expect(new Set(plan.windows.map(it => it.window_ticks)).size).toBe(1);
        expect(plan.container.at_level).toBeLessThanOrEqual(1_000_000);
    });

    it("are the windows each taker runs on in the period", () => {
        const { registry, machine } = machineOf(config);
        const plan = resultWindowsPlan({ machine, registry, cycle_ticks: 480, crafts_per_cycle: 16, kind: "staggered" });
        const ranges = resultWindowRanges(plan);
        expect(ranges.size).toBe(12);
        const gears = plan.windows.find(it => it.items[0] === "iron-gear-wheel")!;
        expect(ranges.get(gears.inserter_ids[0])!.map(it => [it.start_inclusive, it.end_inclusive])).toEqual([[0, 288]]);
    });

    it("count the results of one inserter with several filters as one roll at the sum of their chances, where no two come in one roll", () => {
        const grouped = withRareResultsOnOneInserter(config);
        const { registry, machine } = machineOf(grouped);
        const plan = resultWindowsPlan({ machine, registry, cycle_ticks: 480, crafts_per_cycle: 16, kind: "staggered" });
        expect(plan.windows).toHaveLength(10);
        const rare = plan.windows.find(it => it.items.length > 1)!;
        expect(rare.items).toEqual(["processing-unit", "low-density-structure", "holmium-ore"]);
        expect(rare.counted).toBe("one roll");
        // its window takes what the period and the wait of a part hand of its rarest result give: 64 rolls a feed cycle
        expect(rare.wait_cycles).toBeGreaterThan(40);
        expect(rare.items_at_level).toBe(binomialQuantile((plan.cycles + rare.wait_cycles) * 64, 0.04));
        expect(rare.expected_items).toBeCloseTo(plan.crafts * 4 * 0.04, 6);
        // and the silo holds what piles up meanwhile on a shorter period than with an inserter for each result
        expect(plan.period).toBe(2400);
    });

    it("group the rarest results onto one inserter until together they give a hand a period", () => {
        const { registry, machine } = machineOf(config);
        const grouping = resultGrouping({ machine, registry, cycle_ticks: 480, crafts_per_cycle: 16 });
        // holmium ore and low density structure give 7.68 a period each, processing units 15.36: together 30.72
        expect(grouping.groups).toHaveLength(10);
        expect(grouping.groups[grouping.groups.length - 1]).toEqual(["processing-unit", "low-density-structure", "holmium-ore"]);
        expect(grouping.single_period).toBe(5760);
        // a part hand of holmium ore or low density structure (0.32% of the rolls each) waits up to 50 feed cycles for
        // its 15 more, while the processing units pile up in the silo: the period the silo holds that in is 2400 ticks
        const shared = grouping.plan!.windows.find(it => it.items.length > 1)!;
        expect(shared.wait_cycles).toBeGreaterThan(40);
        expect(grouping.plan!.period).toBeLessThan(5760);
        expect(grouping.plan!.container.at_level).toBeLessThanOrEqual(1_000_000);
    });

    it("measure a container of slots by its slots", () => {
        const car: Config = { ...config, chests: config.chests!.map(it => it.type === "rocket-silo" ? { type: "car", id: it.id } as never : it) };
        const { registry, machine } = machineOf(car);
        const plan = resultWindowsPlan({ machine, registry, cycle_ticks: 480, crafts_per_cycle: 16, kind: "staggered" });
        expect(plan.container.measure).toBe("slots");
        expect(plan.container.capacity).toBe(80);
        expect(plan.container.at_level).toBeLessThanOrEqual(80);
    });

    it("are run in the simulator over periods that fit its limit, and drain a backlog in the periods a loss trial gives", () => {
        expect(RESULT_WINDOWS_LONGEST_PERIOD_TICKS * RESULT_WINDOWS_CHECK_PERIODS).toBeLessThan(MAX_SIMULATION_TICKS);
        expect(RESULT_WINDOWS_RECOVERY_PERIODS).toBe(LATE_AFTER_PERIODS);
    });
});

describe("a destroyed target whose takers' hands come out whole in a period its container holds", () => {
    it("keeps the plan that simulates its period (the ore voider)", async () => {
        const voider = await loadConfigFromFile(ConfigPaths.REAL_OWNER_ORE_VOIDER_EXACT_SPEED);
        const registry = createEntityRegistryFromConfig(voider);
        const plan = CraftingCyclePlan.create(TargetProductionRate.fromConfig(voider.target_output), registry, fraction(1), voider.overrides ?? {});
        expect(plan.result_windows).toBeUndefined();
        expect(plan.total_duration_ticks.toDecimal()).toBe(12);
    });
});
