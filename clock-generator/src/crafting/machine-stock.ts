import { InserterState, MachineState } from "../state";

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
}

/** What one inserter held in its hand after each tick of a run */
export interface InserterHandSeries {
    inserter_id: string;
    held: number[];
    status: string[];
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
    private readonly inserters: { state: InserterState; series: InserterHandSeries }[];

    constructor(machine_states: readonly MachineState[], inserter_states: readonly InserterState[]) {
        this.machines = machine_states.map(state => ({
            state,
            series: {
                machine_id: state.entity_id.id,
                recipe: state.machine.metadata.recipe.name,
                inputs: Object.fromEntries(Array.from(state.machine.inputs.values(), input => [input.item_name, [] as number[]])),
                outputs: Object.fromEntries(state.machine.outputs.map(output => [output.item_name, [] as number[]])),
                fuel: state.machine.fuel_slot ? [] : undefined,
                status: [],
            },
        }));
        this.inserters = inserter_states.map(state => ({ state, series: { inserter_id: state.entity_id.id, held: [], status: [] } }));
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
        }
        for (const { state, series } of this.inserters) {
            series.held.push(state.held_item?.quantity ?? 0);
            series.status.push(state.status);
        }
    }

    public recording(): StockRecording {
        return { ticks: this.ticks, machines: this.machines.map(it => it.series), inserters: this.inserters.map(it => it.series) };
    }
}
