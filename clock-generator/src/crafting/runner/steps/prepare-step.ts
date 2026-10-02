import { CompositeControlLogic, ControlLogic, EnableControl, TickControlLogic } from "../../../control-logic";
import { assertIsChest, EntityId } from "../../../entities";
import { EntityState, MachineStatus } from "../../../state";
import { cloneSimulationContextWithInterceptors, SimulationContext } from "../../sequence";
import { InserterInterceptor } from "../../sequence/interceptors/inserter-interceptor";
import { RunnerStep, RunnerStepType } from "./runner-step";

/**
 * PrepareStep simulates the crafting process until all machines are output blocked
 * and all buffer chests are full. This ensures that the system is in a steady state
 * before further simulation steps.
 */
export class PrepareStep implements RunnerStep {
    public readonly type: RunnerStepType = RunnerStepType.PREPARE
    private readonly control_logic: ControlLogic;

    constructor(
        private readonly simulation_context: SimulationContext,
    ) {
        this.control_logic = this.build()
    }

    public execute(): void {
        console.log("Executing Prepare Step");
        const control_logic = this.control_logic;
        const context = this.simulation_context;
        
        // Only check for full buffer chests that have both an input and output inserter
        const buffer_chests = context.state_registry
            .getAllStates()
            .filter(EntityState.isBufferChest)
            .filter(chest => context.inserters.some(inserter_state_machine => inserter_state_machine.inserter_state.inserter.source.entity_id.id === chest.entity_id.id))
            .filter(chest => context.inserters.some(inserter_state_machine => inserter_state_machine.inserter_state.inserter.sink.entity_id.id === chest.entity_id.id))
        
        while (true) {
            control_logic.executeForTick();
            if (context.tick_provider.getCurrentTick() > 1_000_000) {
                const machines_not_output_full = context.machines.filter(it => it.machine_state.status !== MachineStatus.OUTPUT_FULL)
                machines_not_output_full.forEach(it => {
                    console.error(`Machine ${it.machine_state.machine.entity_id} status: ${it.machine_state.status}`);
                    it.machine_state.machine.inputs.forEach(input => {
                        if (it.machine_state.inventoryState.getItemOrThrow(input.item_name).quantity < 1) {
                            console.error(`  Missing input: ${input.item_name}`);
                        }
                    })
                })
                
                // Debug all machines output inventory
                context.machines.forEach(it => {
                    const output_item = it.machine_state.machine.output.ingredient.name;
                    const output_qty = it.machine_state.inventoryState.getQuantity(output_item);
                    console.error(`Machine ${it.machine_state.machine.entity_id} output: ${output_item}=${output_qty}, status=${it.machine_state.status}`);
                })
                
                const chests_not_full = buffer_chests.filter(it => !it.isFull());
                chests_not_full.forEach(it => {
                    console.error(`Chest ${it.entity_id} not full: ${it.getCurrentQuantity()}/${it.getCapacity()}`);
                })
                
                // Debug inserter states
                context.inserters.forEach(it => {
                    const src = it.inserter_state.inserter.source.entity_id;
                    const sink = it.inserter_state.inserter.sink.entity_id;
                    const filters = Array.from(it.inserter_state.inserter.filtered_items);
                    console.error(`Inserter ${it.inserter_state.inserter.entity_id}: status=${it.inserter_state.status}, src=${src}, sink=${sink}, filters=${JSON.stringify(filters)}, held_item=${JSON.stringify(it.inserter_state.held_item)}`);
                })
                
                throw new Error("Simulation exceeded 1,000,000 ticks without reaching ready state");
            }
            
            // Check all machines are output blocked
            if (context.machines.some(it => it.machine_state.status !== MachineStatus.OUTPUT_FULL)) {
                continue;
            }
            
            // Check all buffer chests are full
            if (buffer_chests.some(it => !it.isFull())) {
                continue;
            }

            break;
        }
    }

    private build(): ControlLogic {
        const context = this.simulation_context
        const tick_control_logic = new TickControlLogic(context.tick_provider);
        
        // Input inserters: inserters that drop into machines
        const input_inserters_only = context.inserters
            .filter(it => EntityId.isMachine(it.inserter_state.inserter.sink.entity_id))

        const input_inserter_ids = new Set(
            input_inserters_only.map(it => it.inserter_state.inserter.entity_id.id)
        )
        
        // Inserters that drop into chests (buffer fillers)
        const buffer_chest_sink_inserters = context.inserters
            .filter(it => EntityId.isChest(it.inserter_state.inserter.sink.entity_id))
            .filter(it => {
                const chest = context.entity_registry.getEntityByIdOrThrow(it.inserter_state.inserter.sink.entity_id)
                assertIsChest(chest);
                const is_buffer_chest = context.inserters.some(other_inserter_state_machine =>
                    other_inserter_state_machine.inserter_state.inserter.source.entity_id.id === chest.entity_id.id
                )
                return is_buffer_chest;
            })
        
        const chest_sink_inserter_ids = new Set(
            buffer_chest_sink_inserters.map(it => it.inserter_state.inserter.entity_id.id)
        )

        const cloned_context = cloneSimulationContextWithInterceptors(context, {
            inserter: (inserter_state, source_state, sink_state) => {
                // Input inserters: wait until source machine is output blocked
                if (input_inserter_ids.has(inserter_state.inserter.entity_id.id)) {
                    return InserterInterceptor.wait_until_source_is_output_blocked(inserter_state, source_state, sink_state);
                }
                // Inserters filling chests: wait until source is output blocked (like input inserters)
                if (chest_sink_inserter_ids.has(inserter_state.inserter.entity_id.id)) {
                    return InserterInterceptor.wait_until_source_is_output_blocked(inserter_state, source_state, sink_state);
                }
                // All other inserters (output inserters): disabled until prepare is complete
                return EnableControl.never
            }
        });

        return new CompositeControlLogic(
            [
                tick_control_logic,
                ...cloned_context.drills,
                ...cloned_context.inserters,
                ...cloned_context.machines,
            ]
        )
    }
}