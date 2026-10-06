import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateClockForConfig } from "../crafting/generate-blueprint";
import { FactorioDataService } from "../data";
import { Machine } from "../entities";
import { compareRecording, formatReport } from "./compare";
import { matchRecordingToConfig } from "./entity-matching";
import { parseRecording } from "./recording";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };

beforeAll(() => {
    FactorioDataService.findRecipeOrThrow("iron-gear-wheel");
});

/**
 * A recording of the single biochamber with a fuel inserter (926% energy consumption), made up from the clock the
 * simulation exports: the fuel inserter drops 16 nutrients at `swing_offset` into a window of its fuel clock (every
 * swing after the first `later_swing_offset` ticks later still), and the machine burns `burn_factor` times the fuel
 * its configuration predicts.
 */
async function recordFuelBiochamber(options: { swing_offset?: number; later_swing_offset?: number; burn_factor?: number; out_of_fuel_from?: number } = {}) {
    const config = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
    const result = generateClockForConfig(config, { logger: quiet });
    const period = result.simulation_duration.ticks;
    const clock_of_fuel_inserter = result.unplanned_inserter_clocks!["inserter:3"];
    const { modulus, window } = clock_of_fuel_inserter;

    const machine = Machine.fromConfig(config.machines[0]);
    const fuel_value_mj = machine.fuel_slot!.fuel.fuel_value_mj;
    const power_mj_per_tick = machine.fuel_consumption!.rate_per_tick * fuel_value_mj * (options.burn_factor ?? 1);

    const sample_count = period * 2;
    const swing_offset = options.swing_offset ?? 2;
    const held_count: number[] = new Array(sample_count).fill(0);
    const slot: number[] = [];
    const burning: number[] = [];
    let items = 10;
    let remaining = 1;
    let swings = 0;
    for (let i = 0; i < sample_count; i++) {
        const at = i % modulus;
        const window_start = window.start + swing_offset + (swings > 0 ? options.later_swing_offset ?? 0 : 0);
        if (at === window_start && items < 5) {
            swings++;
            // the hand holds the fuel for a few ticks, then the slot has it
            for (let h = 0; h < 4; h++) held_count[i + h] = 16;
        }
        if (held_count[i - 1] === 16 && held_count[i] === 0) {
            items += 16;
        }
        remaining -= power_mj_per_tick;
        if (remaining <= 0 && items > 0) {
            items--;
            remaining += fuel_value_mj;
        }
        slot.push(items);
        burning.push(Math.max(0, remaining));
    }

    const status = options.out_of_fuel_from === undefined
        ? [[0, "working"]]
        : [[0, "working"], [options.out_of_fuel_from, "no_fuel"]];
    const zeros = new Array(sample_count).fill(0);
    const inserter = (id: number, source: object, sink: object, counts: number[], item: string) => ({
        id, name: "stack-inserter", source, sink, stack_size: 16,
        samples: { held_count: counts, held_item: [[0, item]], status: [[0, "waiting_for_source_items"]] },
    });
    return {
        config,
        result,
        period,
        recording: parseRecording({
            format: "clock-generator-recording",
            version: 1,
            start_game_tick: 0,
            sample_count,
            clock: { values: Array.from({ length: sample_count }, (_, i) => i % period) },
            config: {
                inserters: [
                    { source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 } },
                    { source: { type: "machine", id: 1 }, sink: { type: "belt", id: 2 } },
                    { source: { type: "belt", id: 3 }, sink: { type: "machine", id: 1 } },
                ],
                belts: [
                    { id: 1, lanes: [{ ingredient: "yumako-mash" }] },
                    { id: 2, lanes: [{ ingredient: "nutrients" }] },
                    { id: 3, lanes: [{ ingredient: "nutrients" }] },
                ],
            },
            inserters: [
                inserter(1, { type: "belt", id: 1 }, { type: "machine", id: 1 }, zeros, "yumako-mash"),
                inserter(2, { type: "machine", id: 1 }, { type: "belt", id: 2 }, zeros, "nutrients"),
                inserter(3, { type: "belt", id: 3 }, { type: "machine", id: 1 }, held_count, "nutrients"),
            ],
            machines: [{
                id: 1, name: "biochamber", recipe: "nutrients-from-yumako-mash",
                samples: {
                    status,
                    crafting_progress: zeros, bonus_progress: zeros, products_finished: zeros,
                    inputs: { "yumako-mash": zeros }, outputs: { nutrients: zeros },
                    fuel: { nutrients: slot }, burning_remaining: burning, currently_burning: [[0, "nutrients"]],
                },
            }],
        }),
    };
}

