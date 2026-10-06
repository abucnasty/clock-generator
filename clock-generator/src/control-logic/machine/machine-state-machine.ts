import assert from "../../common/assert"
import { EntityId } from "../../entities";
import { EntityState, MachineState, MachineStatus, ReadableEntityStateRegistry } from "../../state";
import { TickProvider } from "../current-tick-provider";
import { ModePlugin, ModeStateMachine, ModeTransitionEvaluator } from "../mode";
import { MachineIngredientShortageMode, MachineMode, MachineOutputFullMode, MachineWorkingMode } from "./modes";
import { CraftEventListener, CraftEventListenerPlugin, MachineStatusPlugin } from "./plugins";
import { IngredientShortageModeTransitionEvaluator } from "./transitions/ingredient-shortage-mode-evaluator";
import { OutputFullModeTransitionEvaluator } from "./transitions/output-full-mode-evaluator";
import { WorkingModeTransitionEvaluator } from "./transitions/working-mode-evaluator";

export class MachineStateMachine extends ModeStateMachine<MachineMode> {

    public static create = create;
    public static forMachineId = createFromId;

    constructor(
        public readonly machine_state: MachineState,
        initialMode: MachineMode,
        graph: Map<MachineMode, ModeTransitionEvaluator<MachineMode>>,
        plugins: ModePlugin<MachineMode>[] = [],
    ) {
        super(initialMode, graph, plugins);
    }

    addCraftEventPlugin(tick_provider: TickProvider, onCraftEvent: CraftEventListener): void {
        this.addPlugin(new CraftEventListenerPlugin(this.machine_state, tick_provider, onCraftEvent));
    }
}

function create(args: {
    machine_state: MachineState,
    initial_mode_status?: MachineStatus
    plugins?: ModePlugin<MachineMode>[],
}): MachineStateMachine {


    const { machine_state, initial_mode_status = MachineStatus.INGREDIENT_SHORTAGE, plugins = [] } = args;

    const working_mode = new MachineWorkingMode(machine_state);
    const ingredient_shortage_mode = new MachineIngredientShortageMode();
    const output_full_mode = new MachineOutputFullMode();

    const graph = new Map<MachineMode, ModeTransitionEvaluator<MachineMode>>([
        [working_mode, new WorkingModeTransitionEvaluator(
            ingredient_shortage_mode,
            output_full_mode,
            working_mode,
            machine_state,
        )],
        [ingredient_shortage_mode, new IngredientShortageModeTransitionEvaluator(
            machine_state,
            working_mode,
            output_full_mode,
        )],
        [output_full_mode, new OutputFullModeTransitionEvaluator(
            machine_state,
            working_mode,
            ingredient_shortage_mode,
        )],
    ]);

    const initial_mode = Array.from(graph.keys()).find(mode => mode.status === initial_mode_status)
    assert(initial_mode != undefined, `Could not find initial mode for machine with id ${machine_state.entity_id} and status ${initial_mode_status}`);

    return new MachineStateMachine(
        args.machine_state,
        initial_mode,
        graph,
        plugins.concat(new MachineStatusPlugin(machine_state)),
    );
}


function createFromId(machine_entity_id: EntityId, entity_state_registry: ReadableEntityStateRegistry): MachineStateMachine {
    const machine_state = entity_state_registry.getStateByEntityIdOrThrow(machine_entity_id);
    if(!EntityState.isMachine(machine_state)) {
        throw new Error(`Entity with id ${machine_entity_id} is not a MachineState`);
    }
    return MachineStateMachine.create({
        machine_state: machine_state,
        initial_mode_status: machine_state.status,
    });
}

