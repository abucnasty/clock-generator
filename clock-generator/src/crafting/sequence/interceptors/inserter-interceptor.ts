import { AlwaysEnabledControl, EnableControl } from "../../../control-logic";
import { InserterState, EntityState, MachineStatus } from "../../../state";
import { ContainerStorage } from "../../../simulation/components/container-storage";

export type InserterInterceptor = (inserter_state: InserterState, source_state: EntityState, sink_state: EntityState) => EnableControl

const WaitUntilSourceIsOutputBlockedInterceptor: InserterInterceptor = (inserter_state, source_state, sink_state): EnableControl => {
    if (EntityState.isMachine(source_state) && EntityState.isMachine(sink_state)) {
        const source_item_name = source_state.machine.output.item_name;
        // throws when the sink does not take what the source makes
        sink_state.machine.getInsertableInputOrThrow(source_item_name);

        return EnableControl.latched({
            base: EnableControl.lambda(() => {
                return source_state.status === MachineStatus.OUTPUT_FULL
            }),
            release: EnableControl.never
        })
    }

    if (ContainerStorage.is(source_state) && EntityState.isMachine(sink_state)) {
        // Infinity chests are always ready (they never run out of items)
        if (ContainerStorage.isConstant(source_state)) {
            return AlwaysEnabledControl;
        }
        // A chest of mixed items that nothing fills gives what it starts with
        if (ContainerStorage.isMixed(source_state) && source_state.chest.items_put_in.length === 0) {
            return AlwaysEnabledControl;
        }
        // A chest of mixed items: wait until it is full of each item this inserter takes, not of every item it holds. A
        // container used as a hub is filled with some of its items only by machines that need the others first.
        if (ContainerStorage.isMixed(source_state)) {
            const filters = Array.from(inserter_state.inserter.filtered_items);
            const taken = filters.length > 0 ? filters
                : source_state.getItemFilters().filter(item => sink_state.machine.inputs.has(item));
            return EnableControl.latched({
                base: EnableControl.lambda(() => taken.length === 0 ? source_state.isFull() : taken.every(item => source_state.isFull(item))),
                release: EnableControl.never
            })
        }
        // Buffer chests: wait until chest is full (buffered and ready)
        return EnableControl.latched({
            base: EnableControl.lambda(() => {
                return source_state.isFull()
            }),
            release: EnableControl.never
        })
    }

    // For machine source going to chest: wait until machine is output full
    if (EntityState.isMachine(source_state) && ContainerStorage.is(sink_state)) {
        return EnableControl.latched({
            base: EnableControl.lambda(() => {
                return source_state.status === MachineStatus.OUTPUT_FULL
            }),
            release: EnableControl.never
        })
    }

    return AlwaysEnabledControl
}

/**
 * Interceptor that waits until a chest sink is full before allowing the inserter to proceed.
 * Used during warmup to fill buffer chests before allowing downstream inserters to swing.
 */
export const InserterInterceptor = {
    wait_until_source_is_output_blocked: WaitUntilSourceIsOutputBlockedInterceptor,
}