import * as E from "fp-ts/Either";
import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { TestConfigPaths } from "../../tests/configs/paths";
import { loadConfigFromFile } from "../config/loader";
import type { ReadableEntityRegistry } from "../entities";
import type { ChestDrillClock } from "./chest-drill-windows";
import type { ClockStrategy } from "./clock-strategy";
import { alwaysOnReasonsOf, chestDrillReasons, classifyEntities, EntityRouteError, entityRoutesOf, routesOfResult } from "./enable-control-router";
import { entityRouteProblems, quiet } from "./generate-blueprint-test-helpers";
import { generateClockForConfig } from "./generate-blueprint";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { alwaysEnabledInserters, loopInserters } from "./sequence/unplanned-inserter-clock";

const drill = (extra: Partial<ChestDrillClock>): ChestDrillClock =>
    ({ drill_id: 1, chest_id: 1, chest_type: "buffer-chest", item: "iron-ore", enabled_ticks: null, window_count: 0, planned: true, ...extra });

describe("chestDrillReasons", () => {
    it("names the drills left always enabled, and the build's own rule apart from the generator's", () => {
        expect(chestDrillReasons([
            drill({ drill_id: 1, always_enabled_because: { kind: "config" } }),
            drill({ drill_id: 2, always_enabled_because: { kind: "no-taker", item: "iron-ore" } }),
            drill({ drill_id: 3, enabled_ticks: 4, window_count: 1 }),
        ])).toEqual({
            "drill:1": { kind: "override" },
            "drill:2": { kind: "chest-drill", why: { kind: "no-taker", item: "iron-ore" } },
        });
    });
});

/**
 * Phase 1, a row of the router's table at a time: the four inserters and the drill of a furnace build fed from a car its drill fills
 * (inserters 1-4, drill 1), with the facts of each row set inline and every other entity on windows from the clock
 */
