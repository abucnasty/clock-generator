import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { generateClockAlternatives, simulateClockOnly, type BlueprintGenerationResult } from "../crafting/generate-blueprint";
import type { StockRecording } from "../crafting/machine-stock";
import { wakeUpsOfStock } from "../crafting/wake-ups";
import { buildDifferences, compareRecordings, formatRecordingComparison } from "./compare-recordings";
import { expandChangeList, type Recording } from "./recording";
import { wakeUpsOfRecording } from "./recording-wake-ups";
import { matchOfSimulatedRecording, recordingOfStock, SIMULATED_TICK_TO_CLOCK_POSITION, simulateRecording } from "./simulated-recording";
import { quiet } from "../crafting/generate-blueprint-test-helpers";

/**
 * Automation science on the clock that is selected for it (full-hand output swings): a belt inserter into one machine
 * and an output inserter onto a belt, on a clock of 72 ticks
 */
const PERIODS = 60;

let config: Config;
let result: BlueprintGenerationResult;
let period: number;
let stock: StockRecording;
let simulated: Recording;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
    const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
    result = alternatives[selected_index].result;
    period = result.simulation_duration.ticks;
    stock = simulateClockOnly(config, result.clock_windows, period, PERIODS, quiet);
    simulated = recordingOfStock(stock, config, period);
});

const compared = (recording: Recording, from_sample?: number) => ({ recording, match: matchOfSimulatedRecording(recording), from_sample });
const statesOf = (recording: Recording, id: number) =>
    expandChangeList(recording.inserters.find(inserter => inserter.id === id)!.samples.status, recording.sample_count, "none");

/** The recording from sample `from` on, as a game that was recorded from there */
const cutFrom = (recording: Recording, from: number): Recording => {
    const count = recording.sample_count - from;
    const changes = (list: [number, string][]): [number, string][] => {
        const values = expandChangeList(list, recording.sample_count, "none").slice(from);
        return values.flatMap((value, index) => index === 0 || value !== values[index - 1] ? [[index, value] as [number, string]] : []);
    };
    const cut = (values: number[]) => values.slice(from);
    const cutAll = (series: Record<string, number[]>) => Object.fromEntries(Object.entries(series).map(([name, values]) => [name, cut(values)]));
    return {
        ...recording,
        sample_count: count,
        clock: { values: cut(recording.clock!.values) },
        inserters: recording.inserters.map(inserter => ({
            ...inserter,
            samples: { held_count: cut(inserter.samples.held_count), held_item: changes(inserter.samples.held_item), status: changes(inserter.samples.status) },
        })),
        machines: recording.machines.map(machine => ({
            ...machine,
            samples: {
                ...machine.samples,
                status: changes(machine.samples.status),
                products_finished: cut(machine.samples.products_finished),
                inputs: cutAll(machine.samples.inputs),
                outputs: cutAll(machine.samples.outputs),
            },
        })),
    };
};

describe("a simulated run in the format of the recorder", () => {
    it("holds one sample a tick and reads the clock three positions on from the tick, around the period", () => {
        expect(simulated.sample_count).toBe(PERIODS * period);
        expect(simulated.clock!.values.slice(0, 3)).toEqual([3, 4, 5]);
        expect(simulated.clock!.values[period - SIMULATED_TICK_TO_CLOCK_POSITION]).toBe(0);
        expect(Math.max(...simulated.clock!.values)).toBe(period - 1);
    });

    it("carries the inserters and machines of the config under its ids, with their ends", () => {
        expect(simulated.inserters.map(inserter => inserter.id)).toEqual([1, 2]);
        expect(simulated.inserters[0]).toMatchObject({ source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16 });
        expect(simulated.machines.map(machine => [machine.id, machine.recipe])).toEqual([[1, "automation-science-pack"]]);
    });

    it("names the states as the game does and the hand as the recorder samples it", () => {
        const output = simulated.inserters.find(inserter => inserter.id === 2)!;
        expect(new Set(statesOf(simulated, 2))).toEqual(new Set(["working", "disabled_by_control_behavior", "waiting_for_source_items"]));
        expect(new Set(expandChangeList(simulated.machines[0].samples.status, simulated.sample_count, "none")))
            .toEqual(new Set(["working", "item_ingredient_shortage"]));
        expect(Math.max(...output.samples.held_count)).toBe(16);
        expect(new Set(output.samples.held_item.map(([, item_name]) => item_name))).toEqual(new Set(["automation-science-pack"]));
    });

    it("counts the wake-ups the run counted, by the function that counts those of a recording of the game", () => {
        const from = Math.floor(stock.ticks / 3);
        const of_stock = wakeUpsOfStock(stock, [
            { inserter_id: "inserter:1", source_machine_id: null, sink_machine_id: "machine:1" },
            { inserter_id: "inserter:2", source_machine_id: "machine:1", sink_machine_id: null },
        ], from);
        const of_recording = wakeUpsOfRecording(simulated, matchOfSimulatedRecording(simulated), from);
        const by_id = (a: { inserter_id: string }, b: { inserter_id: string }) => a.inserter_id.localeCompare(b.inserter_id);
        expect({ ...of_recording, inserters: [...of_recording.inserters].sort(by_id) }).toEqual({ ...of_stock, inserters: [...of_stock.inserters].sort(by_id) });
        expect(of_recording.wake_ups_per_minute).toBeCloseTo(112.5, 1);
    });

    it("is what simulateRecording returns for a number of ticks", () => {
        const recording = simulateRecording(config, result.clock_windows, period, 10 * period + 1);
        expect(recording.sample_count).toBe(11 * period);
        expect(statesOf(recording, 2)).toEqual(statesOf(simulated, 2).slice(0, 11 * period));
    });
});

