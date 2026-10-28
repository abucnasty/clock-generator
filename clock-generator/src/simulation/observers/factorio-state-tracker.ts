import type { TickProvider } from "../current-tick-provider";
import type { EntityObserver } from "./observer";

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
