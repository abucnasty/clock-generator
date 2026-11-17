import { describe, expect, it, vi } from "vitest";
import { roundedPeriodOf } from "../common/subtick-window-cycle";
import type { Config } from "../config";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { SerializableClockWindows } from "./clock";
import { quiet } from "./generate-blueprint-test-helpers";
import * as trial from "./trial";

// the switch on, for this file only: every clock below is judged on P
vi.mock("./judged-period-switch", () => ({ SUBTICK_CLOCK_JUDGED_ON_ROUNDED_PERIOD: true }));

/** Windows as the record writes them: "start-end,start-end" an inserter */
function windowsOf(record: Record<string, string>): SerializableClockWindows {
    return Object.fromEntries(Object.entries(record).map(([id, ranges]) => [id, ranges.split(",").map(range => {
        const [start, end] = range.split("-").map(Number);
        return { start, end };
    })]));
}

describe("the period P a subtick clock is judged on: one window cycle rounded to the nearest whole tick", () => {
    it.each([
        [1728 / 19, 91], [640 / 3, 213], [3840 / 13, 295], [11_520 / 13, 886], [12_672 / 23, 551], [31_680 / 23, 1377],
    ])("%d ticks: %d", (window_cycle_ticks, ticks) => {
        expect(roundedPeriodOf(window_cycle_ticks)).toEqual({ ticks, window_cycles: ticks / window_cycle_ticks, whole_window_cycles: 1 });
    });

    it("is none for a whole-tick window cycle, its own period", () => {
        expect(roundedPeriodOf(160)).toBeNull();
    });
});

