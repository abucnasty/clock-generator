import { describe, expect, it } from "vitest";
import { isPlainData } from "../../common/plain-data";
import { ConfigPaths } from "../../config/config-paths";
import { isPlainJsonConfiguration } from "../../config/json-configuration";
import { loadConfigFromFile } from "../../config/loader";
import { FactorioDataService } from "../../data/factorio-data-service";
import { OpenRange } from "../../data-types";
import { canonicalKey, currentRunMemo, shortSampledStart, withQuietSampledStarts, withRunMemo } from "./run-memo";
import { sampledStartInputs, type SampledStart } from "./sampled-start-memo";
import type { RunOptions } from "./unclocked-run";
import { beginTickLoop, withSampledRunWork, withTickLedger, type TickLedgerCount } from "../tick-ledger";

const measured = { holds: true, actual_output_items: 96, expected_output_items: 96, used_lcm: 2,
    repeat_window_cycles: 2, repeat_output_items: 192 };

const started = () => ({ owner: {}, save: true, offset: 18, enable_windows: new Map([
    ["inserter:1", [OpenRange.from(2, 5), OpenRange.from(9, 10)]],
    ["inserter:2", [OpenRange.from(6, 8)]],
]) });

describe("sampled main-counter measurements", () => {
    it.each([
        [99_999, 99_999, true],
        [99_999, 100_000, false],
        [100_000, 99_999, false],
        [100_000, 100_000, false],
        [99_999, 100_001, false],
        [100_001, 99_999, false],
        [99_999, undefined, false],
        [99_999, 0, false],
        [99_999, NaN, false],
        [NaN, 99_999, false],
    ])("uses both work measures (%s requested, %s executed)", (requested, executed, eligible) => {
        expect(shortSampledStart(requested, executed)).toBe(eligible);
    });

    it("reads the current contents and order of the configuration and enable windows", async () => {
        const configuration = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const start = started();
        const options: RunOptions = { cold_start: true, fill_start: true };
        const key = (position: SampledStart = start) => {
            const input = sampledStartInputs(position, configuration, options);
            return input === null ? null : canonicalKey(input);
        };
        const initial = key();
        expect(initial).not.toBeNull();
        expect(key({ ...start, offset: 19 })).not.toBe(initial);
        delete options.fill_start;
        expect(key()).not.toBe(initial);
        options.fill_start = true;
        expect(key()).toBe(initial);
        const first = configuration.inserters[0];
        expect(Object.getOwnPropertyDescriptor(first, "id")).toBeUndefined();
        first.id = 999;
        expect(key()).not.toBe(initial);
        first.id = undefined;
        expect(key()).not.toBe(initial);
        delete first.id;
        expect(key()).toBe(initial);
        const ranges = start.enable_windows.get("inserter:1")!;
        ranges.reverse();
        expect(key()).not.toBe(initial);
        ranges.reverse();
        expect(key()).toBe(initial);
        Object.defineProperty(ranges[0], "end_inclusive", { value: 6 });
        expect(key()).not.toBe(initial);
        Object.defineProperty(ranges[0], "end_inclusive", { value: 5 });
        start.enable_windows.delete("inserter:1");
        start.enable_windows.set("inserter:1", ranges);
        expect(key()).not.toBe(initial);
    });

    it("passes through unsupported data without an extra getter or proxy trap", async () => {
        const configuration = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const start = started();
        let calls = 0;
        const getter = { ...configuration, get setpoint() { calls++; return configuration.setpoint; } };
        const proxy = { ...configuration, setpoint: new Proxy(configuration.setpoint, {
            ownKeys(target) { calls++; return Reflect.ownKeys(target); },
        }) };
        expect(sampledStartInputs(start, getter, {})).toBeNull();
        expect(sampledStartInputs(start, proxy, {})).toBeNull();
        expect(calls).toBe(0);
    });

    it("accepts only the loaded configuration and declines a nested accessor without reading it", async () => {
        const configuration = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        expect(isPlainJsonConfiguration(configuration)).toBe(true);
        expect(isPlainJsonConfiguration({ ...configuration })).toBe(false);
        let calls = 0;
        const original = Object.getOwnPropertyDescriptor(configuration.setpoint, "items_per_second")!;
        Object.defineProperty(configuration.setpoint, "items_per_second", { enumerable: true, get() { calls++; return original.value; } });
        expect(isPlainJsonConfiguration(configuration)).toBe(false);
        expect(calls).toBe(0);
    });

    it("declines a getter on the bundled game data without invoking it", () => {
        const recipe = FactorioDataService.findRecipe("automation-science-pack")!;
        const original = Object.getOwnPropertyDescriptor(recipe, "energy_required")!;
        expect(FactorioDataService.hasPlainBundledData()).toBe(true);
        let calls = 0;
        Object.defineProperty(recipe, "energy_required", { enumerable: true, get() { calls++; return original.value; } });
        try {
            expect(FactorioDataService.hasPlainBundledData()).toBe(false);
            expect(calls).toBe(0);
        } finally {
            Object.defineProperty(recipe, "energy_required", original);
        }
    });

    it("declines repeated references in a changed bundled data graph", () => {
        const recipe = FactorioDataService.findRecipe("automation-science-pack")!;
        const shared = { value: 1 };
        Object.defineProperty(recipe, "unused_data", { configurable: true, enumerable: true, value: { left: shared, right: shared } });
        try {
            expect(FactorioDataService.hasPlainBundledData()).toBe(false);
        } finally {
            Reflect.deleteProperty(recipe, "unused_data");
        }
    });

    it("bounds the data inspected before building a key", () => {
        const circular: { next?: object } = {};
        circular.next = circular;
        const deep = Array.from({ length: 65 }).reduce<object>(next => ({ next }), {});
        expect(isPlainData(circular)).toBe(false);
        expect(isPlainData(deep)).toBe(false);
        expect(isPlainData({ item: "automation-science-pack" }, 8)).toBe(false);
        expect(isPlainData({ item: "automation-science-pack" }, 32)).toBe(true);
    });

    it("keeps the run that would warn about an out-of-range enable window", async () => {
        const configuration = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        configuration.inserters[0].overrides = { enable_control: { mode: "CLOCKED", window_cycle_ticks: 216, ranges: [{ start: 1, end: 217 }] } };
        expect(sampledStartInputs(started(), configuration, {})).toBeNull();
    });

    it("keeps compact answers isolated from callers and later generations", () => {
        const owner = {};
        const answer = { ...measured };
        const step = () => {
            const memo = currentRunMemo()!.sampled_starts!;
            memo.save(owner, "a", answer);
            answer.actual_output_items = 13;
            const first = memo.get(owner, "a")!;
            expect(first).toEqual(measured);
            first.actual_output_items = 17;
            expect(memo.get(owner, "a")).toEqual(measured);
            expect(memo.get({}, "a")).toBeUndefined();
            expect(memo.get(owner, "b")).toBeUndefined();
            memo.save(owner, "diagnostic", { ...measured, export_shortfalls: [] });
            expect(memo.get(owner, "diagnostic")).toBeUndefined();
            expect(currentRunMemo()!.hits).toBe(0);
            throw new Error("test interrupted generation");
        };
        expect(() => withQuietSampledStarts(step)).toThrow("test interrupted generation");
        expect(currentRunMemo()).toBeUndefined();
        expect(withRunMemo(() => currentRunMemo()!.sampled_starts)).toBeUndefined();
        expect(withQuietSampledStarts(() => currentRunMemo()!.sampled_starts!.get(owner, "a"))).toBeUndefined();
    });

    it("counts both preparations and both judged loops with or without a ledger", () => {
        const readTicks = () => withSampledRunWork(() => {
            beginTickLoop("prepare_step", () => 170)?.close();
            beginTickLoop("prepare_step", () => 2)?.close();
            beginTickLoop("warmup_step", () => 1728)?.close();
            beginTickLoop("simulate_step", () => 216)?.close();
            beginTickLoop("simulate_step", () => 216)?.close();
            return "measurement";
        });
        const expected = { result: "measurement", ticks: 2332 };
        expect(readTicks()).toEqual(expected);
        let ledger: TickLedgerCount | undefined;
        expect(withTickLedger(count => { ledger = count; }, readTicks)).toEqual(expected);
        expect(ledger?.rows.map(row => [row.loop, row.ticks])).toEqual([
            ["prepare_step", 172], ["warmup_step", 1728], ["simulate_step", 432],
        ]);
        expect(withSampledRunWork(() => {
            beginTickLoop("prepare_step", () => 170)?.close();
            beginTickLoop("warmup_step", () => 1728)?.close();
            beginTickLoop("simulate_step", () => 216);
        }).ticks).toBeUndefined();
        expect(() => withSampledRunWork(() => { throw new Error("simulator threw"); })).toThrow("simulator threw");
        expect(readTicks()).toEqual(expected);
    });
});