describe("phase 1: the route of each inserter and drill", () => {
    let registry: ReadableEntityRegistry;
    beforeAll(async () => {
        registry = createEntityRegistryFromConfig(await loadConfigFromFile(ConfigPaths.IRON_PLATE_80_CAR_CHEST));
    });
    const everything = ["inserter:1", "inserter:2", "inserter:3", "inserter:4", "drill:1"];
    type Facts = Parameters<typeof classifyEntities>[1];
    /** Every entity has windows and swung; `without` have no windows */
    const classify = (without: string[], facts: Partial<Facts> = {}) => classifyEntities(registry, {
        has_windows: id => !without.includes(id), inserter_clock: () => undefined, chest_drills: [], clocked_by_config: new Set(),
        override: new Set(), left_open: new Map(), swung: new Set(everything), ...facts,
    });

    it("lists every inserter and drill of the build once", () => {
        expect(Array.from(classify([]).keys())).toEqual(everything);
    });

    it("left open by the maker: Left busy", () => {
        const routes = classify(["inserter:3"], { left_open: new Map([["inserter:3", { kind: "busy", window_cycle_ticks: 24 }]]) });
        expect(routes.get("inserter:3")).toEqual(E.left({ kind: "busy", window_cycle_ticks: 24 }));
    });

    it("a drill into a chest that nothing can time: Left chest-drill, with its why", () => {
        const routes = classify(["drill:1"], { chest_drills: [drill({ always_enabled_because: { kind: "no-taker", item: "iron-ore" } })] });
        expect(routes.get("drill:1")).toEqual(E.left({ kind: "chest-drill", why: { kind: "no-taker", item: "iron-ore" } }));
    });

    it("a drill into a chest with just-in-time windows: Right chest_drill, an empty list of windows too", () => {
        expect(classify([], { chest_drills: [drill({ enabled_ticks: 4, window_count: 1 })] }).get("drill:1")).toEqual(E.right({ kind: "chest_drill" }));
        expect(classify([], { chest_drills: [drill({ always_enabled_because: { kind: "windows-did-not-hold" } })] }).get("drill:1"))
            .toEqual(E.right({ kind: "chest_drill" }));
    });

    it("the build's Always on: Left override, for a drill into a chest as for an inserter", () => {
        const routes = classify(["inserter:1", "drill:1"], { override: new Set(["inserter:1", "drill:1"]),
            chest_drills: [drill({ planned: false, always_enabled_because: { kind: "config" } })] });
        expect(routes.get("inserter:1")).toEqual(E.left({ kind: "override" }));
        expect(routes.get("drill:1")).toEqual(E.left({ kind: "override" }));
    });

    it("the build's Clocked: Right override_clocked, for a drill into a chest as for an inserter", () => {
        const routes = classify([], { clocked_by_config: new Set(["inserter:2", "drill:1"]), chest_drills: [drill({ planned: false, enabled_ticks: 10, window_count: 1 })] });
        expect(routes.get("inserter:2")).toEqual(E.right({ kind: "override_clocked" }));
        expect(routes.get("drill:1")).toEqual(E.right({ kind: "override_clocked" }));
    });

    it("a fuel inserter on a clock of its own, with no windows on the window cycle: Right own_fuel_clock", () => {
        const routes = classify(["inserter:1"], { inserter_clock: id => id === "inserter:1" ? { kind: "fuel", own_clock: true } : undefined });
        expect(routes.get("inserter:1")).toEqual(E.right({ kind: "own_fuel_clock" }));
    });

    it("a by-product inserter on its modulus windows: Right by_product", () => {
        const routes = classify([], { inserter_clock: id => id === "inserter:4" ? { kind: "by-product", own_clock: false } : undefined });
        expect(routes.get("inserter:4")).toEqual(E.right({ kind: "by_product" }));
    });

    it("in a loop, or from a loop: Left loop, Left from-loop", async () => {
        // the pentapod egg biochambers feed each other; the science biochamber takes their eggs
        const agricultural = createEntityRegistryFromConfig(await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250));
        const loop = loopInserters(agricultural).map(it => it.entity_id.id);
        const from_loop = alwaysEnabledInserters(agricultural).map(it => it.entity_id.id).filter(id => !loop.includes(id));
        expect(loop.length).toBeGreaterThan(0);
        expect(from_loop.length).toBeGreaterThan(0);
        const ids = agricultural.getAll().map(it => it.entity_id.id);
        const routes = classifyEntities(agricultural, { has_windows: id => ![...loop, ...from_loop].includes(id), inserter_clock: () => undefined,
            chest_drills: [], clocked_by_config: new Set(), override: new Set(), left_open: new Map(), swung: new Set(ids) });
        expect(loop.map(id => routes.get(id))).toEqual(loop.map(() => E.left({ kind: "loop" })));
        expect(from_loop.map(id => routes.get(id))).toEqual(from_loop.map(() => E.left({ kind: "from-loop" })));
        // a loop inserter with windows from the clock is windowed, as every entity with windows is
        expect(classifyEntities(agricultural, { has_windows: () => true, inserter_clock: () => undefined, chest_drills: [], clocked_by_config: new Set(),
            override: new Set(), left_open: new Map(), swung: new Set(ids) }).get(loop[0])).toEqual(E.right({ kind: "windowed" }));
    });

    it("windows from the clock: a Right that phase 2 names", () => {
        expect(classify([]).get("inserter:3")).toEqual(E.right({ kind: "windowed" }));
    });

    it("no swing recorded: Left no-swing", () => {
        expect(classify(["inserter:2"], { swung: new Set(everything.filter(id => id !== "inserter:2")) }).get("inserter:2")).toEqual(E.left({ kind: "no-swing" }));
    });

    it("swung, no window, no rule: an internal error naming the entity", () => {
        expect(() => classify(["inserter:4"])).toThrow(EntityRouteError);
        expect(() => classify(["inserter:4"])).toThrow(/^Internal error: inserter:4 swung/);
    });

    it("takes the first reason known: the maker's before the build's Always on, which comes before a loop and no swing", () => {
        const routes = classify(["inserter:1", "inserter:2"], {
            left_open: new Map([["inserter:1", { kind: "busy", window_cycle_ticks: 24 }]]),
            override: new Set(["inserter:1", "inserter:2"]),
            swung: new Set(),
        });
        expect(routes.get("inserter:1")).toEqual(E.left({ kind: "busy", window_cycle_ticks: 24 }));
        expect(routes.get("inserter:2")).toEqual(E.left({ kind: "override" }));
        expect(alwaysOnReasonsOf(routes)).toEqual({ "inserter:1": { kind: "busy", window_cycle_ticks: 24 }, "inserter:2": { kind: "override" } });
    });
});

