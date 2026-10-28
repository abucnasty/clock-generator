import { Config } from "../../config";
import { orderByMachineDependencies } from "../../common/order-by-machine-dependencies";
import { AlwaysEnabledControl, EnableControl } from "../../simulation/controls/enable-control";
import { MutableTickProvider } from "../../simulation/current-tick-provider";
import { CraftingMachineArchetype } from "../../simulation/archetypes/crafting-machine";
import { InserterArchetype } from "../../simulation/archetypes/inserter";
import { DEFAULT_TAKER_ORDER, TakerOrder } from "../../simulation/competing-takers";
import { Belt, Chest, Entity, EntityId, EntityRegistry, InserterFactory, Machine, WritableEntityRegistry } from "../../entities";
import { MiningDrill } from "../../entities/drill/mining-drill";
import { DrillState, EntityState, EntityStateFactory, EntityStateRegistry, InserterState, WritableEntityStateRegistry } from "../../state";
import { TargetProductionRate } from "../target-production-rate";
import { InserterInterceptor } from "./interceptors/inserter-interceptor";
import { InserterTrace, InserterTraceOptions } from "../../state/inserter-trace";
import assert from "../../common/assert";
import { BeltPickupLane } from "../../state/belt-pickup-lane";
import { pickupLaneLength } from "../../common/belt-pickup-layout";
import { itemsPutInto, PutIntoView } from "../../entities/chest/items-put-into";
import { ContainerStorage } from "../../simulation/components/container-storage";
import { MiningDrillArchetype } from "../../simulation/archetypes/mining-drill";

/** Initial moving-lane phases by inserter id, in the pickup model's public 1/32-tile units. */
export type MovingPickupPhases = ReadonlyMap<string, readonly [number, number]>;

/**
 * What a control swap puts the inserters and drills on: the planner's policy for each kind (`interceptors/`), which
 * gives each entity its enable control from its state and the states it takes from and puts into. A kind the policy has
 * no entry for keeps its controls.
 */
export interface ControlPolicy {
    inserter?: InserterInterceptor;
    drill?: (drill_state: DrillState, sink_state: EntityState) => EnableControl;
}

export class SimulationContext {

    static fromConfig = createSimulationContextFromConfig;

    constructor(
        public readonly tick_provider: MutableTickProvider,
        public readonly entity_registry: WritableEntityRegistry,
        public readonly state_registry: WritableEntityStateRegistry,
        public readonly machines: CraftingMachineArchetype[],
        public readonly inserters: InserterArchetype[],
        public readonly drills: MiningDrillArchetype[],
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
            assert(source.pickupsOf(id) !== undefined, `Pickup lanes have not been initialized for ${id}`);
            // The hand's belt pickup port already holds the lanes' slots: the seed replaces the stock in them.
            source.seedPickups(id, source.belt.lanes.map((lane, index) => new BeltPickupLane(
                source.belt.belt_speed, pickupLaneLength(inserter.pickup_layout ?? "side-straight", index + 1, length), lane.stack_size, lane_phases[index])));
        }
    }

    /**
     * A control swap, in place, between runs and never in a tick: every inserter and then every drill, each in the
     * order of its list, is put on the control the policy gives it (`useControl`), where the policy has an entry for
     * its kind. An inserter starts at IDLE with its Hand's scratch set back, while its status, its hand, the pickup arm
     * and the belt lanes are kept; a drill starts WORKING with both bars at 0, while what it holds is kept (same-tick
     * rule 12). Machines, ports, observers and the lists stay as they are, so a World built from this context
     * (`SimulationTick`) runs the new controls.
     */
    public useControls(policy: ControlPolicy): void {
        const states = this.state_registry;
        const inserter_policy = policy.inserter;
        if (inserter_policy !== undefined) {
            for (const inserter of this.inserters) {
                const inserter_state = inserter.inserter_state;
                const source_state = states.getStateByEntityIdOrThrow(inserter_state.inserter.source.entity_id);
                const sink_state = states.getStateByEntityIdOrThrow(inserter_state.inserter.sink.entity_id);
                inserter.useControl(inserter_policy(inserter_state, source_state, sink_state));
            }
        }
        const drill_policy = policy.drill;
        if (drill_policy !== undefined) {
            for (const drill of this.drills) {
                const drill_state = drill.drill_state;
                const sink_state = states.getStateByEntityIdOrThrow(drill_state.drill.sink_id);
                drill.useControl(drill_policy(drill_state, sink_state));
            }
        }
    }
}

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
            entity_registry.add(Chest.fromConfig(chestConfig, itemsPutInto(config, chestConfig.id, registryPutIntoView(entity_registry))))
        })
    }

    config.inserters.forEach((inserterConfig, index) => {
        entity_registry.add(inserter_factory.fromConfig(inserterConfig.id ?? (index + 1), inserterConfig))
    });

    const drills = config.drills

    if (drills) {
        drills.configs.forEach(drill_config => {
            entity_registry.add(MiningDrill.fromConfig(drill_config))
        })
    }

    for (const source of entity_registry.getAll().filter(Entity.isMachine)) {
        const target = source.result_target === undefined ? null : entity_registry.getEntityById(source.result_target);
        if (target === null || !Entity.isMachine(target)) continue;
        for (const output of source.outputs.filter(output => target.inputs.has(output.item_name))) {
            const another = entity_registry.getAll().some(entity =>
                Entity.isInserter(entity) ? entity.sink.entity_id.id === target.entity_id.id && entity.filtered_items.has(output.item_name)
                    : Entity.isDrill(entity) ? entity.sink_id.id === target.entity_id.id && entity.item.name === output.item_name
                        : Entity.isMachine(entity) && entity !== source && entity.result_target?.id === target.entity_id.id
                            && entity.outputs.some(result => result.item_name === output.item_name));
            assert(!another, `Machine ${target.entity_id.number} gets ${output.item_name} from Machine ${source.entity_id.number} and another source. `
                + "A clock for several sources of an item placed directly into a machine is not planned yet.");
        }
    }
    return entity_registry;
}

