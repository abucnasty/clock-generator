import assert from "../../common/assert";
import { DrillState, DrillStatus, EntityState } from "../../state";
import { AlwaysEnabledControl, EnableControl } from "../enable-control";
import { ModePlugin, ModeStateMachine, ModeTransitionEvaluator } from "../mode";
import { DrillDisabledMode } from "./modes/disabled-mode";
import { DrillMode } from "./modes/drill-mode";
import { DrillWorkingMode } from "./modes/working-mode";
import { DrillChestWorkingMode } from "./modes/chest-working-mode";
import { DrillDisabledModeTransitionEvaluator } from "./transitions/disabled-mode-transition-evaluator";
import { DrillWorkingModeTransitionEvaluator } from "./transitions/working-mode-transition-evaluator";

export class DrillStateMachine extends ModeStateMachine<DrillMode> {
    public static create = create;

    constructor(
        public readonly drill_state: DrillState,
        initial_mode: DrillMode,
        graph: Map<DrillMode, ModeTransitionEvaluator<DrillMode>>,
        plugins: ModePlugin<DrillMode>[] = [],
    ) {
        super(initial_mode, graph, plugins);
    }
}


function create(args: {
    drill_state: DrillState,
    initial_mode_status?: DrillStatus,
    sink_state: EntityState,
    enable_control?: EnableControl
    plugins?: ModePlugin<DrillMode>[],
}): DrillStateMachine {
    const { drill_state, initial_mode_status = DrillStatus.WORKING, sink_state, enable_control = AlwaysEnabledControl, plugins } = args;

    // a drill into a chest drops by the chest's rules; into a machine, by the machine's insertion limit
    const working_mode = EntityState.isChest(sink_state)
        ? new DrillChestWorkingMode(drill_state, sink_state)
        : new DrillWorkingMode(drill_state, sink_state);
    const disabled_mode = new DrillDisabledMode();


    const working_mode_evaluator = new DrillWorkingModeTransitionEvaluator(enable_control, disabled_mode);
    const disabled_mode_evaluator = new DrillDisabledModeTransitionEvaluator(enable_control, working_mode);


    const graph = new Map<DrillMode, ModeTransitionEvaluator<DrillMode>>([
        [working_mode, working_mode_evaluator],
        [disabled_mode, disabled_mode_evaluator],
    ]);

    const initial_mode = Array.from(graph.keys()).find(mode => mode.status === initial_mode_status)
    assert(initial_mode != undefined, `Could not find initial mode for drill with id ${drill_state.entity_id} and status ${initial_mode_status}`);

    return new DrillStateMachine(drill_state, initial_mode, graph, plugins);
}