// The selected clocks of three record jobs whose rate on P read 379.78, 26.0045 and 229.98 where their whole counter
// reads 380, 26 and 230: a span of P held one window cycle's output, divided by the window cycles P lasts. Read over the
// one window cycle P stands for, each is at its target, as on the whole ticks of its subtick clock.
describe("a subtick clock judged on P reads its rate over the window cycle P stands for", () => {
    const cases: { name: string; config: () => Promise<Config>; window_cycle_ticks: number; ticks: number; expected: number; windows: Record<string, string> }[] = [
        {
            name: "iron bacteria 380, 6 output swings (1728/19 ticks, P = 91, longer)",
            config: async () => {
                const sample = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_380_CULTIVATION);
                return { ...sample, overrides: { ...sample.overrides, terminal_swing_count: 6 } };
            },
            window_cycle_ticks: 1728 / 19, ticks: 91, expected: 576,
            windows: { "inserter:6": "0-20,30-50,60-80", "inserter:4": "0-20,30-50,60-80", "inserter:3": "0-20,30-50,60-80",
                "inserter:1": "0-20,30-50,60-80", "inserter:9": "0-16,30-46,60-76", "inserter:10": "0-16,30-46,60-76",
                "inserter:7": "15-23,60-68", "inserter:8": "15-23,60-68" },
        },
        {
            name: "steel plate 26 into a wagon chest, 1 output swing (11520/13 ticks, P = 886, shorter)",
            config: async () => {
                const sample = await loadConfigFromFile(ConfigPaths.STEEL_PLATE_26_WAGON_CHEST);
                return { ...sample, overrides: { ...sample.overrides, terminal_swing_count: 1 } };
            },
            window_cycle_ticks: 11_520 / 13, ticks: 886, expected: 384,
            windows: {
                "inserter:2": "2-10,39-47,76-84,113-121,150-158,187-195,224-232,261-269,298-306,335-343,372-380,409-417,446-454,482-490,519-527,556-564,593-601,630-638,667-675,704-712,741-749,778-786,815-823,852-860",
                "inserter:3": "1-10,38-47,75-84,112-121,149-158,186-195,223-232,260-269,297-306,334-343,371-380,408-417,445-454,481-490,518-527,555-564,592-601,629-638,666-675,703-712,740-749,777-786,814-823,851-860",
                "inserter:1": "15-20,41-54,78-91,115-128,152-157,263-276,300-313,337-350,374-379,459-464,484-497,521-534,558-563,632-645,669-682,706-719,743-748,831-836,854-867",
                "inserter:4": "17-25,43-59,80-96,117-133,154-162,265-281,302-318,339-355,376-384,461-469,486-502,523-539,560-568,634-650,671-687,708-724,745-753,833-841,856-872",
                "inserter:5": "76-97,192-213,348-369,482-503,598-619,731-752,866-879",
                "drill:1": "346-347",
            },
        },
        {
            name: "advanced circuit 230, pitch pickups (12672/23 ticks, P = 551, longer)",
            config: async () => {
                const sample = await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_230);
                return { ...sample, overrides: { ...sample.overrides, terminal_swing_count: 2 } };
            },
            window_cycle_ticks: 12_672 / 23, ticks: 551, expected: 704,
            windows: {
                "inserter:2": "29-50,79-100,129-150,179-200,229-250,279-300,329-350,379-400,429-450,479-500,529-542,544.9565217391304-549.9565217391304",
                "inserter:1": "29-50,79-100,129-150,179-200,229-250,279-300,329-350,379-400,429-450,479-500,529-542,544.9565217391304-549.9565217391304",
                "inserter:8": "2-9,27-34,52-59,77-84,102-109,127-134,152-159,177-184,202-209,227-234,252-259,277-284,302-309,327-334,352-359,377-384,402-409,427-434,452-459,477-484,502-509,527-534",
                "inserter:7": "2-9,27-34,52-59,77-84,102-109,127-134,152-159,177-184,202-209,227-234,252-259,277-284,302-309,327-334,352-359,377-384,402-409,427-434,452-459,477-484,502-509,527-534",
                "inserter:5": "29-42,80-93,130-143,180-185,280-293,330-343,380-393,430-443,480-485",
                "inserter:4": "29-42,80-93,130-143,180-185,280-293,330-343,380-393,430-443,480-485",
                "inserter:6": "29-48,80-88,180-199,230-249,280-299,330-349,380-388,480-499,530-549",
                "inserter:3": "29-48,80-88,180-199,230-249,280-299,330-349,380-388,480-499,530-549",
                "inserter:9": "82-123",
            },
        },
    ];

    // Metallurgic science 45, the time-study clock selected on the full period (640/3 ticks, P = 213, shorter): a span of
    // 213 ticks holds 144, 160 or 176 items, whole hands of its one output inserter. Against the 159.75 its ticks last it
    // was 16.25 off at 176, and its long run moved 12,800 over 80 spans where their ticks expect 12,780: over a hand, at
    // both. Against the one window cycle a span stands for (160), and the run's total within a hand at each of its two cut
    // ends, it holds, as on the whole ticks of its subtick clock.
    cases.push({
        name: "metallurgic science 45, time study windows (640/3 ticks, P = 213, shorter)",
        config: async () => {
            const sample = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_45);
            return { ...sample, overrides: { ...sample.overrides, lcm: 5, terminal_swing_count: 2 } };
        },
        window_cycle_ticks: 640 / 3, ticks: 213, expected: 160,
        windows: {
            "inserter:1": "24-31,61-68,94-101,131-138,167-174,200-207",
            "inserter:2": "0-7,16-23,33-40,53-60,69-76,86-93,106-113,123-130,139-146,159-166,176-183,192-199,212-212",
            "inserter:3": "2-24,45-67,88-110,130-152,173-193",
            "inserter:4": "0-8,24-41,61-77,94-114,131-147,167-184,200-212.33333333333334",
            "inserter:5": "0-8,24-41,61-77,94-114,131-147,167-184,200-212.33333333333334",
            "inserter:6": "0-3,63-73,99-109,169-179,205-212.33333333333334",
            "inserter:7": "1-11,27-48,54-98,107-128,134-144,160-181,187-212",
            "inserter:8": "0-7,26-33,53-60,79-86,106-113,133-140,159-166,186-193,212-212",
        },
    });

    it.each(cases)("$name", async ({ config, window_cycle_ticks, ticks, expected, windows }) => {
        const result = trial.clockFromWindows(await config(), windowsOf(windows), window_cycle_ticks, quiet);
        expect(result.stability_check.expected_output_items).toBe(expected);
        expect(result.clock_only_run?.observation_span).toMatchObject({ ticks, window_cycles: 1, output_items: expected });
        expect(result.stability_check.as_built?.holds).toBe(true);
        expect(result.stability_check.as_built?.actual_output_items).toBe(expected);
    }, 120_000);
});