describe("laying a recording against a simulated run", () => {
    const expected_output_per_period = 32;

    it("finds nothing between a run and the same run recorded from a later period on", () => {
        const game = cutFrom(simulated, 20 * period - SIMULATED_TICK_TO_CLOCK_POSITION);
        const report = compareRecordings(compared(game), compared(simulated, 10 * period), config, { expected_output_per_period });

        expect(report.issues).toEqual([]);
        expect(report.clock_ticks).toBe(period);
        // the period the recording starts with is left out
        expect(report.game_periods).toBe(PERIODS - 20 - 1);
        expect(report.output.game.every(items => items === 32)).toBe(true);
        expect(report.inserters.map(it => [it.config_id, it.game_items.mean, it.sim_items.mean, it.game_swings])).toEqual([[1, 32, 32, 2], [2, 32, 32, 2]]);
        expect(report.inserters.map(it => it.states.differences)).toEqual([[], []]);
        report.inserters.forEach(it => expect(it.states.agreement).toBeCloseTo(1, 2));
        expect(report.machines[0].states.agreement).toBeCloseTo(1, 2);
        // counted over other periods of a run that takes several to repeat
        expect(Math.abs(report.game_wake_ups_per_minute - report.sim_wake_ups_per_minute)).toBeLessThan(2);
        expect(formatRecordingComparison(report).at(-1)).toBe("RESULT: the simulator moves what the game moved.");
    });

    it("names the positions of the clock where an inserter shows another state than in the simulator", () => {
        // the game shows the output inserter enabled two ticks later than the simulator has it
        const game = {
            ...simulated,
            inserters: simulated.inserters.map(inserter => inserter.id !== 2 ? inserter : {
                ...inserter,
                samples: { ...inserter.samples, status: inserter.samples.status.map(([sample, state]) => [sample + 2, state] as [number, string]) },
            }),
        };
        const report = compareRecordings(compared(game), compared(simulated), config, { expected_output_per_period });
        const [, output] = report.inserters;

        // what it moved is the same, so it is no issue
        expect(report.issues).toEqual([]);
        expect(output.states.agreement).toBeLessThan(0.95);
        expect(output.states.share_agreement).toBeCloseTo(1, 6);
        expect(output.states.differences.length).toBeGreaterThan(0);
        // two positions at each place the state changes
        expect(output.states.differences.every(it => it.to - it.from <= 1)).toBe(true);
        const lines = formatRecordingComparison(report);
        expect(lines.some(line => line.startsWith("  DIFF inserter 2 (machine 1 -> belt 2)"))).toBe(true);
        expect(lines.at(-1)).toBe("RESULT: the simulator moves what the game moved. 1 entities show another state than in the game more than 5% of the time.");
    });

    it("compares an inserter that runs free of the clock by how much of the time it shows each state, not by where", () => {
        const game = {
            ...simulated,
            inserters: simulated.inserters.map(inserter => inserter.id !== 2 ? inserter : {
                ...inserter,
                samples: { ...inserter.samples, status: inserter.samples.status.map(([sample, state]) => [sample + 2, state] as [number, string]) },
            }),
        };
        const report = compareRecordings(compared(game), compared(simulated), config, { free_running_inserter_ids: new Set([2]) });
        expect(report.inserters[1].states.agreement).toBeCloseTo(1, 6);
        expect(report.inserters[1].states.differences).toEqual([]);
    });

    it("reports an inserter that moves less in the game, and the periods the game came out short in", () => {
        // every third hand of the output inserter comes up 4 items short
        let hands = 0;
        const game = {
            ...simulated,
            inserters: simulated.inserters.map(inserter => {
                if (inserter.id !== 2) {
                    return inserter;
                }
                const held = inserter.samples.held_count;
                let short = false;
                return {
                    ...inserter,
                    samples: {
                        ...inserter.samples,
                        held_count: held.map((count, index) => {
                            if (count > 0 && (index === 0 || held[index - 1] === 0)) {
                                short = hands++ % 3 === 0;
                            }
                            return short ? Math.max(0, count - 4) : count;
                        }),
                    },
                };
            }),
        };
        const report = compareRecordings(compared(game), compared(simulated), config, { expected_output_per_period });

        expect(report.inserters[1].game_items.mean).toBeLessThan(32);
        expect(report.inserters[1].sim_items.mean).toBe(32);
        expect(report.issues.some(issue => issue.startsWith("Inserter 2 (machine 1 -> belt 2) moves"))).toBe(true);
        expect(report.issues.some(issue => issue.startsWith("The game put out something other than the expected 32 items in"))).toBe(true);
        expect(report.issues.some(issue => issue.startsWith("The simulator put out"))).toBe(false);
    });

    it("says so when the recorded clock is not the clock of the config", () => {
        const game = { ...simulated, clock: { values: simulated.clock!.values.map((_, index) => index % (period + 8)) } };
        const report = compareRecordings(compared(game), compared(simulated), config);
        expect(report.issues).toContain(`The recorded clock counts ${period + 8} ticks, the clock of this config ${period}: the blueprint that was recorded is not this clock.`);
    });

    it("notes recorded inserters that are not in the config without calling them a difference", () => {
        const match = { ...matchOfSimulatedRecording(simulated), unmatched_recorded_inserters: [7, 8] };
        const report = compareRecordings({ recording: simulated, match }, compared(simulated), config);
        expect(report.issues).toEqual([]);
        expect(report.notes).toEqual(["Recorded inserters that are not in the config, such as those that load a scaffold: 7, 8"]);
    });
});

