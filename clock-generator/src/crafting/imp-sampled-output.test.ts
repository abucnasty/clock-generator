import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../config/loader";
import { OpenRange } from "../data-types";
import { quiet } from "./generate-blueprint-test-helpers";
import { judgeLongRun } from "./long-run";
import { longRunWindowCyclesOf, runAsBuiltCheck } from "./trial";
import { assessTargetProduction } from "./target-production";
interface ImpFixture {
    config: unknown;
    window_cycle_ticks: number;
    used_lcm: number;
    used_terminal_swing_count: number;
    output_inserter: string;
    clock_windows: Record<string, { start: number; end: number }[]>;
}
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures/imp-sampled-output.json"), "utf8")) as ImpFixture;
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// RI1's exact archived chain-b plan. This is Behavior characterization, independent of the generator's
// selected_index. The short sample is not an infinite-rate claim or evidence of a missing productivity rule.
describe("the archived imp plan's sampled output shortfall", () => {
    let standard: ReturnType<typeof runAsBuiltCheck>;
    let diagnostic: ReturnType<typeof runAsBuiltCheck>;
    const judged = (run: ReturnType<typeof runAsBuiltCheck>) => judgeLongRun(
        [run.stock!.inserters.find(hand => hand.inserter_id === fixture.output_inserter)!.held],
        run.stock!.ticks, fixture.window_cycle_ticks, null, 16, 16,
    );

    beforeAll(async () => {
        // Parse the ordinary config with its loader; do not synthesize secondary-planning provenance.
        const config = await parseConfig(JSON.stringify(fixture.config));
        const prepared = { ...config, overrides: { ...config.overrides,
            lcm: fixture.used_lcm, terminal_swing_count: fixture.used_terminal_swing_count } };
        const windows = new Map(Object.entries(fixture.clock_windows).map(([id, ranges]) =>
            [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
        standard = runAsBuiltCheck(prepared, windows, fixture.window_cycle_ticks, quiet, 12);
        diagnostic = runAsBuiltCheck(prepared, windows, fixture.window_cycle_ticks, quiet, 12, undefined, 72_000);
    });

    it("preserves the recovered planning arithmetic and exact 96-tick clock", () => {
        expect(sha(fixture.config)).toBe("1d228e72d35b157bfa5cc1a4468ddd0080d30219287b1564855caf2784f38dae");
        expect(sha(fixture.clock_windows)).toBe("ba6f0240839f99ff3f285ba6d4d8edbd7841292cf0b720b7f4bc023637d5f09d");
        expect(fixture.used_lcm).toBe(1);
        expect(fixture.used_terminal_swing_count).toBe(1);
        expect(fixture.window_cycle_ticks).toBe(96);
        expect(standard.result.stability_check.expected_output_items).toBe(16);
        expect(diagnostic.result.stability_check.expected_output_items).toBe(16);
        expect(longRunWindowCyclesOf(96)).toBe(120);
        expect(longRunWindowCyclesOf(96, 72_000)).toBe(750);
    });

    it("preserves the hand-sized deficit in the standard 80-period sample", () => {
        expect(standard.check.long_run_proven).toBe(false);
        expect(judged(standard)).toMatchObject({ first_judged_tick: 3840, total: 1264,
            expected_total: 1280, off_bins: [] });
        expect(judged(standard).judged).toHaveLength(80);
    });

    it("fails the longer diagnostic on the same explicit plan and real target", () => {
        expect(diagnostic.check.long_run_proven).toBe(false);
        expect(diagnostic.check.holds).toBe(false);
        expect(judged(diagnostic)).toMatchObject({ total: 7904, expected_total: 8000,
            keeps_up: false, output_items_per_window_cycle: 15.808 });
        expect(judged(diagnostic).judged).toHaveLength(500);
    });

    it("candidate: rejects measured underproduction in both samples without changing the horizon", () => {
        expect(assessTargetProduction(judged(standard), standard.check.long_run_proven === true)).toEqual({
            valid: false, shortfall: 16, output_items_per_window_cycle: 15.8, evidence: "sample",
        });
        expect(assessTargetProduction(judged(diagnostic), diagnostic.check.long_run_proven === true)).toEqual({
            valid: false, shortfall: 96, output_items_per_window_cycle: 15.808, evidence: "sample",
        });
        // The isolated assessment does not mutate the currently published characterization.
        expect(judged(standard).keeps_up).toBe(true);
    });
});
