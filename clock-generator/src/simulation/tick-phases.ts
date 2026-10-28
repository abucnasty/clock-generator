import { CraftingMachineArchetype } from "./archetypes/crafting-machine";
import { InserterArchetype } from "./archetypes/inserter";
import { MiningDrillArchetype } from "./archetypes/mining-drill";
import { World } from "./world";

/**
 * The rules of one tick that hold only because of the order its steps run in. The phase table names the rules each
 * step and each order of entities upholds; a new step names its slot in the table and the rules it reads or writes.
 */
export const SAME_TICK_RULES = {
    1: "Inserters read a machine as its last tick left it: the machine's end of tick writes its flags, the inserters read them in the next tick",
    2: "A machine blocked after its last tick and not now had its products taken in this tick: takers run before feeders",
    3: "Takers set windowOpeningTakeDecider in their pickup, the machine clears it at its end of tick, feeders compare build orders in their rule",
    4: "The takers of one machine are served in one order every tick, the first up to its hand",
    5: "A machine's crafts reach its result target in the same tick: it places again after its crafts",
    6: "Machines run in config order, so a direct placement from one machine into another depends on it within a tick",
    7: "A drill drops before it mines; what it mines waits for the next tick",
    8: "A swing back that ends asks the idle rule in the same tick, so a hand can start its pickup at once",
    9: "On a game clock a disabled inserter acts in its first enabled tick",
    10: "The pickup phase's enter step reads waits_for_sink before it clears it",
    11: "A machine or chest pickup that finds nothing sets the status to IDLE itself, with no event; the Hand's phase stays PICKUP",
    12: "A control swap starts every inserter at IDLE with fresh scratch and a drill WORKING with fresh bars; status, hand, pickup arm and lanes are kept",
    13: "A machine's status rule asks out of fuel first, then whether a craft can go on, then output full",
    14: "A full productivity bar pays at the start of the next tick or after a finished craft, never on the tick it fills",
    15: "A burner keeps 1/15 of a tick of energy when it stops",
    16: "One belt stack per hand per tick",
    17: "A transition notifies observers before the exit and enter steps",
} as const;

export type SameTickRule = keyof typeof SAME_TICK_RULES;

/**
 * Same-tick rules that no step of a tick upholds: a control swap (`SimulationContext.useControls`) sets each inserter's
 * Hand and each drill's status and bars back in place (the archetypes' `useControl`), between runs and never in a tick
 */
export const RULES_OUTSIDE_THE_TICK: readonly SameTickRule[] = [12];

export const TickPhase = { TICK: 0, DRILLS: 1, INSERTERS: 2, MACHINES: 3, AFTER_TICK: 4 } as const;
export type TickPhase = typeof TickPhase[keyof typeof TickPhase];

export const TickStep = { INCREMENT: 0 } as const;
export const DrillStep = { CONTROL_RULE: 0, MINING: 1, TICK_OBSERVERS: 2 } as const;
export const InserterStep = { PHASE_RULE: 0, PHASE_STEP: 1, TICK_OBSERVERS: 2, SHOWN_ENABLED: 3 } as const;
export const MachineStep = { PLACE_BEFORE: 0, HELD_TO_OUTPUT: 1, STATUS_RULE: 2, STATUS_STEP: 3, PLACE_AFTER: 4, END_OF_TICK: 5 } as const;
export const AfterTickStep = { RECORDERS: 0, STOP_EARLY: 1 } as const;

/**
 * The points of a tick at which observers are told (simulation/observers/observer.ts), each named in the table by the
 * one step of each archetype that tells it (`tells`): a change of status (`EntityObserver.onStatusChange`: a drill's
 * control rule, an inserter's phase rule, a machine's status rule), the entity's tick (`EntityObserver.onTick`: the
 * tick observers of a drill and an inserter, a machine's end of tick after its Wakes), and the recorders after the
 * tick (`TickRecorder.record`). No other step tells an observer anything.
 */
export const ObserverEvent = { STATUS_CHANGE: "status_change", TICK: "tick", RECORD: "record" } as const;
export type ObserverEvent = typeof ObserverEvent[keyof typeof ObserverEvent];

