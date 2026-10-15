import { Config } from "../config";
import { simulateClockOnly, SerializableClockWindows } from "../crafting/generate-blueprint";
import { StockRecording } from "../crafting/machine-stock";
import { EntityId, Machine } from "../entities";
import { FACTORIO_MACHINE_STATE } from "../state/factorio-entity-state";
import { MachineStatus } from "../state";
import { EntityMatch } from "./entity-matching";
import { Recording } from "./recording";
import { wakeUpsOfRecording } from "./recording-wake-ups";

/**
 * Ticks from a tick of a simulated run to the sample of a recording that reads the same clock position: tick `i` of
 * a run that starts on a period is what the recorder samples at clock position `i + 3`. Read off recordings of the
 * scaffolded builds in Factorio 2.1.21, where an inserter shows as enabled at the positions of its window plus 3.
 */
export const SIMULATED_TICK_TO_CLOCK_POSITION = 3;

type Target = { type: "machine" | "belt" | "chest"; id: number };

/** [sample index, value] where the value changes, as the recorder writes a series that seldom does */
function changeList<T>(values: readonly T[]): [number, T][] {
    const changes: [number, T][] = [];
    values.forEach((value, index) => {
        if (index === 0 || value !== values[index - 1]) {
            changes.push([index, value]);
        }
    });
    return changes;
}

/**
 * A simulated run in the format of the recorder, so that what reads a recording of the game reads a run of the
 * simulator too, and the two are laid against each other by one set of functions. Its inserters and machines carry
 * the ids of the config. The clock counts `clock_ticks` positions: the period of the clock, or the ticks after which
 * a fractional period repeats, as its subtick clock counts them.
 */
export function recordingOfStock(stock: StockRecording, config: Config, clock_ticks: number): Recording {
    const inserter_configs = new Map(config.inserters.map((inserter, index) => [inserter.id ?? index + 1, inserter]));
    const fuel_items = new Map(config.machines.map(machine => [machine.id, Machine.fromConfig(machine).fuel_slot?.fuel.item_name]));
    // the config id of each series, by the key of its entity id
    const inserter_ids = new Map(Array.from(inserter_configs.keys(), id => [EntityId.forInserter(id).id, id]));
    const machine_ids = new Map(config.machines.map(machine => [EntityId.forMachine(machine.id).id, machine.id]));
    const inserterIdOf = (series: { inserter_id: string }) => inserter_ids.get(series.inserter_id)!;
    const machineIdOf = (series: { machine_id: string }) => machine_ids.get(series.machine_id)!;
    return {
        format: "clock-generator-recording",
        version: 1,
        start_game_tick: 0,
        sample_count: stock.ticks,
        stop_reason: "simulated",
        clock: { values: Array.from({ length: stock.ticks }, (_, tick) => (tick + SIMULATED_TICK_TO_CLOCK_POSITION) % clock_ticks) },
        config: {
            inserters: config.inserters.map(inserter => ({
                source: inserter.source as Target,
                sink: inserter.sink as Target,
                filters: inserter.filters?.map(filter => filter),
            })),
            belts: config.belts.map(belt => ({ id: belt.id, lanes: belt.lanes.map(lane => ({ ingredient: lane.ingredient })) })),
        },
        inserters: [...stock.inserters].sort((a, b) => inserterIdOf(a) - inserterIdOf(b)).map(series => {
            const id = inserterIdOf(series);
            const inserter = inserter_configs.get(id)!;
            return {
                id,
                name: "simulated",
                source: inserter.source as Target,
                sink: inserter.sink as Target,
                stack_size: inserter.stack_size,
                samples: {
                    held_count: series.held,
                    held_item: changeList(series.held_item).filter(([, item_name]) => item_name !== ""),
                    status: changeList(series.factorio_state),
                },
            };
        }),
        machines: [...stock.machines].sort((a, b) => machineIdOf(a) - machineIdOf(b)).map(series => {
            const id = machineIdOf(series);
            const fuel_item = fuel_items.get(id);
            return {
                id,
                name: "simulated",
                recipe: series.recipe,
                samples: {
                    status: changeList(series.status.map(status => FACTORIO_MACHINE_STATE[status as MachineStatus] as string)),
                    // the simulator keeps no bars to lay against the game's
                    crafting_progress: [],
                    bonus_progress: [],
                    products_finished: series.products_finished,
                    crafts_started: series.crafts_started,
                    inputs: series.inputs,
                    outputs: series.outputs,
                    fuel: series.fuel !== undefined && fuel_item !== undefined ? { [fuel_item]: series.fuel } : undefined,
                },
            };
        }),
    };
}

/** The entities of a simulated recording are those of the config, under its ids */
export function matchOfSimulatedRecording(recording: Recording): EntityMatch {
    return {
        machines: new Map(recording.machines.map(machine => [machine.id, machine.id])),
        inserters: new Map(recording.inserters.map(inserter => [inserter.id, inserter.id])),
        unmatched_recorded_machines: [],
        unmatched_config_machines: [],
        unmatched_recorded_inserters: [],
        unmatched_config_inserters: [],
    };
}

/**
 * Runs a build on clock windows alone in the simulator, as its blueprint does in game, and returns the run as a
 * recording of at least `ticks` samples. `clock_ticks` is what the clock counts to when the period is not a whole
 * number of ticks.
 */
export function simulateRecording(
    config: Config,
    clock_windows: SerializableClockWindows,
    period_ticks: number,
    ticks: number,
    clock_ticks: number = period_ticks,
): Recording {
    const quiet = { log() { }, warn() { }, error: console.error, debug() { } };
    const stock = simulateClockOnly(config, clock_windows, period_ticks, Math.ceil(ticks / period_ticks), quiet);
    return recordingOfStock(stock, config, clock_ticks);
}

/**
 * The wake-ups a minute a clock counts in the simulator from each of `starts` places in its period to start it at,
 * the first of them where the generator starts it. A clock can settle into more than one steady state with the same
 * output, depending on where it starts, and each has wake-ups of its own: batched swings on utility science makes
 * 192 a period at 10.7, 26.8 or 32.1 wake-ups a minute. The game settles into one of them, which need not be the
 * one the generator's own run does. Empty for a period that is not a whole number of ticks.
 */
export function simulatedWakeUpsByStart(
    config: Config,
    clock_windows: SerializableClockWindows,
    period_ticks: number,
    starts: number,
    periods: number = 60,
): number[] {
    if (!Number.isInteger(period_ticks)) {
        return [];
    }
    const quiet = { log() { }, warn() { }, error: console.error, debug() { } };
    const figures: number[] = [];
    for (let start = 0; start < starts; start++) {
        const offset = Math.floor(period_ticks * start / starts);
        // a window that runs over the end of the period goes on at its beginning
        const shifted = Object.fromEntries(Object.entries(clock_windows).map(([entity_id, ranges]) => [entity_id, ranges.flatMap(range => {
            const from = (range.start + offset) % period_ticks;
            const to = from + range.end - range.start;
            return to < period_ticks ? [{ start: from, end: to }] : [{ start: 0, end: to - period_ticks }, { start: from, end: period_ticks - 1 }];
        }).sort((a, b) => a.start - b.start)]));
        const recording = recordingOfStock(simulateClockOnly(config, shifted, period_ticks, periods, quiet), config, period_ticks);
        figures.push(wakeUpsOfRecording(recording, matchOfSimulatedRecording(recording), Math.floor(recording.sample_count / 3)).wake_ups_per_minute);
    }
    return figures;
}