describe("phase 2: the routes of an alternative's clock, read back from its result", () => {
    let registry: ReadableEntityRegistry;
    beforeAll(async () => {
        registry = createEntityRegistryFromConfig(await loadConfigFromFile(ConfigPaths.IRON_PLATE_80_CAR_CHEST));
    });
    const window = [{ start: 0, end: 4 }];
    const result = {
        clock_windows: { "inserter:1": window, "inserter:2": window, "drill:1": window },
        unplanned_inserter_clocks: { "inserter:4": { kind: "fuel" as const, modulus: 600, own_clock: true, window: { start: 0, end: 4 } } },
        always_on_reasons: { "inserter:3": { kind: "busy" as const, window_cycle_ticks: 24 } },
    };
    const strategy = (routing: ClockStrategy["routing"]): ClockStrategy => routing.router === "direct"
        ? { id: "takt_batches", tuning_method: "calculated", settings: { output_count: { kind: "output_swings", count: 1 }, window_cycle: [], belt_pickups: [] }, output_swings: 1, routing }
        : { id: null, tuning_method: null, settings: { output_count: { kind: "output_swings", count: 1 }, window_cycle: [], belt_pickups: [] }, output_swings: 1, routing };

    it("gives a Direct clock's windowed entities its strategy, and the others their phase 1 route", () => {
        const routes = entityRoutesOf(registry, result, new Set(), strategy({ router: "direct" }));
        expect(Object.fromEntries(routes)).toEqual({
            "inserter:1": E.right({ kind: "catalog", id: "takt_batches", tuning_method: "calculated" }),
            "inserter:2": E.right({ kind: "catalog", id: "takt_batches", tuning_method: "calculated" }),
            "inserter:3": E.left({ kind: "busy", window_cycle_ticks: 24 }),
            "inserter:4": E.right({ kind: "own_fuel_clock" }),
            "drill:1": E.right({ kind: "catalog", id: "takt_batches", tuning_method: "calculated" }),
        });
    });

    it("gives a Coordinated Sources group inserter its part's strategy, and a drill the recommended clock's", () => {
        const routing: ClockStrategy["routing"] = { router: "coordinated_sources", sources: [
            { source: "chest:1", entities: { "inserter:1": { kind: "strategy", id: "round_robin_polling", tuning_method: "calculated" },
                "inserter:2": { kind: "strategy", id: "takt_batches", tuning_method: "observed" } } },
            { source: "machine:1", entities: { "inserter:3": { kind: "always_on", reason: { kind: "busy", window_cycle_ticks: 24 } } } },
        ] };
        const routes = entityRoutesOf(registry, result, new Set(), strategy(routing), { id: "euclidean_swings", tuning_method: "calculated" });
        expect(routes.get("inserter:1")).toEqual(E.right({ kind: "catalog", id: "round_robin_polling", tuning_method: "calculated" }));
        expect(routes.get("inserter:2")).toEqual(E.right({ kind: "catalog", id: "takt_batches", tuning_method: "observed" }));
        expect(routes.get("drill:1")).toEqual(E.right({ kind: "catalog", id: "euclidean_swings", tuning_method: "calculated" }));
        expect(routes.get("inserter:4")).toEqual(E.right({ kind: "own_fuel_clock" }));
    });

    it("throws where a Coordinated Sources group inserter with windows has no part strategy, naming it", () => {
        const routing: ClockStrategy["routing"] = { router: "coordinated_sources", sources: [
            { source: "chest:1", entities: { "inserter:1": { kind: "strategy", id: "round_robin_polling", tuning_method: "calculated" } } },
        ] };
        expect(() => entityRoutesOf(registry, result, new Set(), strategy(routing), { id: "euclidean_swings", tuning_method: "calculated" }))
            .toThrow(new EntityRouteError("Internal error: inserter:2 has enable windows and no source of the Coordinated Sources clock gives it a strategy"));
    });

    it("throws where an entity is always on with no reason, or has a reason and windows", () => {
        const { always_on_reasons: _, ...reasonless } = result;
        expect(() => entityRoutesOf(registry, reasonless, new Set(), strategy({ router: "direct" })))
            .toThrow(new EntityRouteError("Internal error: inserter:3 is always on with no reason"));
        expect(routesOfResult(registry, { ...result, always_on_reasons: { ...result.always_on_reasons, "inserter:1": { kind: "loop" }, "drill:9": { kind: "loop" } } }, new Set()).problems)
            .toEqual(["inserter:1 has a reason and is not always on", "drill:9 has a reason and is not an inserter or drill of the build"]);
    });
});