export interface TickStepRow {
    /** The step's code in its phase: its place in the row */
    readonly step: number;
    readonly name: string;
    readonly does: string;
    readonly upholds: readonly SameTickRule[];
    /** The observer event the step tells, null for none */
    readonly tells: ObserverEvent | null;
}

export interface TickPhaseRow {
    readonly phase: TickPhase;
    readonly name: string;
    /** The World's array the phase runs, every entity through every step before the next entity; null for none */
    readonly entities: "drills" | "inserters" | "machines" | null;
    readonly order: string;
    /** The rules the order of the entities upholds */
    readonly order_upholds: readonly SameTickRule[];
    /** "caller": the code that runs ticks runs the phase after each one (SimulateStep); "loop": `runTick` */
    readonly run_by: "loop" | "caller";
    readonly steps: readonly TickStepRow[];
}

/**
 * The order of a tick: the phases in order, each with its entities in order, each entity through its steps in order.
 * `runTick` follows it by hand; the trace test (tick-phases.test.ts) checks a run against it, and its own copy of it,
 * and that a run tells its observers only inside the steps that name their event (`tells`).
 */
export const TICK_PHASES: readonly TickPhaseRow[] = [
    {
        phase: TickPhase.TICK, name: "tick", entities: null, order: "-", order_upholds: [], run_by: "loop",
        steps: [{ step: TickStep.INCREMENT, name: "increment", does: "tick + 1", upholds: [], tells: null }],
    },
    {
        phase: TickPhase.DRILLS, name: "drills", entities: "drills", order: "state registry order (config order)",
        order_upholds: [], run_by: "loop",
        steps: [
            { step: DrillStep.CONTROL_RULE, name: "control_rule", does: "the control asked: working or disabled; on a change, observers, then the status written",
                upholds: [17], tells: ObserverEvent.STATUS_CHANGE },
            { step: DrillStep.MINING, name: "mining", does: "working: drop what the drill holds, and only when nothing is left mine", upholds: [7], tells: null },
            { step: DrillStep.TICK_OBSERVERS, name: "tick_observers", does: "tick observers in the order added", upholds: [], tells: ObserverEvent.TICK },
        ],
    },
    {
        phase: TickPhase.INSERTERS, name: "inserters", entities: "inserters",
        order: "takers before feeders, the takers of one machine in the taker order (inserterUpdateOrder)",
        order_upholds: [2, 3, 4], run_by: "loop",
        steps: [
            { step: InserterStep.PHASE_RULE, name: "phase_rule", does: "the Hand's phase rule; on a change, the status written, then observers, then exit and enter",
                upholds: [1, 3, 8, 9, 10, 17], tells: ObserverEvent.STATUS_CHANGE },
            { step: InserterStep.PHASE_STEP, name: "phase_step", does: "the Hand's phase step: pickup through the source's pickup port, drop through the sink's drop port (the hand's ports, bound at build)",
                upholds: [3, 11, 16], tells: null },
            { step: InserterStep.TICK_OBSERVERS, name: "tick_observers", does: "tick observers in the order added", upholds: [], tells: ObserverEvent.TICK },
            { step: InserterStep.SHOWN_ENABLED, name: "shown_enabled", does: "the inserter's Wakes: whether the game shows it enabled after the tick", upholds: [], tells: null },
        ],
    },
    {
        phase: TickPhase.MACHINES, name: "machines", entities: "machines", order: "config order",
        order_upholds: [6], run_by: "loop",
        steps: [
            { step: MachineStep.PLACE_BEFORE, name: "place_before", does: "what waits in the output into the result target", upholds: [5], tells: null },
            { step: MachineStep.HELD_TO_OUTPUT, name: "held_to_output", does: "held products into the output where there is room", upholds: [14], tells: null },
            { step: MachineStep.STATUS_RULE, name: "status_rule", does: "the status rule; on a change, the status written, then observers (a machine has no exit or enter steps)",
                upholds: [13, 17], tells: ObserverEvent.STATUS_CHANGE },
            { step: MachineStep.STATUS_STEP, name: "status_step", does: "working: energy share, payouts, craft loop, energy spent", upholds: [14, 15], tells: null },
            { step: MachineStep.PLACE_AFTER, name: "place_after", does: "what the tick's crafts gave into the result target", upholds: [5, 6], tells: null },
            { step: MachineStep.END_OF_TICK, name: "end_of_tick", does: "the Wakes: the wake flags and the decider cleared, then tick observers in the order added",
                upholds: [1, 3], tells: ObserverEvent.TICK },
        ],
    },
    {
        phase: TickPhase.AFTER_TICK, name: "after_tick", entities: null, order: "-", order_upholds: [], run_by: "caller",
        steps: [
            { step: AfterTickStep.RECORDERS, name: "recorders", does: "the recorders in the order given: fuel, stock and timeline (SimulateStep's recorders)",
                upholds: [], tells: ObserverEvent.RECORD },
            { step: AfterTickStep.STOP_EARLY, name: "stop_early", does: "the stop-early test (SimulateStep's stop_early)", upholds: [], tells: null },
        ],
    },
];

