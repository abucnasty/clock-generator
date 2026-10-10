import { Config } from "../config";
import { simulateClockOnly, SerializableClockWindows } from "../crafting/generate-blueprint";
import { StockRecording } from "../crafting/machine-stock";
import { Machine } from "../entities";
import { FACTORIO_MACHINE_STATE } from "../state/factorio-entity-state";
import { MachineStatus } from "../state";
import { EntityMatch } from "./entity-matching";
import { Recording } from "./recording";

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

const numberOf = (entity_id: string): number => Number(entity_id.slice(entity_id.indexOf(":") + 1));

/**
 * A simulated run in the format of the recorder, so that what reads a recording of the game reads a run of the
 * simulator too, and the two are laid against each other by one set of functions. Its inserters and machines carry
 * the ids of the config. The clock counts `clock_ticks` positions: the period of the clock, or the ticks after which
 * a fractional period repeats, as its subtick clock counts them.
 */
export function recordingOfStock(stock: StockRecording, config: Config, clock_ticks: number): Recording {
    const inserter_configs = new Map(config.inserters.map((inserter, index) => [inserter.id ?? index + 1, inserter]));
    const fuel_items = new Map(config.machines.map(machine => [machine.id, Machine.fromConfig(machine).fuel_slot?.fuel.item_name]));
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
        inserters: [...stock.inserters].sort((a, b) => numberOf(a.inserter_id) - numberOf(b.inserter_id)).map(series => {
            const id = numberOf(series.inserter_id);
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
        machines: [...stock.machines].sort((a, b) => numberOf(a.machine_id) - numberOf(b.machine_id)).map(series => {
            const id = numberOf(series.machine_id);
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
