import { beforeAll, describe, expect, test } from "vitest";
import { ClockAlternativesResult, generateClockAlternatives } from "./generate-blueprint";
import { backpressureLossOf } from "./trial";
import { excessLossOf } from "./random-margins";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { clockHash, readControls } from "../../tests/game/builds/clock-controls";

// The exact-speed recycler cell of the ore voider benchmark (save F, the benchmark's waste inserters clocked): a recycler at
// crafting speed 16.875 (540 crafts a second) destroys 400 iron ore a second, brought in by four stack inserters from the
// ore supply; it places what it gives back (a quarter of its crafts, at random) into a car, which two stack inserters
// empty back into it. Planned by arithmetic on the expected amounts, with room in the windows for the spread.
const FIXTURE = ConfigPaths.REAL_OWNER_ORE_VOIDER_EXACT_SPEED;
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
let config: Config;
let generated: ClockAlternativesResult;

beforeAll(async () => {
    config = await loadConfigFromFile(FIXTURE);
    generated = generateClockAlternatives(config, { logger: quiet });
});

describe("a recycler that voids iron ore at exact speed", () => {
    test("gets its batched clock and even hands, both planned on the same hands, and nothing searched", () => {
        expect(generated.alternatives.map(it => it.id)).toEqual(["planned-belt-slack", "even-hands"]);
        expect(generated.skipped_searches).toEqual([]);
        for (const alternative of generated.alternatives) {
            // 15 hands of each feeding inserter a 144-tick period: 960 ore, 400 a second
            expect(alternative.result.simulation_duration.ticks, alternative.id).toBe(144);
            expect(alternative.result.stability_check.expected_output_items, alternative.id).toBe(960);
            expect(alternative.assessment.holds, alternative.id).toBe(true);
            expect(alternative.assessment.items_per_second, alternative.id).toBe(400);
        }
        // the batched clock loses a hand of ore to what comes back over the mean (below)
        expect(generated.alternatives.map(it => it.verdict)).toEqual(["no recovery", "stable"]);
    });

    // In Factorio 2.1.21 an hour of the batched clock brought 896 ore in place of 960 in 5 of 1,900 periods, each after
    // periods of returns over the mean: its second inserter out of the car, enabled 136 ticks of the 144, empties what
    // waits there into the recycler, whose input it takes over the insertion limit of 100 where the four bring ore in, so
    // that one hand of each is not taken before their window closes. Even hands' windows leave it in the car.
    test("is tried with the backlog of returns its margins say the car takes up, which costs the batched clock a hand of ore", () => {
        for (const alternative of generated.alternatives) {
            const [crafting] = alternative.result.random_margins!.crafting;
            // 15.49² x ln(740.7) / (2 x 16 spare crafts x 3/4 not given back): 66.1
            expect(crafting.backlog, alternative.id).toEqual([{ item: "iron-ore", items: 67 }]);
        }
        const excess = excessLossOf(generated.alternatives[0].result.random_margins!.crafting)!;
        expect(excess).toEqual({ kind: "excess", at: [{ machine_id: "machine:1", item: "iron-ore", count: 67 }] });
        const [planned, even] = generated.alternatives.map(alternative => {
            const report = backpressureLossOf(config, alternative.result.clock_windows, 144, 960, quiet, {}, undefined, undefined, [excess]);
            return report.losses.find(it => it.loss.kind === "excess")!;
        });
        // placed into the car at the start of the period, the batched clock brings 896 ore and then 960 again
        expect(planned.recovers).toBe(false);
        expect(planned.trials[0].output_per_bin.slice(0, 2)).toEqual([896, 960]);
        expect(even.recovers).toBe(true);
        expect(even.trials.map(it => it.output_per_bin[0])).toEqual([960, 960, 960, 960]);
        expect(generated.alternatives[0].assessment.backpressure_loss?.broken_by).toEqual(["iron ore comes over its mean"]);
    });

    test("names each clock by the hands brought in a cycle, whether the inserters share a chest or have one each", () => {
        expect(generated.alternatives.map(it => it.label)).toEqual(["Batched swings: 5 hands brought in per cycle", "Even hands: 5 hands brought in per cycle"]);
        // as Sidecar exports the build: the four infinity chests where the design's wagon stood, one for each inserter
        const own_chests: Config = { ...config,
            inserters: config.inserters.map(it => it.source.id === 2 ? { ...it, source: { ...it.source, id: it.id! - 1 } } : it),
            chests: [config.chests![0], ...[2, 3, 4, 5].map(id => ({ ...config.chests![1], id }))] } as Config;
        expect(generateClockAlternatives(own_chests, { logger: quiet }).alternatives.map(it => it.label))
            .toEqual(["Batched swings: 5 hands brought in per cycle", "Even hands: 5 hands brought in per cycle"]);
    });

    test("selects even hands, whose inserters out of the car are woken the least by the ore it places there", () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("even-hands");
        const [planned, even] = generated.alternatives.map(it => it.assessment.wake_ups_per_minute);
        expect(even).toBeLessThan(planned!);
        expect(even).toBeGreaterThan(0);
    });

    test("gives the windows that take the returns out of the car the room for all but 1 in 740 periods' returns", () => {
        for (const alternative of generated.alternatives) {
            const margins = alternative.result.random_margins!;
            expect(margins.windows.map(it => it.item), alternative.id).toEqual(["iron-ore"]);
            const [returns] = margins.windows;
            expect(returns.expected_items).toBe(320);
            expect(returns.sigma_items).toBeCloseTo(15.4919, 4);
            // the binomial of 1280 crafts at 1/4 is under 367 in all but 1 in 740 periods: 47 over the 320
            expect(returns.needed_items).toBe(47);
            expect(returns.room_items, alternative.id).toBeGreaterThanOrEqual(returns.needed_items);
            // the recycler's own room is one standard deviation a period, enough for what comes back over 1233 ticks,
            // which the car takes up
            expect(margins.crafting[0].sigmas).toBeCloseTo(1.0328, 4);
            expect(margins.crafting[0].ticks_to_cover).toBe(1233);
        }
        // even hands' windows take one hand each: two of each taker's ten get a swing more
        expect(generated.alternatives[1].result.random_margins!.windows[0].added_hands).toBe(2);
    });

    test("is back at 960 ore a period after the ore stops coming, on every clock", () => {
        for (const alternative of generated.alternatives) {
            const report = backpressureLossOf(config, alternative.result.clock_windows, 144, 960, quiet);
            expect(report.losses.map(it => [it.loss, it.recovers]), alternative.id).toEqual([[{ kind: "supply", item: "iron-ore" }, true]]);
        }
    });
});

