import { beforeAll, describe, expect, it } from "vitest";
import { Config } from "../../config";
import { ConfigPaths, ExpectedRefusals } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { DebugSettingsProvider } from "../sequence/debug/debug-settings-provider";
import { generateClockAlternatives } from "../alternatives";
import { generateClockForConfig } from "../generate-clock";
import { backpressureLossKey, backpressureLossVerdictOf } from "../trial";
import { BlueprintGenerationResult, planRun, runBuild } from "./plan-run";
import { RUN_MEMO_MIN_TICKS, RunMemo, canonicalKey, currentRunMemo, withRunMemo } from "./run-memo";

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

describe("canonicalKey", () => {
    it("is the same for the same content", () => {
        expect(canonicalKey({ a: [1, "x", { b: null }], c: true })).toBe(canonicalKey({ a: [1, "x", { b: null }], c: true }));
    });

    it("tells values apart that JSON.stringify writes alike", () => {
        const keys = [
            canonicalKey({ a: undefined }), canonicalKey({}), canonicalKey({ a: null }),
            canonicalKey(0), canonicalKey(-0), canonicalKey("0"),
            canonicalKey(new Map([["a", 1]])), canonicalKey(new Map()), canonicalKey(new Set([1])), canonicalKey([1]),
            canonicalKey([undefined]), canonicalKey([null]),
        ];
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("keeps the order of members, of array items and of Map entries as part of the key", () => {
        expect(canonicalKey({ a: 1, b: 2 })).not.toBe(canonicalKey({ b: 2, a: 1 }));
        expect(canonicalKey([1, 2])).not.toBe(canonicalKey([2, 1]));
        expect(canonicalKey(new Map([["a", 1], ["b", 2]]))).not.toBe(canonicalKey(new Map([["b", 2], ["a", 1]])));
    });

    it("has no key for what it cannot tell apart", () => {
        class Fraction { constructor(readonly numerator: number) { } }
        expect(canonicalKey({ f: new Fraction(1) })).toBeNull();
        expect(canonicalKey({ f: () => 1 })).toBeNull();
        expect(canonicalKey([Number.NaN])).toBeNull();
        expect(canonicalKey({ n: Infinity })).toBeNull();
        expect(canonicalKey({ n: BigInt(1) })).toBeNull();
        expect(canonicalKey({ s: Symbol("x") })).toBeNull();
        expect(canonicalKey(new Map([["a", new Fraction(1)]]))).toBeNull();
        expect(canonicalKey(Object.create(null))).not.toBeNull();
        const loop: Record<string, unknown> = {};
        loop.itself = loop;
        expect(canonicalKey(loop)).toBeNull();
    });

    it("has a key for the config of every sample", async () => {
        const without: string[] = [];
        for (const [name, path] of Object.entries(ConfigPaths)) {
            if (name in ExpectedRefusals) continue;
            if (canonicalKey(await loadConfigFromFile(path)) === null) without.push(name);
        }
        expect(without).toEqual([]);
    });
});

describe("the memo of the runs of a generation", () => {
    let config: Config;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
    });
    const options = { logger: quiet, factorio_states: false };

    it("keeps nothing outside a generation, and a run made twice is made twice", () => {
        expect(currentRunMemo()).toBeUndefined();
        const first = runBuild(config, options);
        const second = runBuild(config, options);
        expect(second.final_history).not.toBe(first.final_history);
        expect(second.stability_check).toEqual(first.stability_check);
    });

    it("hands a run made before again, with a stability check of its own", () => {
        withRunMemo(() => {
            const memo = currentRunMemo()!;
            const first = runBuild(config, options);
            const second = runBuild(config, options);
            expect([memo.size, memo.hits]).toEqual([1, 1]);
            expect(second.final_history).toBe(first.final_history);
            expect(second.stability_check).toEqual(first.stability_check);
            // what a clock's check writes into its run reaches no other caller, the first included
            const holds = first.stability_check.holds;
            first.stability_check.holds = !holds;
            first.stability_check.as_built = { holds: true } as never;
            const third = runBuild(config, options);
            expect(third.stability_check.holds).toBe(holds);
            expect(third.stability_check.as_built).toBeUndefined();
            expect(second.stability_check.holds).toBe(holds);
        }, 0);
    });

    it("makes a run again when the config or any option that is read differs", () => {
        withRunMemo(() => {
            const memo = currentRunMemo()!;
            runBuild(config, options);
            runBuild({ ...config, overrides: { ...config.overrides, backed_up_belts: true } }, options);
            runBuild(config, { ...options, warmup_periods: 3 });
            runBuild(config, { ...options, factorio_states: true });
            runBuild(config, { ...options, simulate_periods: 2 });
            expect([memo.size, memo.hits]).toEqual([5, 0]);
            // the logger is the one option that is not read
            runBuild(config, { ...options, logger: { ...quiet } });
            expect(memo.hits).toBe(1);
        }, 0);
    });

    it("leaves out the runs that are debugged or record a series of every tick", () => {
        withRunMemo(() => {
            const memo = currentRunMemo()!;
            for (let times = 0; times < 2; times++) {
                runBuild(config, { ...options, debug: DebugSettingsProvider.mutable() });
                runBuild(config, { ...options, debug_steps: {} });
                runBuild(config, { ...options, machine_stock: true });
                runBuild(config, { ...options, fuel_levels: true });
            }
            expect([memo.size, memo.hits]).toEqual([0, 0]);
            expect(RunMemo.accepts(options)).toBe(true);
        }, 0);
    });

    it("keeps only the runs of at least the ticks it is given", () => {
        const run = runBuild(config, options);
        expect(run.ticks_simulated).toBeGreaterThan(run.duration.ticks);
        expect(RUN_MEMO_MIN_TICKS).toBeGreaterThan(run.ticks_simulated);
        for (const [min_ticks, kept] of [[RUN_MEMO_MIN_TICKS, 0], [Infinity, 0], [run.ticks_simulated + 1, 0], [run.ticks_simulated, 1]]) {
            withRunMemo(() => {
                runBuild(config, options);
                expect(currentRunMemo()!.size).toBe(kept);
            }, min_ticks);
        }
    });

    it("ends with the generation, however it ends, and a generation inside one shares its memo", () => {
        let outer: RunMemo | undefined;
        withRunMemo(() => {
            outer = currentRunMemo();
            runBuild(config, options);
            withRunMemo(() => {
                expect(currentRunMemo()).toBe(outer);
                runBuild(config, options);
            }, Infinity);
        }, 0);
        expect([outer!.size, outer!.hits]).toEqual([1, 1]);
        expect(currentRunMemo()).toBeUndefined();
        expect(() => withRunMemo(() => { throw new Error("a generation that fails"); })).toThrow("a generation that fails");
        expect(currentRunMemo()).toBeUndefined();
        // the next generation starts with nothing
        withRunMemo(() => {
            expect(currentRunMemo()).not.toBe(outer);
            expect(currentRunMemo()!.size).toBe(0);
        }, 0);
    });

    it("gives a planning run the plan of the first, as a plan made anew would be", () => {
        const fresh = planRun(config, options);
        withRunMemo(() => {
            const first = planRun(config, options);
            const again = planRun({ ...config }, options);
            expect(currentRunMemo()!.hits).toBe(1);
            expect(again.run.final_history).toBe(first.run.final_history);
            expect(again.unslacked_windows).toEqual(fresh.unslacked_windows);
            expect(again.item_names).toEqual(fresh.item_names);
            expect(again.run.stability_check).toEqual(fresh.run.stability_check);
            expect(again.run.crafting_cycle_plan.total_duration).toEqual(fresh.run.crafting_cycle_plan.total_duration);
        }, 0);
    });

    it("changes nothing a generation yields", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS);
        const generate = (min_ticks: number) => withRunMemo(() => {
            const result = generateClockAlternatives(sample, { logger: quiet });
            return { result, hits: currentRunMemo()!.hits };
        }, min_ticks);
        const without = generate(Infinity);
        const with_memo = generate(0);
        expect(without.hits).toBe(0);
        expect(with_memo.hits).toBeGreaterThan(0);
        expect(with_memo.result).toEqual(without.result);
    });
});

