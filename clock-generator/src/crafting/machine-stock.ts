import { EntityState, InserterState, MachineState } from "../state";
import { factorioInserterState } from "../state/factorio-entity-state";

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
}

/** The stock of every machine and the hand of every inserter over a run, tick by tick, to lay against a recording */
export interface StockRecording {
    ticks: number;
    machines: MachineStockSeries[];
    inserters: InserterHandSeries[];
}

/** Samples what the machines and inserters hold after each tick of a run */
export class StockRecorder {
    private ticks = 0;
    private readonly machines: { state: MachineState; series: MachineStockSeries }[];
    private readonly inserters: { state: InserterState; sink: EntityState; series: InserterHandSeries }[];

    /** @param inserters every inserter with what it puts into, which decides the state the game shows while it waits */
    constructor(machine_states: readonly MachineState[], inserters: readonly { state: InserterState; sink: EntityState }[]) {
        this.machines = machine_states.map(state => ({
            state,
            series: {
                machine_id: state.entity_id.id,
                recipe: state.machine.metadata.recipe.name,
                inputs: Object.fromEntries(Array.from(state.machine.inputs.values(), input => [input.item_name, [] as number[]])),
                outputs: Object.fromEntries(state.machine.outputs.map(output => [output.item_name, [] as number[]])),
                fuel: state.machine.fuel_slot ? [] : undefined,
                status: [],
                products_finished: [],
            },
        }));
        this.inserters = inserters.map(({ state, sink }) => ({ state, sink, series: { inserter_id: state.entity_id.id, held: [], held_item: [], status: [], factorio_state: [] } }));
    }

    public record(): void {
        this.ticks += 1;
        for (const { state, series } of this.machines) {
            for (const item_name of Object.keys(series.inputs)) {
                series.inputs[item_name].push(MachineState.ingredientQuantity(state, item_name));
            }
            for (const item_name of Object.keys(series.outputs)) {
                series.outputs[item_name].push(state.inventoryState.getQuantity(item_name));
            }
            series.fuel?.push(state.fuelInventory.getQuantity(state.machine.fuel_slot!.fuel.item_name));
            series.status.push(state.status);
            series.products_finished.push(state.productsFinished);
        }
        for (const { state, sink, series } of this.inserters) {
            series.held.push(state.held_item?.quantity ?? 0);
            series.held_item.push(state.held_item?.item_name ?? "");
            series.status.push(state.status);
            series.factorio_state.push(factorioInserterState(state, sink));
        }
    }

    public recording(): StockRecording {
        return { ticks: this.ticks, machines: this.machines.map(it => it.series), inserters: this.inserters.map(it => it.series) };
    }
}
