import { Config } from "../../config";
import { orderByMachineDependencies } from "../../common/order-by-machine-dependencies";
import { AlwaysEnabledControl, EnableControl, MutableTickProvider } from "../../control-logic";
import { DrillStateMachine } from "../../control-logic/drill/drill-state-machine";
import { InserterStateMachine } from "../../control-logic/inserter/inserter-state-machine";
import { MachineStateMachine } from "../../control-logic/machine/machine-state-machine";
import { DEFAULT_TAKER_ORDER, InserterUpdates, TakerOrder } from "../../control-logic/inserter/competing-takers";
import { ControlLogic } from "../../control-logic";
import { Belt, Chest, EntityId, EntityRegistry, InserterFactory, Machine, WritableEntityRegistry } from "../../entities";
import { MiningDrill } from "../../entities/drill/mining-drill";
import { MiningProductivity } from "../../entities/drill/mining-productivity";
import { assertIsMachineState, DrillState, DrillStatus, EntityState, EntityStateFactory, EntityStateRegistry, InserterState, MachineState, WritableEntityStateRegistry } from "../../state";
import { TargetProductionRate } from "../target-production-rate";
import { DebugPluginFactory } from "./debug";
import { InserterInterceptor } from "./interceptors/inserter-interceptor";
import { InserterTrace, InserterTraceOptions } from "../../state/inserter-trace";
import assert from "../../common/assert";
import { BeltPickupLane } from "../../state/belt-pickup-lane";

/** Initial moving-lane phases by inserter id, in the pickup model's public 1/32-tile units. */
export type MovingPickupPhases = ReadonlyMap<string, readonly [number, number]>;

export class SimulationContext {

    static fromConfig = createSimulationContextFromConfig;

    constructor(
        public readonly tick_provider: MutableTickProvider,
        public readonly entity_registry: WritableEntityRegistry,
        public readonly state_registry: WritableEntityStateRegistry,
        public readonly machines: MachineStateMachine[],
        public readonly inserters: InserterStateMachine[],
        public readonly drills: DrillStateMachine[],
        public readonly target_production_rate: TargetProductionRate,
        /** In what order inserters that compete for one machine's product are updated where the turn rule cannot decide */
        public competing_takers_order: TakerOrder = DEFAULT_TAKER_ORDER,
    ) {}

    /** Observe one inserter without changing generation or simulation state. Ticks use this context's provider. */
    public traceInserter(id: number, options: InserterTraceOptions = {}): InserterTrace {
        const state = this.inserters.find(inserter => inserter.entity_id.number === id)?.inserter_state;
        if (!state) throw new Error(`Cannot trace unknown inserter ${id}`);
        const trace = new InserterTrace(() => this.tick_provider.getCurrentTick(), options);
        state.trace = trace;
        return trace;
    }

    /** Seed a new trial's stock before any tick, independently of its clock and machine inventory. */
    public initializeMovingPickupPhases(phases: MovingPickupPhases): void {
        assert(this.tick_provider.getCurrentTick() === 0, "Pickup phases must be initialized before simulation starts");
        for (const [id, lane_phases] of phases) {
            const control = this.inserters.find(inserter => inserter.entity_id.id === id);
            assert(control !== undefined, `Cannot initialize pickup phases for unknown ${id}`);
            const inserter = control.inserter_state.inserter;
            const source = this.state_registry.getStateByEntityIdOrThrow(inserter.source.entity_id);
            assert(EntityState.isBelt(source) && inserter.belt_supply === "moving",
                `Pickup phases need independent moving lanes: ${id}`);
            const length = inserter.pickup_length;
            assert(length !== undefined, `Pickup phases need pickup geometry: ${id}`);
            assert(lane_phases.every(phase => Number.isInteger(phase) && phase >= 0 && phase < 8),
                "Pickup phases must be integers from 0 through 7 (1/32-tile units)");
            const lanes = source.pickup_lanes.get(id);
            assert(lanes !== undefined, `Pickup lanes have not been initialized for ${id}`);
            // Transfer logic already holds this array. Keep its identity when seeding the trial.
            lanes.splice(0, lanes.length, ...source.belt.lanes.map((lane, index) => new BeltPickupLane(
                source.belt.belt_speed, length, lane.stack_size, lane_phases[index])));
        }
    }

