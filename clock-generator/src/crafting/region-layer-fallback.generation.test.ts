import { describe, expect, it } from "vitest";
import { generateClockAlternatives, type ClockAlternativesResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";
import { regionOrbitsOfConfig } from "./graph/regions";
import { shiftedWindows } from "./candidates/staggered-input-windows";
import { clockFromWindows } from "./trial";

const generate = (config: Config) => generateClockAlternatives(config, { logger: quiet });
const selectedOf = (generated: ClockAlternativesResult) => generated.alternatives[generated.selected_index];
const lifted = (generated: ClockAlternativesResult) => generated.alternatives.filter(it => it.maker === "region-layer");

describe("one group's clock on every repeated group of machines", () => {
    it("leaves the build's own clock recommended where no clock of the group holds on the whole build", async () => {
        // the utility science 320 build at the foundry and plant speeds the configuration was first read with
        const config = structuredClone(await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS));
        config.machines.find(it => it.id === 3)!.crafting_speed = 185;
        config.machines.find(it => it.id === 4)!.crafting_speed = 148.7405;
        for (const machine of config.machines) machine.recipe_quality = "uncommon";
        const generated = generate(config);
        const selected = selectedOf(generated);
        expect([selected.id, selected.maker, selected.verdict]).toEqual(["coordinated_sources", "per-branch", "stable"]);
        expect(Number(selected.assessment.wake_ups_per_minute!.toFixed(2))).toBe(498.71);
        expect(selected.result.schedule.inserter_combinators.length).toBe(11);
        expect(lifted(generated).filter(it => it.verdict === "stable")).toEqual([]);
    });

    it("moves the other group by the offset of the build's own clock where the groups take from one machine at once", async () => {
        const config = await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
        const generated = generate(config);
        const selected = selectedOf(generated);
        expect([selected.maker, selected.verdict]).toEqual(["region-layer", "stable"]);
        expect(selected.result.region_layer?.shift).toEqual({ "machine:3/region:2": -56 });
        expect(Number(selected.assessment.wake_ups_per_minute!.toFixed(2))).toBe(128.57);
        expect(selected.result.schedule.inserter_combinators.length).toBe(4);
        expect(selected.assessment.disturbance_trial?.recovered_after_window_cycles).toBe(2);
        // the drops onto the shared belt fit as they do on the build's own clock, and the lanes stay exactly full
        const spacing = selected.insights.find(it => it.id === "drop-spacing")!;
        expect(spacing.table!.rows.map(row => [row[0], ...row.slice(-2)])).toEqual([["1 and 2", "0", "0"], ["7 and 8", "0", "0"]]);
        expect(selected.insights.some(it => it.id === "lanes-exactly-full")).toBe(true);
        // with no shift, the same windows do not hold as built: both groups' plate arms take from the foundry at once
        const period = selected.result.simulation_duration.ticks;
        const unshifted = { ...selected.result.clock_windows };
        // the second group's drills and arms, and the foundry's plate arms into its assemblers
        for (const key of ["drill:3", "drill:4", "inserter:7", "inserter:8", "inserter:5", "inserter:6"]) if (unshifted[key] !== undefined) unshifted[key] = shiftedWindows(unshifted[key], 56, period);
        const on = { ...config, overrides: { ...config.overrides, terminal_swing_count: selected.result.used_terminal_swing_count, lcm: selected.result.used_lcm } };
        expect(clockFromWindows(on, unshifted, period, quiet).stability_check.as_built?.holds).toBe(false);
    });

    it("lists a clock of the group that holds on the whole build and costs more, and recommends the build's own", async () => {
        const generated = generate(await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_240));
        const selected = selectedOf(generated);
        expect(selected.maker).not.toBe("region-layer");
        const dearer = lifted(generated).filter(it => it.verdict === "stable");
        expect(dearer.length).toBeGreaterThan(0);
        for (const clock of dearer) expect(clock.assessment.wake_ups_per_minute!).toBeGreaterThan(selected.assessment.wake_ups_per_minute!);
    });

    it("is not tried on a build whose output belt names its output inserters among all copies", async () => {
        const config = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE_240);
        expect(config.output_belt).toBeDefined();
        expect(regionOrbitsOfConfig(config)?.some(it => it.kind === "orbit")).toBe(true);
        expect(lifted(generate(config))).toEqual([]);
    });
});