/** The machines' products and the belts' lanes as the entities of the registry give them */
function registryPutIntoView(entity_registry: EntityRegistry): PutIntoView {
    return {
        machineOutputs: id => {
            const machine = entity_registry.getEntityById(EntityId.forMachine(id));
            return machine !== null && Entity.isMachine(machine) ? machine.outputs.map(output => output.item_name) : [];
        },
        beltItems: id => {
            const belt = entity_registry.getEntityById(EntityId.forBelt(id));
            return belt !== null && Entity.isBelt(belt) ? belt.lanes.map(lane => lane.ingredient_name) : [];
        },
    };
}

function createSimulationContextFromConfig(config: Config): SimulationContext {
    const entity_registry = createEntityRegistryFromConfig(config);

    const state_factory = new EntityStateFactory(entity_registry);

    const entity_states = entity_registry.getAll().map(entity => state_factory.createStateForEntity(entity.entity_id))
    const entity_state_registry = new EntityStateRegistry(entity_registry).addStates(entity_states);

    const tick_provider = new MutableTickProvider();

    const machine_state_machines: CraftingMachineArchetype[] = entity_state_registry
        .getAllStates()
        .filter(EntityState.isMachine)
        .map(machine_state => {
            const result_target = machine_state.machine.result_target;
            const result_target_state = result_target === undefined ? undefined : entity_state_registry.getStateByEntityIdOrThrow(result_target);
            assert(result_target_state === undefined || ContainerStorage.is(result_target_state) || EntityState.isMachine(result_target_state),
                `${machine_state.machine} places its results into ${result_target}, which is neither a machine nor a chest`);
            return CraftingMachineArchetype.create({
                machine_state: machine_state,
                ...(result_target_state !== undefined && { result_target_state }),
            });
        })

    const inserter_archetypes: InserterArchetype[] = orderInsertersDownstreamFirst(
        entity_state_registry.getAllStates().filter(EntityState.isInserter)
    )
        .map(inserter_state => {
            return InserterArchetype.create({
                inserter_state: inserter_state,
                source_state: entity_state_registry.getStateByEntityIdOrThrow(inserter_state.inserter.source.entity_id),
                sink_state: entity_state_registry.getStateByEntityIdOrThrow(inserter_state.inserter.sink.entity_id),
                enable_control: AlwaysEnabledControl,
                tick_provider: tick_provider
            })
        })


    const drill_state_machines: MiningDrillArchetype[] = entity_state_registry
        .getAllStates()
        .filter(EntityState.isDrill)
        .map(drill_state => {
            return MiningDrillArchetype.create({
                drill_state: drill_state,
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
        inserter_archetypes,
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
