import { EntityId } from "../../entities";
import { TickProvider } from "../current-tick-provider";
import { Mode, ModePlugin, Transition } from "../mode";

export interface FactorioStateChange {
    entity_id: EntityId;
    tick: number;
    state: string;
}

/**
 * Records the state an entity would show in Factorio, every tick it changes. It is sampled rather than taken from
 * the mode transitions because the game's state can change while the simulator's mode does not: an idle inserter
 * waits for items, then for the machine to take them, and stays idle throughout.
 */
export class FactorioStatePlugin<M extends Mode> implements ModePlugin<M> {
    private last_state: string | null = null;

    constructor(
        private readonly entity_id: EntityId,
        private readonly tick_provider: TickProvider,
        private readonly derive: () => string,
        private readonly callback: (change: FactorioStateChange) => void,
    ) {}

    onTransition(fromMode: M, transition: Transition<M>): void {}

    executeForTick(): void {
        const state = this.derive();
        if (state === this.last_state) {
            return;
        }
        this.last_state = state;
        this.callback({ entity_id: this.entity_id, tick: this.tick_provider.getCurrentTick(), state });
    }
}
