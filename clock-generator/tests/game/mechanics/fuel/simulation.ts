import {ConfigSchema} from "../../../../src/config";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {Machine, RecipeMetadata} from "../../../../src/entities";
import {AlwaysEnabledControl, EnableControl} from "../../../../src/simulation/controls/enable-control";
import {ContainerStorage} from "../../../../src/simulation/components/container-storage";
import {SuppliedBurnerEnergy} from "../../../../src/simulation/components/supplied-burner-energy";
import {MachineState} from "../../../../src/state/machine-state";
import {CraftingStatus} from "../../../../src/simulation/status-codes";
import {BurnerEnergy} from "../../../../src/simulation/components/burner-energy";
import {FuelCase} from "./cases";
import {ScenarioInfo} from "./recording";

/** What the recording logs of a tick, as the simulator holds it: the columns the checks compare */
export interface SimRow {
    t: number;
    /** J */
    heat: number;
    /** J */
    remaining: number;
    fuel_count: number;
    progress: number;
    /** A machine's CraftingStatus, a drill's DrillStatusCode */
    status: number;
    /** Items made, taken away or in the output */
    output: number;
    finished: number;
}

const RECIPE_OF: Record<FuelCase["entity"], string> = {
    "stone-furnace": "iron-plate", "steel-furnace": "iron-plate", "captive-biter-spawner": "biter-egg", "biochamber": "bioflux",
    "burner-mining-drill": "iron-ore",
};

/** What the probe puts in a machine each tick to keep it supplied, and where its products go (probe.lua supply) */
const SUPPLY: Record<string, [string, number, number][]> = {
    "stone-furnace": [["iron-ore", 20, 30]], "steel-furnace": [["iron-ore", 20, 30]],
    "biochamber": [["yumako-mash", 60, 60], ["jelly", 60, 60]],
    "captive-biter-spawner": [],
};

const OUTPUT_OF: Record<string, string> = {"stone-furnace": "iron-plate", "steel-furnace": "iron-plate", "captive-biter-spawner": "biter-egg", "biochamber": "bioflux"};

/** The simulator's machine for a scenario: its prototype, recipe, crafting speed and fuel */
export function machineOf(info: ScenarioInfo, spec: FuelCase): Machine {
    return Machine.createMachine(1, {
        crafting_speed: info.crafting_speed!, productivity: 0, recipe: RecipeMetadata.fromRecipeName(RECIPE_OF[spec.entity]),
        prototype: spec.entity, fuel: spec.fuel,
    });
}

