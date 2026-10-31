import { EntityState, InserterState, MachineState } from "../state";
import { InserterStatus } from "../state/entity-status";
import { factorioInserterState } from "../state/factorio-entity-state";
import type { TickRecorder } from "../simulation/observers/observer";

/** What one machine held after each tick of a run */
export interface MachineStockSeries {
    machine_id: string;
    recipe: string;
    /** Ingredients inside, by item, per tick */
    inputs: Record<string, number[]>;
    /** Products in the output, by item, per tick */
    outputs: Record<string, number[]>;
    /** Items in the fuel slot per tick; absent for a machine that burns no fuel */
    fuel?: number[];
    status: string[];
    /** Crafts finished and productivity bars paid out so far, per tick, as the game counts `products_finished` */
    products_finished: number[];
    /** Crafts started so far, per tick: the times the machine took the ingredients of a craft (the simulator's true starts) */
    crafts_started: number[];
    /**
     * Results placed so far where inserters take them, per tick, for a machine that places its results itself (its
     * result target, else its own output); absent for any other machine
     */
    results_placed?: number[];
    /** The crafting bar and the bonus (productivity) bar of the machine per tick, in 0 to 1 and to four decimals as the recorder writes them */
    crafting_progress: number[];
    bonus_progress: number[];
}

/** What one inserter held in its hand after each tick of a run */
export interface InserterHandSeries {
    inserter_id: string;
    held: number[];
    /** The item in the hand per tick, "" while it is empty */
    held_item: string[];
    status: string[];
    /** The state the game would show for it, per tick, as the recorder writes it */
    factorio_state: string[];
    /**
     * Per tick, whether its phase after the tick is the pickup (status PICKUP): it has taken what it found at its source
     * and has not begun the swing. What the crafts that join a grab are read from (inserter-counters.ts). Not recorded
     * in "hands"; empty there, and absent from a stock made by hand.
     */
    at_pickup?: boolean[];
}

/**
 * How much of the stock a run records, by what is going to read it:
 * - "full": every series of every machine and inserter;
 * - "loop-windows": what the windows of a loop's inserters are read from (`loopInserterWindows`) and the levels below
 *   read: the item in every inserter's hand, and what every machine's output held;
 * - "wake-ups": what the wake-ups of a run (`wakeUpsOfStock`), the counters beside them (`countersOfStock`) and the verdict
 *   of a long run read: the hands of every inserter, the state the game shows for it and whether it is at its pickup,
 *   the crafts and payouts of every machine;
 * - "hands": what the verdict of a long run reads alone: the hands of every inserter.
 * "wake-ups" and "hands" also record, for a machine that places its results where inserters take them, what its output
 * held, which the verdict of a target that counts an item destroyed reads (`resultsTakenOf`); the other machines are
 * left out of "hands". A series that is not recorded is empty.
 */
export type StockDetail = "full" | "loop-windows" | "wake-ups" | "hands";

/** The stock of every machine and the hand of every inserter over a run, tick by tick, to lay against a recording */
export interface StockRecording {
    ticks: number;
    /** How much was recorded; "full" where it is left out */
    detail?: StockDetail;
    machines: MachineStockSeries[];
    inserters: InserterHandSeries[];
}

/** A bar as the recorder writes it: rounded to four decimals, within the 0 to 1 the game's bars stay in */
function barOf(progress: number): number {
    return Math.min(1, Math.max(0, Math.floor(progress * 10000 + 0.5) / 10000));
}

/** The longest run whose series are made at their full length at once; a longer one grows them as it goes (V8 keeps an array of more than 2^25 items in a slow form) */
const MAX_PREALLOCATED_TICKS = 1 << 24;

/** Whether a series can be made at this length: a whole number of ticks (a rounded or subtick clock can give a fraction) that is not too long */
function canPreallocate(expected_ticks: number | undefined): expected_ticks is number {
    return expected_ticks !== undefined && Number.isInteger(expected_ticks) && expected_ticks >= 0 && expected_ticks <= MAX_PREALLOCATED_TICKS;
}

/** The series of one item of a machine, with the item they are about */
type ItemSeries = readonly [item_name: string, series: number[]];

/** Samples what the machines and inserters hold after each tick of a run: a recorder of the after-tick phase */
export class StockRecorder implements TickRecorder {
    private ticks = 0;
    private readonly machines: { state: MachineState; series: MachineStockSeries; inputs: ItemSeries[]; outputs: ItemSeries[]; fuel_item: string | undefined }[];
    private readonly inserters: { state: InserterState; sink: EntityState; series: InserterHandSeries }[];

