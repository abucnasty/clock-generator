import assert from "../../common/assert"
import { ControlLogic } from "../control-logic";
import { ModePlugin, ModeStateMachine, ModeTransitionEvaluator } from "../mode";
import { InserterDropMode, InserterIdleMode, InserterMode, InserterPickupMode, InserterSwingMode } from "./modes";
import { InserterTargetFullMode } from "./modes/target-full-mode";
import { InserterWaitForSinkMode } from "./modes/wait-for-sink-mode";
import { EntityId } from "../../entities";
import { EntityState, InserterState, InserterStatus, ReadableEntityStateRegistry } from "../../state";
import { TickProvider } from "../current-tick-provider";
import { EnableControl } from "../enable-control";
import { InserterDisabledMode } from "./modes/disabled-mode";
import { InserterStatusPlugin } from "./plugins";
import { IdleModeTransitionEvaluator, InserterSwingModeTransitionEvaluator, DropModeTransitionEvaluator, PickupModeTransitionEvaluator, DisabledModeTransitionEvaluator, TargetFullModeTransitionEvaluator, WaitForSinkModeTransitionEvaluator } from "./transitions";

export class InserterStateMachine extends ModeStateMachine<InserterMode> {
    public entity_id: EntityId;

    public static create = createInserterStateMachine;
    public static forInserterId = createFromId;

    constructor(
        initialMode: InserterMode,
        transitionGraph: Map<InserterMode, ModeTransitionEvaluator<InserterMode>>,
        plugins: ModePlugin<InserterMode>[] = [],
        public readonly inserter_state: InserterState,
        public readonly sink_state: EntityState,
        private readonly enable_control?: EnableControl,
    ) {
        super(initialMode, transitionGraph, plugins);
        this.entity_id = inserter_state.entity_id;
    }

    public override executeForTick(): void {
        // If the enable control implements ControlLogic, execute it each tick
        // This allows controls like FractionalSwingEnableControl to track state transitions
        if (this.enable_control && 'executeForTick' in this.enable_control) {
            (this.enable_control as ControlLogic).executeForTick();
        }
        super.executeForTick();
        this.inserter_state.enabled = this.shownEnabled();
    }

    /**
     * Whether the game would show the inserter as enabled after this tick. The game shows it a tick ahead of what
     * the inserter does. Recorded on seven runs of five builds in Factorio 2.1.21: a hand never grows in the first
     * tick an inserter shows as enabled, and it does grow in the first tick it shows as disabled, never after that.
     * A window of 4 ticks shows as 4 ticks that are not disabled, and the inserter acts in the 4 ticks one later.
     * So a clock of the game is asked for the next tick.
     *
     * A clock of the plan is a tick longer than what the inserter acts in, since it wakes in the first: it is asked
     * for this tick and the next. Any other control is not asked again, since it may latch: with it the inserter
     * counts as enabled until it reaches its disabled mode.
     */
    private shownEnabled(): boolean {
        const control = this.enable_control;
        if (control?.isEnabledIn !== undefined && control.is_game_clock) {
            return control.isEnabledIn(1);
        }
        // an inserter in its disabled mode was asked this tick and stayed there
        if (this.inserter_state.status === InserterStatus.DISABLED) {
            return false;
        }
        if (control?.isEnabledIn === undefined) {
            return true;
        }
        return control.isEnabledIn(0) && control.isEnabledIn(1);
    }
};

function createInserterStateMachine(args: {
    inserter_state: InserterState,
    source_state: EntityState,
    sink_state: EntityState,
    tick_provider: TickProvider,
    enable_control: EnableControl,
    plugins?: ModePlugin<InserterMode>[]
}): InserterStateMachine {
    const {
        inserter_state: inserter_state,
        source_state,
        sink_state,
        tick_provider,
        enable_control,
        plugins = []
    } = args;

    const idle_mode = new InserterIdleMode();
    const pickup_mode = InserterPickupMode.create({
        inserterState: inserter_state,
        sourceState: source_state,
        sinkState: sink_state,
        tick_provider,
    })
    const swing_mode = new InserterSwingMode();
    const drop_mode = new InserterDropMode(inserter_state, sink_state, tick_provider);
    const disabled_mode = new InserterDisabledMode();
    const target_full_mode = new InserterTargetFullMode(drop_mode);
    const wait_for_sink_mode = new InserterWaitForSinkMode();

    const idle_mode_evaluator = IdleModeTransitionEvaluator.create({
        inserter_state: inserter_state,
        source_state: source_state,
        sink_state: sink_state,
        enable_control: enable_control,
        disabled_mode: disabled_mode,
        tick_provider: tick_provider,
        pickup_mode: pickup_mode,
    })

    const swing_mode_evaluator = InserterSwingModeTransitionEvaluator.create({
        inserter_animation: inserter_state.inserter.animation,
        drop_mode: drop_mode,
        idle_mode: idle_mode,
        tick_provider: tick_provider,
        idle_mode_transition_evaluator: idle_mode_evaluator,
    })

    const drop_mode_evaluator = new DropModeTransitionEvaluator(
        inserter_state,
        sink_state,
        swing_mode,
        target_full_mode
    );

    const target_full_mode_evaluator = new TargetFullModeTransitionEvaluator(
        inserter_state,
        swing_mode
    );

    const pickup_mode_evaluator = new PickupModeTransitionEvaluator(
        inserter_state,
        sink_state,
        swing_mode,
        disabled_mode,
        idle_mode,
        enable_control,
        wait_for_sink_mode,
        source_state,
    );

    const wait_for_sink_mode_evaluator = new WaitForSinkModeTransitionEvaluator(
        inserter_state,
        sink_state,
        pickup_mode,
        disabled_mode,
        enable_control,
    );

    const disabled_mode_evaluator = new DisabledModeTransitionEvaluator(
        enable_control,
        idle_mode,
        idle_mode_evaluator,
    );

    const graph = new Map<InserterMode, ModeTransitionEvaluator<InserterMode>>([
        [idle_mode,        idle_mode_evaluator],
        [swing_mode,       swing_mode_evaluator],
        [drop_mode,        drop_mode_evaluator],
        [pickup_mode,      pickup_mode_evaluator],
        [disabled_mode,    disabled_mode_evaluator],
        [target_full_mode, target_full_mode_evaluator],
        [wait_for_sink_mode, wait_for_sink_mode_evaluator],
    ]);

    const initial_mode = idle_mode;

    const inserter_status_plugin = new InserterStatusPlugin(inserter_state);

    return new InserterStateMachine(
        initial_mode,
        graph,
        [inserter_status_plugin, ...plugins],
        inserter_state,
        sink_state,
        enable_control,
    );
}

function createFromId(args: {
    entity_id: EntityId,
    entity_state_registry: ReadableEntityStateRegistry,
    tick_provider: TickProvider,
    enable_control: EnableControl,
}): InserterStateMachine {
    const {
        entity_id,
        entity_state_registry,
        tick_provider,
        enable_control
    } = args;
    const inserter_state = entity_state_registry.getStateByEntityIdOrThrow(entity_id);
    assert(EntityState.isInserter(inserter_state), `Entity with ID ${entity_id} is not an inserter`);

    const source_state = entity_state_registry.getStateByEntityIdOrThrow(inserter_state.inserter.source.entity_id);
    const sink_state = entity_state_registry.getStateByEntityIdOrThrow(inserter_state.inserter.sink.entity_id);


    return createInserterStateMachine({
        inserter_state: inserter_state,
        source_state: source_state,
        sink_state: sink_state,
        tick_provider: tick_provider,
        enable_control: enable_control,
    })

}