// The same cell with six beacons on its recycler (save B): 852.3 crafts a second, 2045.5 a period against the 1280 it needs
describe("a recycler that voids iron ore with crafts to spare", () => {
    let overbeaconed: Config;
    let alternatives: ClockAlternativesResult;
    beforeAll(async () => {
        overbeaconed = await loadConfigFromFile(ConfigPaths.REAL_OWNER_ORE_VOIDER_OVERBEACONED);
        alternatives = generateClockAlternatives(overbeaconed, { logger: quiet });
    });

    test("gets the same two clocks on the same hands, both stable, and selects even hands", () => {
        expect(alternatives.alternatives.map(it => [it.id, it.verdict, it.assessment.items_per_second, it.result.simulation_duration.ticks]))
            .toEqual([["planned-belt-slack", "stable", 400, 144], ["even-hands", "stable", 400, 144]]);
        expect(alternatives.alternatives[alternatives.selected_index].id).toBe("even-hands");
    });

    test("needs no more room of its recycler: what comes back over the mean is covered within a tick", () => {
        const [crafting] = alternatives.alternatives[0].result.random_margins!.crafting;
        expect(crafting.capacity).toBeCloseTo(2045.52, 2);
        expect(crafting.ticks_to_cover).toBe(1);
        // 765.5 spare crafts work off what comes back over the mean: 1.4 ore waits at 1 in 740
        expect(crafting.backlog).toEqual([{ item: "iron-ore", items: 2 }]);
    });

    test("is back at 960 ore a period after the ore stops coming, on every clock", () => {
        for (const alternative of alternatives.alternatives) {
            const report = backpressureLossOf(overbeaconed, alternative.result.clock_windows, 144, 960, quiet);
            expect(report.losses.map(it => [it.loss, it.recovers]), alternative.id).toEqual([[{ kind: "supply", item: "iron-ore" }, true]]);
        }
    });
});

// the clock each cell's hour in the game was recorded on (tests/game/builds/ore-voider-clock-controls.json)
describe("the clocks the ore voider's hours in the game ran", () => {
    const controls = readControls("ore-voider-clock-controls.json");
    for (const [name, sample] of [["ore-voider-exact-speed", "REAL_OWNER_ORE_VOIDER_EXACT_SPEED"], ["ore-voider-overbeaconed", "REAL_OWNER_ORE_VOIDER_OVERBEACONED"]] as const) {
        test(`${name} is still selected`, async () => {
            const pin = controls.cases[name].generation!;
            const result = generateClockAlternatives(await loadConfigFromFile(ConfigPaths[sample]), { logger: quiet });
            const selected = result.alternatives[result.selected_index];
            expect(clockHash(selected.result.subtick ?? selected.result), "the clock recorded in the game").toBe(pin.clock_sha256);
            expect({ id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second, supply: selected.belt?.kind ?? null })
                .toEqual(pin.selection);
            expect(selected.verdict).toBe(pin.verdict);
            expect(selected.result.simulation_duration.ticks).toBe(pin.period);
        });
    }
});
