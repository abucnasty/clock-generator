import type { TickProvider } from "../current-tick-provider";
import type { DrillState } from "../../state/drill-state";
import { factorioDrillStateWhileEnabled } from "../../state/factorio-entity-state";
import { FactorioDrillState } from "../../state/factorio-state-names";
import { DrillStatusCode } from "../status-codes";
import type { DrillObserver, EntityObserver } from "./observer";

/** Where the states of an entity are recorded (a recorder of the state transition history) */
interface FactorioStateRecorder {
    recordFactorioState(tick: number, state: string): void;
}

/**
 * Records the state an entity would show in Factorio, every tick it changes: an observer of the tick of an inserter, a
 * machine or a drill. It is sampled rather than taken from the changes of status because the game's state can change
 * while the simulator's phase does not: an idle inserter waits for items, then for the machine to take them, and stays
 * idle throughout.
 */
export class FactorioStateTracker implements EntityObserver<number> {
    private last_state: string | null = null;

    constructor(
        private readonly tick_provider: TickProvider,
        /** The state the entity shows now, made once when the tracker is attached */
        private readonly derive: () => string,
        private readonly recorder: FactorioStateRecorder,
    ) {}

    public onTick(): void {
        const state = this.derive();
        if (state === this.last_state) {
            return;
        }
        this.last_state = state;
        this.recorder.recordFactorioState(this.tick_provider.getCurrentTick(), state);
    }
}

/**
 * Records the state a drill shows in Factorio, every tick it changes: an observer of the tick of a drill, as the
 * Factorio state tracker is, but one tick behind. The game reads a drill's status after the tick's updates, and a drill
 * switched off by its circuit shows disabled in the last tick it still mines: the state of a tick is disabled when the
 * drill's control disables it in the next tick, and else what the drill holds at the end of that tick. So a tick is
 * recorded when the next one ends, and the last tick of a run is not recorded.
 */
export class DrillStateTracker implements DrillObserver {
    private last_state: string | null = null;
    /** The tick before this one and the state it shows unless the drill is disabled in this one */
    private previous_tick = -1;
    private previous_enabled_state: string | null = null;

    constructor(
        private readonly tick_provider: TickProvider,
        private readonly drill_state: DrillState,
        private readonly recorder: FactorioStateRecorder,
    ) {}

    public onTick(): void {
        if (this.previous_enabled_state !== null) {
            const state = this.drill_state.status_code === DrillStatusCode.DISABLED_BY_CONTROL_BEHAVIOR
                ? FactorioDrillState.DISABLED_BY_CONTROL_BEHAVIOR
                : this.previous_enabled_state;
            if (state !== this.last_state) {
                this.last_state = state;
                this.recorder.recordFactorioState(this.previous_tick, state);
            }
        }
        this.previous_tick = this.tick_provider.getCurrentTick();
        this.previous_enabled_state = factorioDrillStateWhileEnabled(this.drill_state);
    }
}