describe("the reasons a clock exports", () => {
    it("say that the build's enable rule keeps an inserter on", async () => {
        // a cryogenic plant fills a rocket silo that six furnaces empty: its input from an infinity chest (inserter 1) and its output into the silo (4) are set to always enabled
        const loaded = await loadConfigFromFile(ConfigPaths.LITHIUM_PLATE_80_SILO_CHEST);
        const sample = { ...loaded, inserters: loaded.inserters.map((it, index) => [0, 3].includes(index)
            ? { ...it, overrides: { ...it.overrides, enable_control: { mode: "ALWAYS" as const } } } : it) };
        const result = generateClockForConfig(sample, { logger: quiet });
        expect(result.always_on_reasons).toEqual({ "inserter:1": { kind: "override" }, "inserter:4": { kind: "override" } });
        expect(entityRouteProblems(sample, result, "lithium silo")).toEqual([]);
    });

    it("say that an inserter of a loop of machines is on to keep the loop running", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_380_CULTIVATION);
        const result = generateClockForConfig(sample, { logger: quiet });
        expect(result.always_on_reasons).toEqual({ "inserter:7": { kind: "loop" }, "inserter:8": { kind: "loop" } });
    });

    it("say that an inserter the run never swung has no window to read", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME_160);
        const result = generateClockForConfig({ ...sample, overrides: { ...sample.overrides, terminal_swing_count: 2 } }, { logger: quiet });
        expect(result.always_on_reasons).toEqual({ "inserter:2": { kind: "no-swing" } });
        // a clock whose windows come from a run that moved everything leaves nothing on
        expect(generateClockForConfig(sample, { logger: quiet }).always_on_reasons).toBeUndefined();
    });
});

describe("a fuel inserter on a clock of its own", () => {
    it("is in the fuel plan, which the clock's inserter list reads it from, so it is listed with its own clock and never as always on", async () => {
        const sample = await loadConfigFromFile(TestConfigPaths.BIOCHAMBER_FUEL);
        const result = generateClockForConfig(sample, { logger: quiet });
        const own = Object.entries(result.unplanned_inserter_clocks ?? {}).filter(([, clock]) => clock.own_clock).map(([id]) => id);
        expect(own.length).toBeGreaterThan(0);
        expect(result.fuel_plan?.inserters.map(it => it.inserter_id).sort()).toEqual(own.sort());
        expect(own.filter(id => result.clock_windows[id] !== undefined)).toEqual([]);
        expect(result.always_on_reasons).toBeUndefined();
        const registry = createEntityRegistryFromConfig(sample);
        const routes = routesOfResult(registry, result, new Set()).routes;
        expect(own.map(id => routes.get(id))).toEqual(own.map(() => E.right({ kind: "own_fuel_clock" })));
    });
});
