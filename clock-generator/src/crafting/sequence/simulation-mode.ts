import assert from "../../common/assert";
import { Duration } from "../../data-types";
import { handSizeFor, Inserter, InserterStackSize, Machine } from "../../entities";
import { EntityTransferCount } from "./cycle/swing-counts";

export const SimulationMode = {
    LOW_INSERTION_LIMITS: "low_insertion_limits",
    PREVENT_DESYNCS: "prevent_desyncs",
    NORMAL: "normal",
} as const;

export type SimulationMode = typeof SimulationMode[keyof typeof SimulationMode];

export function simulationModeForInput(
    inserter: Inserter,
    sink_machine: Machine
): SimulationMode {
    // the fuel slot takes only a few items, so an inserter filling it is limited by it like by any low insertion limit
    const machine_inputs = sink_machine.getInsertableInputs();
    const filtered_items = inserter.filtered_items;
    const is_input_inserter = inserter.sink.entity_id.id === sink_machine.entity_id.id;
    assert(is_input_inserter, `Inserter ${inserter.entity_id} is not an input inserter for machine ${sink_machine.entity_id}`)

    const any_filtered_item_has_low_insertion_limit = machine_inputs
        .filter(it => filtered_items.has(it.item_name))
        .some(it => it.automated_insertion_limit.quantity < InserterStackSize.SIZE_16)

    if (any_filtered_item_has_low_insertion_limit) {
        return SimulationMode.LOW_INSERTION_LIMITS;
    }

    return SimulationMode.NORMAL;
}

export function simulationModeForOutput(
    inserter: Inserter,
    entity_transfer_count: EntityTransferCount,
    source_machine: Machine
): SimulationMode {
    

    const machine_inputs = Array.from(source_machine.inputs.values());
    const is_output_inserter = inserter.source.entity_id.id === source_machine.entity_id.id;

    assert(is_output_inserter, `Inserter ${inserter.entity_id} is not an output inserter for machine ${source_machine.entity_id}`)

    const output_block = source_machine.output.outputBlock;

    const expected_transfer_count = entity_transfer_count.total_transfer_count;
    const expected_transfer_amount = expected_transfer_count.multiply(handSizeFor(inserter, source_machine.output.item_name)).toDecimal();


    if (expected_transfer_amount > output_block.quantity) {
        // FIXME: more nuanced logic here to determine if we need to prevent desyncs
        // for example, in the electric furnace sample config, this could be just the normal mode and does not need desync prevention
        // as the inserter being clocked to be enabled for just 1 tick is enough for it to work
        return SimulationMode.PREVENT_DESYNCS;
    }

    const any_input_has_low_insertion_limit = machine_inputs.some(it => it.automated_insertion_limit.quantity < handSizeFor(inserter, source_machine.output.item_name));

    if (any_input_has_low_insertion_limit) {
        return SimulationMode.LOW_INSERTION_LIMITS;
    }

    

    

    // if the output block condition is less than the max stack size for the ingredient, need to prevent
    // desyncs and add a buffer of a pickup to use the inserter as the inventory holder
    if (output_block.quantity < output_block.max_stack_size) {
        return SimulationMode.PREVENT_DESYNCS;
    }
    return SimulationMode.NORMAL;
}

export function computeSimulationMode(
    machine: Machine,
    inserter: Inserter,
    entity_transfer_count: EntityTransferCount,
): SimulationMode {

    const is_output_inserter = inserter.source.entity_id.id === machine.entity_id.id;
    const is_input_inserter = inserter.sink.entity_id.id === machine.entity_id.id;

    if (is_input_inserter) {
        return simulationModeForInput(inserter, machine);
    }

    if (is_output_inserter) {
        return simulationModeForOutput(inserter, entity_transfer_count, machine);
    }

    throw new Error(`Inserter ${inserter.entity_id} is not connected to machine ${machine.entity_id}`);
}

export function computeLastSwingOffsetDuration(
    source_machine: Machine,
    inserter: Inserter,
    entity_transfer_count: EntityTransferCount
): Duration {
    const mode = computeSimulationMode(source_machine, inserter, entity_transfer_count);
    if (mode === SimulationMode.NORMAL) {
        const animation = inserter.animation
        return Duration.ofTicks(
            animation.rotation.ticks + animation.drop.ticks
        );
    }
    return Duration.zero;
}
