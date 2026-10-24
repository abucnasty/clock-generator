import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, observedWindowsClock, type BlueprintGenerationResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";

const ALWAYS = { enable_control: { mode: "ALWAYS" as const } };

/** Ids of the inserters the config sets to always enabled */
const alwaysEnabled = (config: Config): string[] => config.inserters
    .map((inserter, index) => ({ id: `inserter:${inserter.id ?? index + 1}`, mode: inserter.overrides?.enable_control?.mode }))
    .filter(it => it.mode === "ALWAYS")
    .map(it => it.id);

/** The inserters each combinator of the blueprint switches on, from its schedule */
const inserterCombinators = (result: BlueprintGenerationResult): number[][] =>
    result.schedule.inserter_combinators.map(combinator => combinator.inserter_ids.slice().sort((a, b) => a - b));

// GOALS.md: an inserter that is set to "always" enabled is to get no combinator in the blueprint
describe("an inserter the config sets to always enabled", () => {

    describe("low density structure: inserters 5, 8 and 11", () => {
        let config: Config;
        let result: BlueprintGenerationResult;

        beforeAll(async () => {
            config = await loadConfigFromFile(ConfigPaths.LOW_DENSITY_STRUCTURE);
            result = generateClockForConfig(config, { logger: quiet, verify_as_built: true });
        });

        it("has no clock windows", () => {
            expect(alwaysEnabled(config)).toEqual(["inserter:5", "inserter:8", "inserter:11"]);
            const clocked = Object.keys(result.clock_windows).map(id => Number(id.replace("inserter:", ""))).sort((a, b) => a - b);
            expect(clocked).toEqual([1, 2, 3, 4, 6, 7, 9, 10, 12, 13, 14, 15]);
        });

        it("has no combinator in the blueprint", () => {
            expect(inserterCombinators(result)).toEqual([[1, 2, 9, 10], [3, 4, 6, 7, 12, 13, 14, 15]]);
        });
    });

    it("has no windows made from what it was seen doing either (observed windows)", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LITHIUM_PLATES);
        const result = observedWindowsClock(config, { logger: quiet, verify_as_built: true }, "always");
        expect(result.derived_clock_windows).toBeDefined();
        expect(alwaysEnabled(config).length).toBeGreaterThan(0);
        for (const id of alwaysEnabled(config)) {
            expect(Object.keys(result.clock_windows)).not.toContain(id);
        }
    });

    it("has no fuel clock when it only fills a fuel slot, and the build is stable with it always enabled", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
        const clocked = generateClockForConfig(sample, { logger: quiet, verify_as_built: true });
        expect(Object.keys(clocked.unplanned_inserter_clocks ?? {})).toEqual(["inserter:3"]);

        const config: Config = { ...sample, inserters: sample.inserters.map((it, index) => index === 2 ? { ...it, overrides: { ...it.overrides, ...ALWAYS } } : it) };
        const result = generateClockForConfig(config, { logger: quiet, verify_as_built: true });
        expect(Object.keys(result.unplanned_inserter_clocks ?? {})).toEqual([]);
        expect(Object.keys(result.clock_windows)).not.toContain("inserter:3");
        expect(result.blueprint.entities.filter(entity => (entity.player_description ?? "").includes("Fuel clock:"))).toHaveLength(0);
        expect(result.stability_check.as_built?.holds).toBe(true);
    });

    it("holds for a mining drill too", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.STONE_BRICKS_DIRECT_INSERT);
        expect(Object.keys(generateClockForConfig(sample, { logger: quiet }).clock_windows)).toContain("drill:1");

        const config: Config = {
            ...sample,
            drills: { ...sample.drills!, configs: sample.drills!.configs.map(drill => drill.id === 1 ? { ...drill, overrides: { ...drill.overrides, ...ALWAYS } } : drill) },
        };
        const result = generateClockForConfig(config, { logger: quiet, verify_as_built: true });
        expect(Object.keys(result.clock_windows).filter(id => id.startsWith("drill:"))).not.toContain("drill:1");
        expect(result.stability_check.as_built?.holds).toBe(true);
    });

    it("holds for a drill into a chest, which otherwise gets windows from the inserters that empty the chest", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.REAL_OWNER_CAR);
        const clocked = generateClockForConfig(sample, { logger: quiet, verify_as_built: true });
        expect(Object.keys(clocked.clock_windows)).toContain("drill:1");

        const config: Config = { ...sample, drills: { ...sample.drills!, configs: sample.drills!.configs.map(drill => ({ ...drill, overrides: ALWAYS })) } };
        const result = generateClockForConfig(config, { logger: quiet, verify_as_built: true });
        expect(Object.keys(result.clock_windows)).not.toContain("drill:1");
        expect(result.blueprint.entities.filter(entity => (entity.player_description ?? "").startsWith("Drill"))).toHaveLength(0);
        expect(result.chest_drills).toEqual([{ drill_id: 1, chest_id: 1, chest_type: "car", item: "iron-ore", planned: false, enabled_ticks: null, window_count: 0,
            always_enabled_because: { kind: "config" } }]);
        expect(result.always_on_reasons).toEqual({ "drill:1": { kind: "enable-rule" } });
        // the inserters' windows are the same either way: the drill's are made after them
        const { "drill:1": _drill, ...inserters } = clocked.clock_windows;
        expect(result.clock_windows).toEqual(inserters);
    });
});