describe("the memo of the backpressure loss verdicts of a generation", () => {
    let config: Config;
    let clock: BlueprintGenerationResult;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        clock = generateClockForConfig(config, { logger: quiet, verify_as_built: false, fuel_consumption_view: false, modulo_blueprint: false, factorio_states: false });
    });

    it("tries a clock once in a generation, whichever alternative asks, and every time outside one", () => {
        const fresh = backpressureLossVerdictOf(config, clock, quiet);
        expect(backpressureLossVerdictOf(config, clock, quiet)).not.toBe(fresh);
        withRunMemo(() => {
            const memo = currentRunMemo()!;
            const first = backpressureLossVerdictOf(config, clock, quiet);
            expect(first).toEqual(fresh);
            expect(backpressureLossVerdictOf(config, clock, quiet)).toBe(first);
            // the way an alternative reaches the same clock: planned with fractional swings, or with the cycles of its own
            expect(backpressureLossVerdictOf({ ...config, overrides: { ...config.overrides, use_fractional_swings: true } }, clock, quiet)).toBe(first);
            expect(backpressureLossVerdictOf({ ...config, overrides: { ...config.overrides, lcm: 7 } }, clock, quiet)).toBe(first);
            expect(memo.loss_hits).toBe(3);
        });
    });

    it("tries a clock again when its windows, its period or the build differ", () => {
        const key = backpressureLossKey(config, clock);
        const other_windows = { ...clock, clock_windows: { ...clock.clock_windows, "inserter:1": [{ start: 0, end: 1 }] } };
        const other_period = { ...clock, simulation_duration: clock.simulation_duration.add(clock.simulation_duration) };
        const other_output = { ...clock, stability_check: { ...clock.stability_check, expected_output_items: clock.stability_check.expected_output_items + 1 } };
        const keys = [other_windows, other_period, other_output].map(it => backpressureLossKey(config, it));
        keys.push(backpressureLossKey({ ...config, overrides: { ...config.overrides, backed_up_belts: true } }, clock));
        keys.push(backpressureLossKey({ ...config, overrides: { ...config.overrides, loop_seed_items: 17 } }, clock));
        expect(new Set([key, ...keys]).size).toBe(keys.length + 1);
    });

    it("tells clocks apart by the cycles they are planned on where those set the clocks of the inserters outside the plan", async () => {
        const fuel = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
        const built = generateClockForConfig(fuel, { logger: quiet, verify_as_built: false, fuel_consumption_view: false, modulo_blueprint: false, factorio_states: false });
        expect(Object.keys(built.unplanned_inserter_clocks ?? {})).not.toEqual([]);
        expect(backpressureLossKey({ ...fuel, overrides: { ...fuel.overrides, lcm: 7 } }, built)).not.toBe(backpressureLossKey(fuel, built));
    });

    it("keeps no verdict for a clock that could not be tried", () => {
        withRunMemo(() => {
            const memo = currentRunMemo()!;
            let tried = 0;
            const none = () => { tried++; return { backpressure_loss: null, backpressure_loss_not_tried: "no" }; };
            memo.backpressureLoss("clock", none);
            memo.backpressureLoss("clock", none);
            expect([tried, memo.loss_hits]).toEqual([2, 0]);
        });
    });
});
