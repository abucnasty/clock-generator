import { EnableControl } from "../../../simulation/controls/enable-control";
import { ContainerStorage } from "../../../simulation/components/container-storage";
import { SimulationContext } from "../../sequence";
import { SimulationTick } from "../simulation-tick";

/** The most ticks the fill runs before the clock starts, where the build never stops moving (an always-on export, say) */
export const BACKPRESSURE_FILL_MAX_TICKS = 100_000;
/** Ticks between two looks at the build while it fills */
const LOOK_EVERY_TICKS = 10;
/** Looks in a row that find the build as it was: nothing moved in between, so the fill is over */
const QUIET_LOOKS = 3;

/** Fills made in this process, their ticks and those that did not end (measurement) */
export const backpressureFillTally = { fills: 0, ticks: 0, not_quiet: 0 };

/** How the fill ended: the ticks it ran, and whether the build stopped moving within BACKPRESSURE_FILL_MAX_TICKS */
export interface BackpressureFill {
    ticks: number;
    quiet: boolean;
}

/**
 * The fill of the backpressure start: the build runs with every clocked inserter and drill off (`off`: the Clock lock is
 * on) and every other one on, until nothing moves. The supplies are then full, and so are the machines that unclocked
 * inserters fill and their outputs; the machines that only clocked inserters fill stay empty. The inserters of a loop
 * are off too: a loop does not fill by itself, so it is given its kick start after the fill (`seedLoopingRecipes`).
 * Belts are what the config says they are: a moving belt stays moving. Nothing moves when the machines, chests,
 * inserters and drills are the same at QUIET_LOOKS looks LOOK_EVERY_TICKS ticks apart; a build that still moves after
 * BACKPRESSURE_FILL_MAX_TICKS starts its clock from where it is (`quiet` false).
 */
export class BackpressureFillStep {
    constructor(private readonly context: SimulationContext, private readonly off: ReadonlySet<string>) { }

    public execute(): BackpressureFill {
        const context = this.context;
        context.useControls({
            inserter: inserter_state => this.off.has(inserter_state.entity_id.id) ? EnableControl.never : EnableControl.always,
            drill: drill_state => this.off.has(drill_state.entity_id.id) ? EnableControl.never : EnableControl.always,
        });
        const tick = new SimulationTick(context);
        let ticks = 0;
        let last = this.look();
        let same = 0;
        while (ticks < BACKPRESSURE_FILL_MAX_TICKS) {
            for (let step = 0; step < LOOK_EVERY_TICKS; step++) tick.executeForTick();
            ticks += LOOK_EVERY_TICKS;
            const now = this.look();
            same = now === last ? same + 1 : 0;
            last = now;
            if (same >= QUIET_LOOKS) return { ticks, quiet: true };
        }
        return { ticks, quiet: false };
    }

    /** What the machines, chests, inserters and drills hold and do, belts apart (a moving belt moves all the time) */
    private look(): string {
        const context = this.context;
        const tick = context.tick_provider.getCurrentTick();
        return [
            ...context.state_registry.getAllStates().filter(ContainerStorage.is).map(container => container.key()),
            ...context.machines.map(machine => machine.stateKey()),
            ...context.inserters.map(inserter => inserter.stateKey(tick)),
            ...context.drills.map(drill => drill.stateKey()),
        ].join("\n");
    }
}
