import assert from "../../common/assert"
import { EntityId } from "../../entities";
import { EntityState, MachineState, MachineStatus, ReadableEntityStateRegistry } from "../../state";
import { ModePlugin, ModeStateMachine, ModeTransitionEvaluator, Transition } from "../mode";
import { MachineIngredientShortageMode, MachineMode, MachineNoFuelMode, MachineOutputFullMode, MachineWorkingMode } from "./modes";
import { MachineStatusPlugin } from "./plugins";
import { IngredientShortageModeTransitionEvaluator } from "./transitions/ingredient-shortage-mode-evaluator";
import { NoFuelModeTransitionEvaluator } from "./transitions/no-fuel-mode-evaluator";
import { OutputFullModeTransitionEvaluator } from "./transitions/output-full-mode-evaluator";
import { WorkingModeTransitionEvaluator } from "./transitions/working-mode-evaluator";
import { ContainerStorage } from "../../simulation/components/container-storage";
import { MachinePlacementPort } from "../../simulation/components/machine-placement-port";
import { Placement } from "../../simulation/components/placement";

export class MachineStateMachine extends ModeStateMachine<MachineMode> {

    public static create = create;
    public static forMachineId = createFromId;

    /** The machine's Placement, bound to its result target at build */
    private readonly placement: Placement;

    constructor(
        public readonly machine_state: MachineState,
        initialMode: MachineMode,
        graph: Map<MachineMode, ModeTransitionEvaluator<MachineMode>>,
        plugins: ModePlugin<MachineMode>[],
        private readonly working_mode: MachineWorkingMode,
    ) {
        super(initialMode, graph, plugins);
        this.placement = machine_state.placement;
    }

    /**
     * Products the machine holds go to its output in the tick there is room for them, whatever mode it is in; a machine
     * that places its results itself puts what waits in its output into its result target, before it crafts and again
     * after, so that what a tick's crafts give is in the container when the tick ends (recorded on the recycler). The
     * phase table runs the same steps one by one (simulation/tick-phases.ts).
     */
    public override executeForTick(): void {
        this.placeResults();
        this.putHeldProductsInOutput();
        this.ruleStep();
        this.modeStep();
        this.placeResults();
        this.tickObservers();
    }

    /** What waits in the output into the result target, where the machine places its results itself */
    public placeResults(): void {
        this.placement.place();
    }

    /** Products the machine holds into its output, as far as there is room */
    public putHeldProductsInOutput(): void {
        this.working_mode.putHeldProductsInOutput();
    }

    /** The status rule; a copy of ModeStateMachine.ruleStep, see ModeStateMachine.executeForTick */
    public override ruleStep(): void {
        const evaluator = this.current_evaluator ?? this.modeEvaluatorForMode(this.current);
        const transition = evaluator.evaluateTransition();
        const next = transition instanceof Transition ? this.executeTransition(this.current, transition) : this.current;
        if (next !== this.current) {
            this.current = next;
            this.current_evaluator = this.entered_evaluator ?? this.modeEvaluatorForMode(next);
        }
    }

    /** The status's step; a copy, see ModeStateMachine.executeForTick */
    public override modeStep(): void {
        this.current.executeForTick();
    }

    /** MachineStatusPlugin (added at build, so first) and the observers added after it; a copy, see there */
    public override tickObservers(): void {
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
    result_target_state?: ContainerStorage | MachineState,
}): MachineStateMachine {


    const { machine_state, initial_mode_status = MachineStatus.INGREDIENT_SHORTAGE, plugins = [] } = args;

    const result_target = args.result_target_state ?? null;
    // into a machine up to the drill's stop through its placement port; into a container through the container's own port.
    // Results put into its own output count as placed with no target or a machine target, not with a container
    const target_is_machine = result_target !== null && EntityState.isMachine(result_target);
    machine_state.placement.placeInto(target_is_machine ? new MachinePlacementPort(result_target) : result_target,
        result_target === null || target_is_machine);
    const working_mode = new MachineWorkingMode(machine_state, result_target);
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
        ...(result_target_state !== undefined && (ContainerStorage.is(result_target_state) || EntityState.isMachine(result_target_state)) && { result_target_state }),
    });
}