/** Told of each step as it runs, for a test of the order; the entity is its place in the World's array, -1 for none */
export interface TickTracer {
    step(phase: TickPhase, entity: number, step: number): void;
}

export const NO_ENTITY = -1;

/**
 * Phases 0 to 3 of one tick, in the order of TICK_PHASES. A phase for each archetype in a function of its own, so that
 * each loop calls into one class. Without a tracer a step costs a test of a local against null.
 */
export function runTick(world: World, tracer: TickTracer | null): void {
    world.tick_provider.incrementTick();
    if (tracer !== null) tracer.step(TickPhase.TICK, NO_ENTITY, TickStep.INCREMENT);
    runDrills(world.drills, tracer);
    runInserters(world.inserters, tracer);
    runMachines(world.machines, tracer);
}

function runDrills(drills: readonly MiningDrillArchetype[], tracer: TickTracer | null): void {
    for (let index = 0; index < drills.length; index++) {
        const drill = drills[index];
        if (tracer !== null) tracer.step(TickPhase.DRILLS, index, DrillStep.CONTROL_RULE);
        drill.controlRule();
        if (tracer !== null) tracer.step(TickPhase.DRILLS, index, DrillStep.MINING);
        drill.miningStep();
        if (tracer !== null) tracer.step(TickPhase.DRILLS, index, DrillStep.TICK_OBSERVERS);
        drill.tickObservers();
    }
}

function runInserters(inserters: readonly InserterArchetype[], tracer: TickTracer | null): void {
    for (let index = 0; index < inserters.length; index++) {
        const inserter = inserters[index];
        if (tracer !== null) tracer.step(TickPhase.INSERTERS, index, InserterStep.PHASE_RULE);
        inserter.phaseRule();
        if (tracer !== null) tracer.step(TickPhase.INSERTERS, index, InserterStep.PHASE_STEP);
        inserter.phaseStep();
        if (tracer !== null) tracer.step(TickPhase.INSERTERS, index, InserterStep.TICK_OBSERVERS);
        inserter.tickObservers();
        if (tracer !== null) tracer.step(TickPhase.INSERTERS, index, InserterStep.SHOWN_ENABLED);
        inserter.endOfTick();
    }
}

function runMachines(machines: readonly CraftingMachineArchetype[], tracer: TickTracer | null): void {
    for (let index = 0; index < machines.length; index++) {
        const machine = machines[index];
        if (tracer !== null) tracer.step(TickPhase.MACHINES, index, MachineStep.PLACE_BEFORE);
        machine.placeResults();
        if (tracer !== null) tracer.step(TickPhase.MACHINES, index, MachineStep.HELD_TO_OUTPUT);
        machine.putHeldProductsInOutput();
        if (tracer !== null) tracer.step(TickPhase.MACHINES, index, MachineStep.STATUS_RULE);
        machine.statusRule();
        if (tracer !== null) tracer.step(TickPhase.MACHINES, index, MachineStep.STATUS_STEP);
        machine.statusStep();
        if (tracer !== null) tracer.step(TickPhase.MACHINES, index, MachineStep.PLACE_AFTER);
        machine.placeResults();
        if (tracer !== null) tracer.step(TickPhase.MACHINES, index, MachineStep.END_OF_TICK);
        machine.endOfTick();
    }
}
