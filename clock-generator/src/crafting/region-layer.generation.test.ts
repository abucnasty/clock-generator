import { createRequire } from "module";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateClockAlternatives, planClockAlternatives, type ClockAlternativeContext, type ClockAlternativesResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import type { MakerLogEvent } from "./maker-log";
import { quiet } from "./generate-blueprint-test-helpers";
import type { BuildRegions } from "./graph/build-regions";
import type { RegionOrbit } from "./graph/regions";

/** The first orbit of a detection that is not refused */
const firstOrbitOf = (regions: BuildRegions | undefined): RegionOrbit | undefined =>
    regions?.orbits?.flatMap(it => it.kind === "orbit" ? [it.orbit] : [])[0];

// the generation tests run the engine from dist/ (vitest.config.ts): the finder is watched on the module the engine calls
const regions = createRequire(__filename)(path.join(__dirname, "..", "..", "dist", "crafting", "graph", "regions.js"));

/**
 * The utility science 320 build: two repeated groups of machines about the cryogenic plant. One group's clock, made for that group alone, is used
 * on both and recommended.
 */
describe("the repeated groups of machines of a build", () => {
    let utility: Config;
    let finder: ReturnType<typeof vi.spyOn>;
    let found_at_tasks: number | undefined;
    let context: ClockAlternativeContext | undefined;
    let generated: ClockAlternativesResult;
    let found_in_generation: number;
    const events: MakerLogEvent[] = [];
    // the calls of the finder with the whole build (a cut group has fewer machines)
    const wholeCalls = () => finder.mock.calls.filter(([config]: [Config]) => config.machines.length === utility.machines.length).length;
    beforeAll(async () => {
        utility = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
        finder = vi.spyOn(regions, "regionOrbitsOfConfig");
        planClockAlternatives(utility, { logger: quiet }, given => { found_at_tasks = wholeCalls(); context = given; });
        finder.mockClear();
        generated = generateClockAlternatives(utility, { logger: quiet, maker_log: event => { events.push(event); } });
        found_in_generation = wholeCalls();
        finder.mockRestore();
    });

    it("are found once, before the primary clock is planned, and reach every planner", () => {
        expect(found_at_tasks).toBe(1);
        expect(firstOrbitOf(context?.regions)?.anchor[0]).toBe("machine:4");
        expect(context?.regions?.copies_conversion).toBe("not-repeated");
        expect(found_in_generation).toBe(1);
    });

    it("give one group's clock on every group, recommended", () => {
        const selected = generated.alternatives[generated.selected_index];
        expect([selected.maker, selected.verdict]).toEqual(["region-layer", "stable"]);
        expect(Number(selected.assessment.wake_ups_per_minute!.toFixed(2))).toBeLessThanOrEqual(498.71);
        expect(selected.result.schedule.inserter_combinators.length).toBeLessThanOrEqual(11);
        expect(selected.assessment.disturbance_trial?.recovered_after_window_cycles).toBeLessThanOrEqual(16);
        expect(selected.assessment.disturbance_trial?.on_copies?.recovered_after_window_cycles).toBeLessThanOrEqual(19);
        expect(selected.result.region_layer).toMatchObject({ region: "machine:4/region:1" });
        expect(selected.result.region_layer?.shift).toBeUndefined();
        // each arm of the second group has the windows of its partner in the first, at no shift; the plastic arms too
        const orbit = firstOrbitOf(context?.regions)!;
        const windows = selected.result.clock_windows;
        const pairs = [...Object.entries(orbit.maps[1]).filter(([from]) => from.startsWith("inserter:")), ["inserter:8", "inserter:15"]];
        expect(pairs.length).toBe(10);
        for (const [from, to] of pairs) expect(windows[to], `${from} and ${to}`).toEqual(windows[from]);
    });

    it("give the notice of joined groups on no clock: the groups are found", () => {
        expect(generated.alternatives.flatMap(it => it.insights).filter(it => it.id.startsWith("repeated-groups-joined"))).toEqual([]);
    });

    it("log each stagger proposal of the group's generation, and count its seconds to the region step", () => {
        const proposals = events.filter(it => it.event === "region_stagger");
        expect(proposals.length).toBeGreaterThan(0);
        for (const proposal of proposals) {
            expect(proposal).toMatchObject({ region: "machine:4/region:1", outcome: expect.stringMatching(/^(taken|retained|not_reached)$/) });
            if (proposal.outcome === "retained") expect(proposal.reason).toEqual(expect.any(String));
        }
        expect(proposals.filter(it => it.outcome === "taken").length).toBeGreaterThan(0);
        const seconds = events.find(it => it.event === "seconds") as unknown as { makers: Record<string, number> };
        expect(seconds.makers["region-layer"]).toBeGreaterThan(0);
    });
});