const compare = async (options?: Parameters<typeof recordFuelBiochamber>[0]) => {
    const { config, result, recording } = await recordFuelBiochamber(options);
    const match = matchRecordingToConfig(recording, config);
    return compareRecording(recording, config, result, match);
};

describe("comparing a recording with an inserter outside the plan", () => {
    it("checks the fuel inserter against its clock window and not against one period of the simulation", async () => {
        const report = await compare();
        const [fuel_inserter] = report.clocked_inserters;

        expect(report.clocked_inserters).toHaveLength(1);
        expect(fuel_inserter).toMatchObject({ config_id: 3, kind: "fuel", items: ["nutrients"], amounts: [16] });
        expect(fuel_inserter.swings).toBeGreaterThan(0);
        expect(fuel_inserter.outside).toEqual([]);
        // it is not one of the inserters compared window by window
        expect(report.inserters.map(inserter => inserter.config_id)).not.toContain(3);
        expect(report.issues.filter(issue => issue.includes("Inserter 3"))).toEqual([]);
    });

    // the fuel clock runs free of the recorded clock, so the first swing says where its windows are
    it("flags a swing that does not start in a window of the fuel clock the others started in", async () => {
        const report = await compare({ later_swing_offset: 50 });
        const [fuel_inserter] = report.clocked_inserters;

        expect(fuel_inserter.outside.length).toBeGreaterThan(0);
        expect(report.issues.some(issue => /Inserter 3: \d+ in-game swing\(s\) started outside its clock window/.test(issue))).toBe(true);
    });
});

describe("comparing the fuel a recording burned", () => {
    it("matches the energy consumption of the config", async () => {
        const report = await compare();
        const [fuel] = report.fuel;

        expect(fuel.config_id).toBe(1);
        expect(fuel.fuel_item).toBe("nutrients");
        expect(fuel.ratio).toBeGreaterThan(0.95);
        expect(fuel.ratio).toBeLessThan(1.05);
        expect(fuel.no_fuel_ticks).toBe(0);
        expect(report.issues.filter(issue => issue.includes("energy consumption") || issue.includes("out of fuel"))).toEqual([]);
    });

    it("flags a machine that burned half what its energy consumption predicts", async () => {
        const report = await compare({ burn_factor: 0.5 });
        expect(report.fuel[0].ratio).toBeCloseTo(0.5, 1);
        expect(report.issues.some(issue => /burned \d+(\.\d)?% of the nutrients its energy consumption predicts/.test(issue))).toBe(true);
    });

    it("flags the ticks the game reported the machine out of fuel", async () => {
        const report = await compare({ out_of_fuel_from: 1500 });
        expect(report.fuel[0].no_fuel_ticks).toBe(420);
        expect(report.issues).toContain("Machine 1: out of fuel for 420 tick(s) in game.");
    });

    it("says so when the recording has no fuel samples", async () => {
        const { config, result, recording } = await recordFuelBiochamber();
        delete recording.machines[0].samples.fuel;
        const report = compareRecording(recording, config, result, matchRecordingToConfig(recording, config));
        expect(report.issues.some(issue => issue.includes("no fuel samples"))).toBe(true);
    });

    it("is part of the report", async () => {
        const lines = formatReport(await compare()).join("\n");
        expect(lines).toContain("Inserters outside the plan (fuel, by-products), checked against their clock windows:");
        expect(lines).toContain("Fuel burned by burner machines, against the configured energy consumption:");
    });
});