// The belt inserter of the sample takes copper plates and gear wheels off belt 1, whose lanes are copper plates and
// gear wheels in that order, and is nearest to the first
describe("a recorded build that is not the build of the config", () => {
    /** The simulated run as a recording of a build whose belt inserter is as given */
    const recordedWith = (belt_inserter: { stack_size?: number, near_lane?: 1 | 2 }): Recording => ({
        ...simulated,
        inserters: simulated.inserters.map(inserter => inserter.id !== 1 ? inserter : {
            ...inserter,
            stack_size: belt_inserter.stack_size ?? inserter.stack_size,
            source: { type: "belt", id: 1, ...(belt_inserter.near_lane ? { near_lane: belt_inserter.near_lane } : {}) },
        }),
    });
    const differences = (recording: Recording, of: Config = config) => buildDifferences(recording, matchOfSimulatedRecording(recording), of);

    it("finds nothing where the build is as the config says", () => {
        expect(differences(recordedWith({ near_lane: 1 }))).toEqual([]);
    });

    it("finds nothing in a recording that does not name the nearest lane, as those of an older recorder", () => {
        expect(differences(recordedWith({}))).toEqual([]);
    });

    it("reports an inserter with another stack size than the config gives it", () => {
        expect(differences(recordedWith({ stack_size: 12, near_lane: 1 }))).toEqual([
            "Inserter 1 (belt 1 -> machine 1) has a stack size of 12 in the recorded build and 16 in the config.",
        ]);
    });

    it("reports an inserter that is nearest to the lane of the item the config has it take second", () => {
        expect(differences(recordedWith({ near_lane: 2 }))).toEqual([
            "Inserter 1 (belt 1 -> machine 1) is nearest to the lane of iron-gear-wheel in the recorded build and takes it before copper-plate; "
            + "the config has it take copper-plate first. Set near_lane on its source to the lane of iron-gear-wheel.",
        ]);
    });

    it("goes by the order of the filters for a config that names no nearest lane", () => {
        const unnamed: Config = structuredClone(config);
        unnamed.inserters[0].source = { type: "belt", id: 1 };
        expect(differences(recordedWith({ near_lane: 1 }), unnamed)).toEqual([]);
        expect(differences(recordedWith({ near_lane: 2 }), unnamed)).toHaveLength(1);
    });

    it("is the first thing a comparison reports", () => {
        const recording = recordedWith({ stack_size: 12, near_lane: 1 });
        const report = compareRecordings(compared(recording), compared(simulated), config);
        expect(report.issues[0]).toBe("The config does not describe the recorded build. Inserter 1 (belt 1 -> machine 1) has a stack size of 12 in the recorded build and 16 in the config.");
    });
});
