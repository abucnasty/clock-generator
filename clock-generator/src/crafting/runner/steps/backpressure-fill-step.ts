import { EnableControl } from "../../../simulation/controls/enable-control";
import { ContainerStorage } from "../../../simulation/components/container-storage";
import { BeltPickupLane } from "../../../state/belt-pickup-lane";
import { EntityState } from "../../../state";
import { SimulationContext } from "../../sequence";
import { twinOf } from "../../sequence/build-copies";
import { SimulationTick } from "../simulation-tick";
import { beginTickLoop } from "../../tick-ledger";

/**
 * The fill of the backpressure start (ruling 60): the build runs with every inserter and drill that a clock will hold
 * (the Clock lock on) off and every other one on, until the part no clock controls has reached its steady state. Then
 * the clock starts, as it does on a staged scaffold in the game once its belts and unclocked inserters have settled.
 *
 * The stop is exact. Under fixed controls (always or never) the next tick is a function of the build's whole state
 * (belts, containers, machines, inserters, drills and the update list), so a state that comes again proves that the
 * build repeats from there on, whether it stands still (period 1) or goes on flowing (period P). The repeat is found by
 * Brent's cycle detection on the state at every tick: the fill keeps one state, compares it exactly with each later one,
 * and stops within about 2 max(mu, P) + P ticks. Nothing is rounded. One part of the state is left out because it
 * grows for as long as a hand waits at a full container and nothing reads it (`InserterArchetype.fillKey`).
 *
 * The fill then goes on to the tick at which the clock may start: one at which every independent moving lane
 * (`BeltPickupLane`) stands where it stands at tick 0 of the cold start, and, for a run that readers record from tick 0
 * (`aligned_to`), a whole number of window cycles. Under the repeat every later tick is in the orbit, so this takes
 * fewer than that many ticks more.
 *
 * A build whose state does not repeat within `BACKPRESSURE_FILL_MAX_TICKS` starts its clock from where it is
 * (`end: "cap"`), and the fill names the entities whose lines still change.
 */
export const BACKPRESSURE_FILL_MAX_TICKS = 100_000;

export type BackpressureFillEnd = "repeat" | "cap";

export interface BackpressureFill {
    /** Ticks the fill ran, the ticks to the start phase included */
    ticks: number;
    end: BackpressureFillEnd;
    /** The period of the repeat found (1: nothing moves); null at the cap */
    period: number | null;
    /** The ticks run after the repeat to stand at the start phase (0 at the cap) */
    phase_ticks: number;
    /** At the cap: the entities whose lines differ between the last two states Brent compared */
    changing?: string[];
}

/** One line a labelled entity, in the order of `simulationStateKey` */
function labelledKey(context: SimulationContext): [string, string][] {
    const tick = context.tick_provider.getCurrentTick();
    const states = context.state_registry.getAllStates();
    return [
        ...states.filter(EntityState.isBelt).map(belt => [belt.entity_id.id, belt.stateKey(tick)] as [string, string]),
        ...states.filter(ContainerStorage.is).map(container => [container.entity_id.id, container.key()] as [string, string]),
        ...context.machines.map(machine => [machine.machine_state.machine.entity_id.id, machine.stateKey()] as [string, string]),
        ...context.inserters.map(inserter => [inserter.entity_id.id, inserter.fillKey(tick)] as [string, string]),
        ...context.drills.map(drill => [drill.drill_state.entity_id.id, drill.stateKey()] as [string, string]),
        ["scheduling", context.inserterScheduling().key()] as [string, string],
    ];
}

const joined = (key: [string, string][]): string => key.map(([, line]) => line).join("\n");

/** The state the fill compares, as one text: for a test that reads whether a build repeats */
export function fillStateKey(context: SimulationContext): string {
    return joined(labelledKey(context));
}

function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
}

/**
 * The ticks after which every independent moving lane of the build stands in its place again: the least common multiple
 * of their `phaseTicks` (1 where no lane moves independently). The only thing in a run tied to the tick the context counts.
 */
