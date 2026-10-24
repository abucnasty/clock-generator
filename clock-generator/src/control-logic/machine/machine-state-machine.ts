import assert from "../../common/assert"
import { EntityId } from "../../entities";
import { ChestState, EntityState, MachineState, MachineStatus, ReadableEntityStateRegistry } from "../../state";
import { ModePlugin, ModeStateMachine, ModeTransitionEvaluator, Transition } from "../mode";
import { MachineIngredientShortageMode, MachineMode, MachineNoFuelMode, MachineOutputFullMode, MachineWorkingMode } from "./modes";
import { MachineStatusPlugin } from "./plugins";
import { IngredientShortageModeTransitionEvaluator } from "./transitions/ingredient-shortage-mode-evaluator";
import { NoFuelModeTransitionEvaluator } from "./transitions/no-fuel-mode-evaluator";
import { OutputFullModeTransitionEvaluator } from "./transitions/output-full-mode-evaluator";
import { WorkingModeTransitionEvaluator } from "./transitions/working-mode-evaluator";

export class MachineStateMachine extends ModeStateMachine<MachineMode> {

    public static create = create;
    public static forMachineId = createFromId;

    constructor(
        public readonly machine_state: MachineState,
        initialMode: MachineMode,
        graph: Map<MachineMode, ModeTransitionEvaluator<MachineMode>>,
        plugins: ModePlugin<MachineMode>[],
        private readonly working_mode: MachineWorkingMode,
    ) {
        super(initialMode, graph, plugins);
    }

    /**
     * Products the machine holds go to its output in the tick there is room for them, whatever mode it is in; a machine
     * that places its results itself first puts what waits in its output into its result target
     */
    public override executeForTick(): void {
        this.working_mode.placeResults();
        this.working_mode.putHeldProductsInOutput();
        // a copy of ModeStateMachine.executeForTick, see there
        const evaluator = this.current_evaluator ?? this.modeEvaluatorForMode(this.current);
        const transition = evaluator.evaluateTransition();
        const next = transition instanceof Transition ? this.executeTransition(this.current, transition) : this.current;
        if (next !== this.current) {
            this.current = next;
            this.current_evaluator = this.entered_evaluator ?? this.modeEvaluatorForMode(next);
        }
        next.executeForTick();
        const tick_plugins = this.tick_plugins;
        for (let index = 0; index < tick_plugins.length; index++) {
            tick_plugins[index].executeForTick!();
        }
    }
}

function create(args: {
    machine_state: MachineState,
    initial_mode_status?: MachineStatus
    plugins?: ModePlugin<MachineMode>[],
    /** The container the machine places its results into, where it has a result target */
    result_target_state?: ChestState,
}): MachineStateMachine {


    const { machine_state, initial_mode_status = MachineStatus.INGREDIENT_SHORTAGE, plugins = [] } = args;

    const working_mode = new MachineWorkingMode(machine_state, args.result_target_state ?? null);
    const ingredient_shortage_mode = new MachineIngredientShortageMode();
    const output_full_mode = new MachineOutputFullMode();
    const no_fuel_mode = new MachineNoFuelMode();

    const graph = new Map<MachineMode, ModeTransitionEvaluator<MachineMode>>([
        [working_mode, new WorkingModeTransitionEvaluator(
            ingredient_shortage_mode,
            output_full_mode,
            working_mode,
            machine_state,
            no_fuel_mode,
        )],
        [ingredient_shortage_mode, new IngredientShortageModeTransitionEvaluator(
            machine_state,
            working_mode,
            output_full_mode,
            no_fuel_mode,
        )],
        [output_full_mode, new OutputFullModeTransitionEvaluator(
            machine_state,
            working_mode,
            ingredient_shortage_mode,
            no_fuel_mode,
        )],
        [no_fuel_mode, new NoFuelModeTransitionEvaluator(
            working_mode,
            ingredient_shortage_mode,
            output_full_mode,
        )],
    ]);

    const initial_mode = Array.from(graph.keys()).find(mode => mode.status === initial_mode_status)
    assert(initial_mode != undefined, `Could not find initial mode for machine with id ${machine_state.entity_id} and status ${initial_mode_status}`);

    return new MachineStateMachine(
        args.machine_state,
        initial_mode,
        graph,
        plugins.concat(new MachineStatusPlugin(machine_state)),
        working_mode,
    );
}


function createFromId(machine_entity_id: EntityId, entity_state_registry: ReadableEntityStateRegistry): MachineStateMachine {
    const machine_state = entity_state_registry.getStateByEntityIdOrThrow(machine_entity_id);
    if(!EntityState.isMachine(machine_state)) {
        throw new Error(`Entity with id ${machine_entity_id} is not a MachineState`);
    }
    const result_target = machine_state.machine.result_target;
    const result_target_state = result_target === undefined ? undefined : entity_state_registry.getStateByEntityIdOrThrow(result_target);
    return MachineStateMachine.create({
        machine_state: machine_state,
        initial_mode_status: machine_state.status,
        ...(result_target_state !== undefined && EntityState.isChest(result_target_state) && { result_target_state }),
    });
}