    /** The update of every inserter in a tick, in the order of the list and of `competing_takers_order` */
    public inserterUpdates(): ControlLogic {
        return new InserterUpdates(this.inserters, this.state_registry, this.competing_takers_order);
    }

    public clone(args: Partial<SimulationContext> = {}): SimulationContext {
        return new SimulationContext(
            args.tick_provider ?? this.tick_provider,
            args.entity_registry ?? this.entity_registry,
            args.state_registry ?? this.state_registry,
            args.machines ?? [...this.machines],
            args.inserters ?? [...this.inserters],
            args.drills ?? [...this.drills],
            args.target_production_rate ?? this.target_production_rate,
            args.competing_takers_order ?? this.competing_takers_order,
        );
    }

    public addDebuggerPlugins(debug_plugin_factory: DebugPluginFactory): void {
        this.machines.forEach(it => debug_plugin_factory.forMachine(it));

        this.inserters.forEach(it => {
            it.addPlugin(debug_plugin_factory.inserterModeChangePlugin(it));
            it.addPlugin(debug_plugin_factory.inserterHandContentsChangePlugin(it));
        });

        this.drills.forEach(it => {
            it.addPlugin(debug_plugin_factory.drillModeChangePlugin(it.drill_state))
        })
    }
}

type MachineStateMachineInterceptor = (entity_state: EntityState) => MachineStateMachine | null
type InserterStateMachineInterceptor = (entity_state: EntityState) => InserterStateMachine | null

/** The entities of a config: belts, machines, chests, inserters and drills, without any state */
export function createEntityRegistryFromConfig(config: Config): EntityRegistry {
    const entity_registry = new EntityRegistry();

    const belt_supply = config.overrides?.backed_up_belts === true ? "backed_up" : "moving";
    const inserter_factory = new InserterFactory(entity_registry, belt_supply);

    config.belts.forEach(beltConfig => {
        entity_registry.add(Belt.fromConfig(beltConfig));
    })

    config.machines.forEach(machineConfig => {
        entity_registry.add(Machine.fromConfig(machineConfig))
    });

    const chests = config.chests

    if (chests) {
        chests.forEach(chestConfig => {
            entity_registry.add(Chest.fromConfig(chestConfig))
        })
    }

    config.inserters.forEach((inserterConfig, index) => {
        entity_registry.add(inserter_factory.fromConfig(inserterConfig.id ?? (index + 1), inserterConfig))
    });

    const drills = config.drills

    if (drills) {
        const mining_productivity = MiningProductivity.fromLevel(drills.mining_productivity_level)
        drills.configs.forEach((drill_config, index) => {
            entity_registry.add(MiningDrill.fromConfig(mining_productivity, drill_config))
        })
    }

    return entity_registry;
}

