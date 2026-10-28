import { TickProvider } from "../current-tick-provider";
import { Mode, ModePlugin, Transition } from "../mode";

/** Where the states of an entity are recorded (a recorder of the state transition history) */
interface FactorioStateRecorder {
    recordFactorioState(tick: number, state: string): void;
}

/**
 * Records the state an entity would show in Factorio, every tick it changes. It is sampled rather than taken from
 * the mode transitions because the game's state can change while the simulator's mode does not: an idle inserter
 * waits for items, then for the machine to take them, and stays idle throughout.
 */
export class FactorioStatePlugin<M extends Mode> implements ModePlugin<M> {
    private last_state: string | null = null;

    constructor(
        private readonly tick_provider: TickProvider,
        private readonly derive: () => string,
        private readonly recorder: FactorioStateRecorder,
    ) {}

    onTransition(fromMode: M, transition: Transition<M>): void {}

    executeForTick(): void {
        const state = this.derive();
        if (state === this.last_state) {
            return;
        }
        this.last_state = state;
        this.recorder.recordFactorioState(this.tick_provider.getCurrentTick(), state);
    }
}
