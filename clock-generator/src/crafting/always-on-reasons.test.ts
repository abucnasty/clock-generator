import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { alwaysOnReasons, chestDrillReasons } from "./always-on-reasons";
import type { ChestDrillClock } from "./chest-drill-windows";
import { alwaysOnReasonProblems, quiet } from "./generate-blueprint-test-helpers";
import { generateClockForConfig } from "./generate-blueprint";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";

const drill = (extra: Partial<ChestDrillClock>): ChestDrillClock =>
    ({ drill_id: 1, chest_id: 1, chest_type: "buffer-chest", item: "iron-ore", enabled_ticks: null, window_count: 0, planned: true, ...extra });

describe("chestDrillReasons", () => {
    it("names the drills left always enabled, and the build's own rule apart from the generator's", () => {
        expect(chestDrillReasons([
            drill({ drill_id: 1, always_enabled_because: { kind: "config" } }),
            drill({ drill_id: 2, always_enabled_because: { kind: "no-taker", item: "iron-ore" } }),
            drill({ drill_id: 3, enabled_ticks: 4, window_count: 1 }),
        ])).toEqual({
            "drill:1": { kind: "enable-rule" },
            "drill:2": { kind: "chest-drill", why: { kind: "no-taker", item: "iron-ore" } },
        });
    });
});

describe("alwaysOnReasons", () => {
    it("gives the strategy's reason first, then the drill's, the build's rule, a loop, and that nothing swung it", async () => {
        const registry = createEntityRegistryFromConfig(await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_CULTIVATION));
        const everything = new Set(registry.getAll().map(it => it.entity_id.id));
        const reasons = alwaysOnReasons(registry, id => !["inserter:1", "inserter:7", "inserter:9", "inserter:10"].includes(id), {
            enable_rule: new Set(["inserter:9"]),
            left_open: new Map([["inserter:9", { kind: "busy", period_ticks: 24 }], ["inserter:1", { kind: "busy", period_ticks: 24 }]]),
            chest_drills: [],
            swung: new Set(everything),
        });
        // 1 is on for the strategy's reason, 9 too (the strategy's reason comes before the rule's), 7 is in the loop,
        // and 10, with nothing to name, has no reason
        expect(reasons).toEqual({
            "inserter:1": { kind: "busy", period_ticks: 24 },
            "inserter:7": { kind: "loop" },
            "inserter:9": { kind: "busy", period_ticks: 24 },
        });
    });
});

describe("the reasons a clock exports", () => {
    it("say that the build's enable rule keeps an inserter on", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.LITHIUM_PLATES);
        const result = generateClockForConfig(sample, { logger: quiet });
        expect(result.always_on_reasons).toEqual({ "inserter:3": { kind: "enable-rule" }, "inserter:5": { kind: "enable-rule" } });
        expect(alwaysOnReasonProblems(sample, result, "lithium plates")).toEqual([]);
    });

    it("say that an inserter of a loop of machines is on to keep the loop running", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_CULTIVATION);
        const result = generateClockForConfig(sample, { logger: quiet });
        expect(result.always_on_reasons).toEqual({ "inserter:7": { kind: "loop" }, "inserter:8": { kind: "loop" } });
    });

    it("say that an inserter the run never swung has no window to read", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME);
        const result = generateClockForConfig({ ...sample, overrides: { ...sample.overrides, terminal_swing_count: 2 } }, { logger: quiet });
        expect(result.always_on_reasons).toEqual({ "inserter:2": { kind: "no-swing" } });
        // a clock whose windows come from a run that moved everything leaves nothing on
        expect(generateClockForConfig(sample, { logger: quiet }).always_on_reasons).toBeUndefined();
    });
});

describe("a fuel inserter on a clock of its own", () => {
    it("is in the fuel plan, which the clock's inserter list reads it from, so it is listed with its own clock and never as always on", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
        const result = generateClockForConfig(sample, { logger: quiet });
        const own = Object.entries(result.unplanned_inserter_clocks ?? {}).filter(([, clock]) => clock.own_clock).map(([id]) => id);
        expect(own.length).toBeGreaterThan(0);
        expect(result.fuel_plan?.inserters.map(it => it.inserter_id).sort()).toEqual(own.sort());
        expect(own.filter(id => result.clock_windows[id] !== undefined)).toEqual([]);
        expect(result.always_on_reasons).toBeUndefined();
    });
});