function createSimulationContextFromConfig(
    config: Config,
    interceptors: {
        machine_interceptor?: MachineStateMachineInterceptor,
        inserter_interceptor?: InserterStateMachineInterceptor,
    } = {}
): SimulationContext {
    const entity_registry = createEntityRegistryFromConfig(config);

    const state_factory = new EntityStateFactory(entity_registry);

    const entity_states = entity_registry.getAll().map(entity => state_factory.createStateForEntity(entity.entity_id))
    const entity_state_registry = new EntityStateRegistry(entity_registry).addStates(entity_states);

    const tick_provider = new MutableTickProvider();

    const machine_state_machines: MachineStateMachine[] = entity_state_registry
        .getAllStates()
        .filter(EntityState.isMachine)
        .map(machine_state => {
            const possible_state_machine = interceptors.machine_interceptor && interceptors.machine_interceptor(machine_state);
            if (possible_state_machine) {
                return possible_state_machine;
            }
            return MachineStateMachine.create({
                machine_state: machine_state,
            });
        })

    const inserter_state_machines: InserterStateMachine[] = orderInsertersDownstreamFirst(
        entity_state_registry.getAllStates().filter(EntityState.isInserter)
    )
        .map(inserter_state => {
            const possible_state_machine = interceptors.inserter_interceptor && interceptors.inserter_interceptor(inserter_state);
            if (possible_state_machine) {
                return possible_state_machine;
            }
            return InserterStateMachine.create({
                inserter_state: inserter_state,
                source_state: entity_state_registry.getStateByEntityIdOrThrow(inserter_state.inserter.source.entity_id),
                sink_state: entity_state_registry.getStateByEntityIdOrThrow(inserter_state.inserter.sink.entity_id),
                enable_control: AlwaysEnabledControl,
                tick_provider: tick_provider
            })
        })


    const drill_state_machines: DrillStateMachine[] = entity_state_registry
        .getAllStates()
        .filter(EntityState.isDrill)
        .map(drill_state => {
            return DrillStateMachine.create({
                drill_state: drill_state,
                initial_mode_status: DrillStatus.WORKING,
                enable_control: AlwaysEnabledControl,
                sink_state: entity_state_registry.getStateByEntityIdOrThrow(drill_state.drill.sink_id),
            })
        })

    const target_production_rate = TargetProductionRate.fromConfig(config.target_output);

    return new SimulationContext(
        tick_provider,
        entity_registry,
        entity_state_registry,
        machine_state_machines,
        inserter_state_machines,
        drill_state_machines,
        target_production_rate
    )
}

/**
 * Orders inserters so that every inserter pulling from a machine is updated before any inserter
 * feeding that machine. Otherwise an input inserter evaluated earlier in the same tick still sees
 * the machine as output blocked, which skews identical machines by a tick depending on config order.
 */
function orderInsertersDownstreamFirst(inserters: InserterState[]): InserterState[] {
    return orderByMachineDependencies(inserters,
        inserter => EntityId.isMachine(inserter.inserter.source.entity_id) ? inserter.inserter.source.entity_id.id : undefined,
        inserter => inserter.inserter.sink.entity_id.id);
}

export function cloneSimulationContextWithInterceptors(
    context: SimulationContext,
    interceptors: {
        inserter?: InserterInterceptor,
        drill?: (drill_state: DrillState, sink_state: MachineState) => EnableControl,
    } = {}
): SimulationContext {

    const entity_state_registry = context.state_registry;

    let new_inserters: InserterStateMachine[] | null = null
    let new_drills: DrillStateMachine[] | null = null

    if (interceptors.inserter) {
        new_inserters = context.inserters.map(inserter_state_machine => {
            const inserter_state = inserter_state_machine.inserter_state;
            const source_state = entity_state_registry.getStateByEntityIdOrThrow(inserter_state.inserter.source.entity_id)
            const sink_state = entity_state_registry.getStateByEntityIdOrThrow(inserter_state.inserter.sink.entity_id)
            const enable_control = interceptors.inserter!(inserter_state_machine.inserter_state, source_state, sink_state);

            return InserterStateMachine.create({
                inserter_state: inserter_state_machine.inserter_state,
                source_state: source_state,
                sink_state: sink_state,
                enable_control: enable_control,
                tick_provider: context.tick_provider,
                plugins: inserter_state_machine.getPlugins()
            })
        })
    }

    if (interceptors.drill) {
        new_drills = context.drills.map(drill_state_machine => {
            const sink_state = entity_state_registry.getStateByEntityIdOrThrow(drill_state_machine.drill_state.drill.sink_id);
            assertIsMachineState(sink_state);
            const enable_control = interceptors.drill!(drill_state_machine.drill_state, sink_state);
            return DrillStateMachine.create({
                drill_state: drill_state_machine.drill_state,
                initial_mode_status: DrillStatus.WORKING,
                enable_control: enable_control,
                sink_state: sink_state,
                plugins: drill_state_machine.getPlugins()
            })
        })
    }

    return context.clone({
        inserters: new_inserters ?? context.inserters,
        drills: new_drills ?? context.drills,
    });
}