    /**
     * @param inserters every inserter with what it puts into, which decides the state the game shows while it waits
     * @param expected_ticks the ticks the run will record, when it cannot end sooner: the series are then made at that
     *      length and written by index, instead of grown by push. Left out for a run that may stop early at a repeat,
     *      whose request is far longer than what it records.
     * @param detail which series to record (see `StockDetail`); a series that is not recorded is empty
     */
    constructor(machine_states: readonly MachineState[], inserters: readonly { state: InserterState; sink: EntityState }[], expected_ticks?: number,
        private readonly detail: StockDetail = "full") {
        const series_of_ticks = (): number[] => canPreallocate(expected_ticks) ? new Array<number>(expected_ticks) : [];
        const strings_of_ticks = (): string[] => canPreallocate(expected_ticks) ? new Array<string>(expected_ticks) : [];
        const booleans_of_ticks = (): boolean[] => canPreallocate(expected_ticks) ? new Array<boolean>(expected_ticks) : [];
        const full = detail === "full";
        this.machines = (detail === "hands" ? machine_states.filter(state => state.machine.metadata.places_results === true) : machine_states).map(state => {
            if (!full) {
                const places_results = state.machine.metadata.places_results === true || detail === "loop-windows";
                const series: MachineStockSeries = {
                    machine_id: state.entity_id.id,
                    recipe: state.machine.metadata.recipe.name,
                    inputs: {},
                    outputs: places_results ? Object.fromEntries(state.machine.outputs.map(output => [output.item_name, series_of_ticks()])) : {},
                    status: [],
                    products_finished: series_of_ticks(),
                    crafts_started: series_of_ticks(),
                    ...(state.machine.metadata.places_results === true && { results_placed: series_of_ticks() }),
                    crafting_progress: [], bonus_progress: [],
                };
                return { state, series, inputs: [], outputs: Object.entries(series.outputs), fuel_item: undefined };
            }
            const series: MachineStockSeries = {
                machine_id: state.entity_id.id,
                recipe: state.machine.metadata.recipe.name,
                inputs: Object.fromEntries(Array.from(state.machine.inputs.values(), input => [input.item_name, series_of_ticks()])),
                outputs: Object.fromEntries(state.machine.outputs.map(output => [output.item_name, series_of_ticks()])),
                fuel: state.machine.fuel_slot ? series_of_ticks() : undefined,
                status: strings_of_ticks(),
                products_finished: series_of_ticks(),
                crafts_started: series_of_ticks(),
                ...(state.machine.metadata.places_results === true && { results_placed: series_of_ticks() }),
                crafting_progress: series_of_ticks(),
                bonus_progress: series_of_ticks(),
            };
            // the items and their series are listed once, in the order Object.keys gives them
            return {
                state, series, inputs: Object.entries(series.inputs), outputs: Object.entries(series.outputs),
                fuel_item: state.machine.fuel_slot?.fuel.item_name,
            };
        });
        this.inserters = inserters.map(({ state, sink }) => ({
            state, sink,
            series: {
                inserter_id: state.entity_id.id, held: series_of_ticks(),
                held_item: full || detail === "loop-windows" ? strings_of_ticks() : [], status: full ? strings_of_ticks() : [],
                factorio_state: detail === "hands" ? [] : strings_of_ticks(),
                at_pickup: detail === "hands" ? [] : booleans_of_ticks(),
            },
        }));
    }

    public record(): void {
        const tick = this.ticks;
        this.ticks += 1;
        if (this.detail !== "full") {
            this.recordLean(tick);
            return;
        }
        for (const { state, series, inputs, outputs, fuel_item } of this.machines) {
            for (const [item_name, item_series] of inputs) {
                item_series[tick] = state.ingress.ingredientQuantity(item_name);
            }
            for (const [item_name, item_series] of outputs) {
                item_series[tick] = state.inventoryState.getQuantity(item_name);
            }
            if (series.fuel !== undefined) {
                series.fuel[tick] = state.fuelInventory.getQuantity(fuel_item!);
            }
            series.status[tick] = state.status;
            series.products_finished[tick] = state.productsFinished;
            series.crafts_started[tick] = state.craftsStarted;
            if (series.results_placed !== undefined) {
                series.results_placed[tick] = state.placement.results_placed;
            }
            series.crafting_progress[tick] = barOf(state.craftingProgress.progress);
            series.bonus_progress[tick] = barOf(state.bonusProgress.progress);
        }
        for (const { state, sink, series } of this.inserters) {
            series.held[tick] = state.held_item?.quantity ?? 0;
            series.held_item[tick] = state.held_item?.item_name ?? "";
            series.status[tick] = state.status;
            series.factorio_state[tick] = factorioInserterState(state, sink);
            series.at_pickup![tick] = state.status === InserterStatus.PICKUP;
        }
    }

    /** The series of a recording that is not "full" */
    private recordLean(tick: number): void {
        for (const { state, series, outputs } of this.machines) {
            for (const [item_name, item_series] of outputs) {
                item_series[tick] = state.inventoryState.getQuantity(item_name);
            }
            series.products_finished[tick] = state.productsFinished;
            series.crafts_started[tick] = state.craftsStarted;
            if (series.results_placed !== undefined) {
                series.results_placed[tick] = state.placement.results_placed;
            }
        }
        for (const { state, sink, series } of this.inserters) {
            series.held[tick] = state.held_item?.quantity ?? 0;
            if (this.detail !== "hands") {
                series.factorio_state[tick] = factorioInserterState(state, sink);
                series.at_pickup![tick] = state.status === InserterStatus.PICKUP;
            }
            if (this.detail === "loop-windows") {
                series.held_item[tick] = state.held_item?.item_name ?? "";
            }
        }
    }

    public recording(): StockRecording {
        this.trimSeries();
        return { ticks: this.ticks, ...(this.detail !== "full" && { detail: this.detail }), machines: this.machines.map(it => it.series), inserters: this.inserters.map(it => it.series) };
    }

    /** Cuts the series made for more ticks than were recorded back to the ticks recorded */
    private trimSeries(): void {
        const cut = (series: unknown[] | undefined): void => {
            if (series !== undefined && series.length > this.ticks) {
                series.length = this.ticks;
            }
        };
        for (const { series } of this.machines) {
            for (const item_series of [...Object.values(series.inputs), ...Object.values(series.outputs)]) {
                cut(item_series);
            }
            for (const column of [series.fuel, series.status, series.products_finished, series.crafts_started, series.results_placed, series.crafting_progress, series.bonus_progress]) {
                cut(column);
            }
        }
        for (const { series } of this.inserters) {
            for (const column of [series.held, series.held_item, series.status, series.factorio_state, series.at_pickup]) {
                cut(column);
            }
        }
    }
}
