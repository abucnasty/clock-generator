import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { quiet } from "../generate-blueprint-test-helpers";
import { unclockedRun, type UnclockedRun } from "../plan/unclocked-run";
import { meteredOutputWindows, outputServiceWindow } from "./metered-output-windows";

it("keeps acquisition, outbound entry and margin across the wrap, and keeps the full clock when no idle gap fits", () => {
    expect(outputServiceWindow(new Set([7]), new Set([7]), 8, 16)).toEqual([
        { start: 0, end: 1 }, { start: 6, end: 7 }, { start: 8, end: 9 }, { start: 14, end: 15 },
    ]);
    expect(outputServiceWindow(new Set([0, 2, 4, 6]), new Set([0, 4]), 8, 16)).toBeNull();
});

describe("retaining output controls without a service witness", () => {
    let plan: UnclockedRun;
    beforeAll(async () => {
        const config = await loadConfigFromFile(path.join(__dirname, "..", "fixtures", "utility-science-320-metered-takers.json"));
        plan = unclockedRun({ ...config, overrides: { terminal_swing_count: 6, lcm: 1, derive_clock_windows: false },
            inserters: config.inserters.map(arm => arm.id === 4
                ? { ...arm, overrides: { ...arm.overrides, enable_control: { mode: "ALWAYS" } } } : arm) }, { logger: quiet });
    });

    const check = { holds: true, actual_output_items: 576, start_phases_checked: 1 };
    const takers = new Set(["inserter:5", "inserter:6"]);
    const turns = [0, 108, 216].map(start => ({ start, end: start + 1 }));

    it("retains the working controls for overlapping all-cycle ranges and a caller's always-enabled output", () => {
        const windows = { "inserter:1": [{ start: 131, end: 323 }, { start: 0, end: 147 }], "inserter:5": turns, "inserter:6": turns };
        const { changes, decisions } = meteredOutputWindows(plan, windows, takers, { check });
        expect(changes).toEqual({});
        expect(decisions).toEqual({
            "inserter:1": { kind: "retained", reason: "no_stock_witness" },
            "inserter:4": { kind: "retained", reason: "unsupported_route" },
        });
    });

    it("preserves an existing output command whose union leaves a gap at the wrap", () => {
        const windows = { "inserter:1": [{ start: 1, end: 170 }, { start: 165, end: 323 }], "inserter:5": turns };
        const result = meteredOutputWindows(plan, windows, new Set(["inserter:5"]), { check });
        expect(result).toEqual({ changes: {}, decisions: { "inserter:1": { kind: "already_bounded" } } });
    });
});
