import { CompositeControlLogic, EnableControl, TickControlLogic } from "../../control-logic";
import { Duration } from "../../data-types";
import { EntityId } from "../../entities";
import { DrillStatus, MachineStatus } from "../../state";
import { InserterInterceptor } from "./interceptors/inserter-interceptor";
import { cloneSimulationContextWithInterceptors, SimulationContext } from "./simulation-context";

export function simulateFromContext(context: SimulationContext, duration: Duration): void {

    const tick_control_logic = new TickControlLogic(context.tick_provider);

    const control_logic = new CompositeControlLogic(
        [
            tick_control_logic,
            ...context.drills,
            ...context.inserters,
            ...context.machines,
        ]
    )

    const start_tick = context.tick_provider.getCurrentTick();
    const end_tick = start_tick + duration.ticks;

    while (true) {
        const current_tick = context.tick_provider.getCurrentTick();
        if (current_tick >= end_tick) {
            break;
        }
        control_logic.executeForTick();
    }
}

export function warmupSimulation(context: SimulationContext, duration: Duration): void {
    const tick_control_logic = new TickControlLogic(context.tick_provider);

    const control_logic = new CompositeControlLogic(
        [
            tick_control_logic,
            ...context.drills,
            ...context.inserters,
            ...context.machines,
        ]
    )

    const start_tick = context.tick_provider.getCurrentTick();
    const end_tick = start_tick + duration.ticks;

    while (true) {
        const current_tick = context.tick_provider.getCurrentTick();
        if (current_tick >= end_tick) {
            break;
        }
        control_logic.executeForTick();
    }
}

export function simulateUntilAllMachinesAreOutputBlocked(
    context: SimulationContext
): void {

    const tick_control_logic = new TickControlLogic(context.tick_provider);

    const input_inserters_only = context.inserters
        .filter(it => EntityId.isMachine(it.inserter_state.inserter.sink.entity_id))

    const input_inserter_ids = new Set(
        input_inserters_only.map(it => it.inserter_state.inserter.entity_id.id)
    )

    const cloned_context = cloneSimulationContextWithInterceptors(context, {
        inserter: (inserter_state, source_state, sink_state) => {
            if (input_inserter_ids.has(inserter_state.inserter.entity_id.id)) {
                return InserterInterceptor.wait_until_source_is_output_blocked(inserter_state, source_state, sink_state);
            }
            return EnableControl.never
        }
    });


    const control_logic = new CompositeControlLogic(
        [
            tick_control_logic,
            ...cloned_context.drills,
            ...cloned_context.inserters,
            ...cloned_context.machines,
        ]
    )

    while (true) {
        control_logic.executeForTick();
        if (context.tick_provider.getCurrentTick() > 1_000_000) {
            const machines_not_output_full = context.machines.filter(it => it.machine_state.status !== MachineStatus.OUTPUT_FULL)
            machines_not_output_full.forEach(it => {
                console.error(`Machine ${it.machine_state.machine.entity_id} status: ${it.machine_state.status}`);
                it.machine_state.machine.inputs.forEach(input => {
                    if(it.machine_state.inventoryState.getItemOrThrow(input.item_name).quantity < 1) {
                        console.error(`  Missing input: ${input.item_name}`);
                    }
                })
            })
        throw new Error("Simulation exceeded 1,000,000 ticks without reaching output blocked state");
        }
        if (context.machines.some(it => it.machine_state.status !== MachineStatus.OUTPUT_FULL)) {
            continue;
        }

        break;
    }
}