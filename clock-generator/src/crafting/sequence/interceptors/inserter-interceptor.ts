import { AlwaysEnabledControl, EnableControl } from "../../../control-logic";
import { InserterState, EntityState, MachineStatus } from "../../../state";

export type InserterInterceptor = (inserter_state: InserterState, source_state: EntityState, sink_state: EntityState) => EnableControl

const AlwaysEnabledInterceptor: InserterInterceptor = (): EnableControl => {
    return AlwaysEnabledControl
}

const AlwaysDisabledInterceptor: InserterInterceptor = (): EnableControl => {
    return EnableControl.never
}

const WaitUntilSourceIsOutputBlockedInterceptor: InserterInterceptor = (inserter_state, source_state, sink_state): EnableControl => {
    if (EntityState.isMachine(source_state) && EntityState.isMachine(sink_state)) {
        const source_item_name = source_state.machine.output.item_name;
        const sink_input = sink_state.machine.getInsertableInputOrThrow(source_item_name);

        return EnableControl.latched({
            base: EnableControl.lambda(() => {
                return source_state.status === MachineStatus.OUTPUT_FULL
            }),
            release: EnableControl.never
        })
    }

    if (EntityState.isChest(source_state) && EntityState.isMachine(sink_state)) {
        // Infinity chests are always ready (they never run out of items)
        if (EntityState.isInfinityChest(source_state)) {
            return AlwaysEnabledControl;
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
    if (EntityState.isMachine(source_state) && EntityState.isChest(sink_state)) {
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
const WaitUntilSinkChestIsFullInterceptor: InserterInterceptor = (inserter_state, source_state, sink_state): EnableControl => {
    if (EntityState.isChest(sink_state)) {
        return EnableControl.latched({
            base: EnableControl.lambda(() => {
                return sink_state.isFull()
            }),
            release: EnableControl.never
        })
    }

    return AlwaysEnabledControl
}

export const InserterInterceptor = {
    always_enabled: AlwaysEnabledInterceptor,
    always_disabled: AlwaysDisabledInterceptor,
    wait_until_source_is_output_blocked: WaitUntilSourceIsOutputBlockedInterceptor,
    wait_until_sink_chest_is_full: WaitUntilSinkChestIsFullInterceptor
}