/** A crafting machine of a scenario in the simulator, as the probe works it (probe.lua): supply, taking products, the gap, the fuel put in */
export function simulateMachine(info: ScenarioInfo, spec: FuelCase, ticks: number): SimRow[] {
    const machine = machineOf(info, spec);
    const state = MachineState.forMachine(machine);
    const energy = state.energy as BurnerEnergy;
    const fuel_item = machine.fuel_slot!.fuel.item_name;
    if ((spec.count ?? 0) > 0) state.fuelInventory.setQuantity(fuel_item, spec.count!);
    if (spec.remaining_mj !== undefined && spec.remaining_mj > 0) energy.energy_remaining_mj = spec.remaining_mj;
    const output_item = OUTPUT_OF[spec.entity];
    let taken = 0;
    const rows: SimRow[] = [];
    let in_gap = false;
    for (let t = 0; t <= ticks; t++) {
        const gap = spec.gap !== undefined && t >= spec.gap && t < (spec.gap_end ?? Infinity);
        if (gap && !in_gap) {
            in_gap = true;
            if (spec.gap_mode === "ingredients") for (const [item] of SUPPLY[spec.entity]) state.inventoryState.setQuantity(item, 0);
            if (spec.gap_mode === "output") state.inventoryState.addQuantity(output_item, 100000);
        }
        if (!gap && in_gap) {
            in_gap = false;
            if (spec.gap_mode === "output") state.inventoryState.setQuantity(output_item, 0);
        }
        if (spec.mode === "work") {
            if (!(gap && spec.gap_mode === "ingredients")) {
                for (const [item, below, add] of SUPPLY[spec.entity]) if (state.inventoryState.getQuantity(item) < below) state.inventoryState.addQuantity(item, add);
            }
            if (!(gap && spec.gap_mode === "output")) {
                const held = state.inventoryState.getQuantity(output_item);
                if (held >= 40) { state.inventoryState.setQuantity(output_item, 0); taken += held; }
            }
        }
        if (spec.refuel?.[String(t)]) state.fuelInventory.addQuantity(fuel_item, spec.refuel_count ?? 1);
        rows.push({
            t, heat: energy.energy_buffer_mj * 1e6, remaining: energy.energy_remaining_mj * 1e6, fuel_count: state.fuelInventory.getQuantity(fuel_item),
            progress: state.crafting.craftingProgress.progress, status: state.crafting.status,
            output: taken + state.inventoryState.getQuantity(output_item), finished: state.yield.productsFinished,
        });
        // the tick: held products into the output, the status rule, then a working machine's tick (CraftingMachineArchetype)
        state.yield.putHeldProductsInOutput(state.crafting);
        const to = state.crafting.statusRule();
        state.crafting.status = to;
        if (to === CraftingStatus.WORKING) state.crafting.tick();
    }
    return rows;
}

/** A burner mining drill of a scenario on iron ore into a chest, with the probe's cheats: the chest emptied, filled at the gap, the drill disabled */
export function simulateDrill(info: ScenarioInfo, spec: FuelCase, ticks: number): SimRow[] {
    const config = ConfigSchema.parse({
        target_output: {recipe: "iron-gear-wheel", items_per_second: 1, copies: 1},
        machines: [{id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0}], belts: [], inserters: [],
        chests: [{type: "buffer-chest", id: 1, storage_size: 48, item_filter: "iron-ore"}],
        drills: {configs: [{id: 1, type: "burner-mining-drill", mined_item_name: "iron-ore", speed_bonus: 0, productivity: 0, target: {type: "chest", id: 1}}]},
    });
    const context = SimulationContext.fromConfig(config);
    const drill = context.drills[0];
    const chest = context.state_registry.getStateByEntityIdOrThrow(drill.drill_state.drill.sink_id) as ContainerStorage;
    const energy = drill.drill_state.energy as SuppliedBurnerEnergy;
    const disabled: EnableControl = {isEnabled: () => false};
    let taken = 0;
    const rows: SimRow[] = [];
    let in_gap = false;
    for (let t = 0; t <= ticks; t++) {
        const gap = spec.gap !== undefined && t >= spec.gap && t < (spec.gap_end ?? Infinity);
        if (gap && !in_gap) {
            in_gap = true;
            if (spec.gap_mode === "output") chest.insert("iron-ore", chest.getAvailableSpace("iron-ore"));
            if (spec.gap_mode === "disabled") drill.control.use(disabled);
        }
        if (!gap && in_gap) {
            in_gap = false;
            if (spec.gap_mode === "output") chest.take("iron-ore", chest.getCurrentQuantity("iron-ore"));
            if (spec.gap_mode === "disabled") drill.control.use(AlwaysEnabledControl);
        }
        if (spec.mode === "work" && !(gap && spec.gap_mode === "output")) {
            const ore = chest.getCurrentQuantity("iron-ore");
            if (ore >= 1000) { chest.take("iron-ore", ore); taken += ore; }
        }
        rows.push({
            t, heat: energy.energy_buffer_mj * 1e6, remaining: 0, fuel_count: 0, progress: drill.mining.mining_progress,
            status: drill.status as number, output: taken + chest.getCurrentQuantity("iron-ore"), finished: 0,
        });
        drill.executeForTick();
    }
    return rows;
}