export function lanePhaseTicks(context: SimulationContext): number {
    let ticks = 1;
    for (const { inserter_state } of context.inserters) {
        const source = context.state_registry.getStateByEntityIdOrThrow(inserter_state.inserter.source.entity_id);
        if (!EntityState.isBelt(source)) continue;
        for (const stock of source.pickupsOf(inserter_state.entity_id.id) ?? []) {
            if (stock instanceof BeltPickupLane) ticks = ticks / gcd(ticks, stock.phaseTicks()) * stock.phaseTicks();
        }
    }
    return ticks;
}

export class BackpressureFillStep {
    /**
     * `held_off`: the ids of the inserters and drills of the config that a clock holds, by the id the config gives them;
     * a later copy's inserter or drill is held off with its twin. `aligned_to`: the tick the clock starts at is a multiple
     * of this many ticks too (1: no more than the lanes need).
     */
    constructor(
        private readonly context: SimulationContext,
        private readonly held_off: ReadonlySet<string>,
        private readonly aligned_to: number = 1,
    ) { }

    public execute(): BackpressureFill {
        // the fill's ticks are the run's preparation: the tick ledger counts them to its prepare stage, as the prepare step's
        const start_tick = this.context.tick_provider.getCurrentTick();
        const ledger = beginTickLoop("prepare_step", () => this.context.tick_provider.getCurrentTick() - start_tick);
        try {
            return this.fill();
        } finally {
            ledger?.close();
        }
    }

    private fill(): BackpressureFill {
        const context = this.context;
        const held_off = this.held_off;
        context.useControls({
            inserter: state => held_off.has(twinOf(state.entity_id).id) ? EnableControl.never : EnableControl.always,
            drill: state => held_off.has(twinOf(state.entity_id).id) ? EnableControl.never : EnableControl.always,
        });
        const tick = new SimulationTick(context);
        // Brent: the tortoise stays at a power of two, the hare steps one tick at a time
        let tortoise_key = labelledKey(context);
        let tortoise = joined(tortoise_key);
        let power = 1;
        let lambda = 0;
        let ticks = 0;
        let fill: BackpressureFill | undefined;
        let hare_key = tortoise_key;
        while (ticks < BACKPRESSURE_FILL_MAX_TICKS) {
            tick.executeForTick();
            ticks++;
            lambda++;
            hare_key = labelledKey(context);
            const hare = joined(hare_key);
            if (hare === tortoise) {
                fill = { ticks, end: "repeat", period: lambda, phase_ticks: 0 };
                break;
            }
            if (lambda === power) {
                tortoise = hare;
                tortoise_key = hare_key;
                power *= 2;
                lambda = 0;
            }
        }
        if (fill === undefined) {
            const before = new Map(tortoise_key);
            const changing = hare_key.filter(([id, line]) => before.get(id) !== line).map(([id]) => id);
            return { ticks, end: "cap", period: null, phase_ticks: 0, changing };
        }
        const every = lanePhaseTicks(context) / gcd(lanePhaseTicks(context), this.aligned_to) * this.aligned_to;
        while (context.tick_provider.getCurrentTick() % every !== 0) {
            tick.executeForTick();
            fill.ticks++;
            fill.phase_ticks++;
        }
        return fill;
    }
}

/** What a run that asked for the fill did, for whoever watches (the blast writes it to a log; a test reads it) */
export interface FillReport {
    /** The window cycle of the run, in ticks */
    window_cycle_ticks: number;
    /** The inserters and drills held off, of the config's own (a later copy's are held off with its twin) */
    held_off: number;
    /** The fill, where the run made one */
    fill?: BackpressureFill;
    /** Why the run kept the cold start instead, where it did */
    kept_cold?: "nothing_clocked" | "fractional_window_cycle";
}

type FillObserver = (report: FillReport) => void;
const observers = new Set<FillObserver>();

/** Tells `observer` of every run's fill (or its cold start, with the reason) until the returned function is called */
export function observeFills(observer: FillObserver): () => void {
    observers.add(observer);
    return () => { observers.delete(observer); };
}

export function reportFill(report: FillReport): void {
    for (const observer of observers) observer(report);
}
