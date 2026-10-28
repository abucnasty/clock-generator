import { InserterStatus } from "../../state/entity-status";
import type { InserterState } from "../../state/inserter-state";
import type { Control } from "./control";

/**
 * An inserter's Wakes: what the game shows of it after its tick, for its game status and the next tick's readers. Written
 * at the end of the inserter's tick, after its tick observers (the phase table's shown_enabled step).
 */
export class InserterWakes {
    constructor(
        private readonly state: InserterState,
        private readonly control: Control,
    ) { }

    /** After the inserter's tick: whether the game shows it enabled */
    public endOfTick(): void {
        this.state.enabled = this.shownEnabled();
    }

    /**
     * Whether the game would show the inserter as enabled after this tick. The game shows it a tick ahead of what
     * the inserter does. Recorded on seven runs of five builds in Factorio 2.1.21: a hand never grows in the first
     * tick an inserter shows as enabled, and it does grow in the first tick it shows as disabled, never after that.
     * A window of 4 ticks shows as 4 ticks that are not disabled, and the inserter acts in the 4 ticks one later.
     * So a clock of the game is asked for the next tick.
     *
     * A clock of the plan is a tick longer than what the inserter acts in, since it wakes in the first: it is asked
     * for this tick and the next. Any other control is not asked again, since it may latch: with it the inserter
     * counts as enabled until it reaches its disabled phase.
     */
    private shownEnabled(): boolean {
        const control = this.control;
        if (control.looks_ahead && control.is_game_clock) {
            return control.enabledIn(1);
        }
        // an inserter in its disabled phase was asked this tick and stayed there (its written status: rule 12 keeps it
        // through a control swap)
        if (this.state.status === InserterStatus.DISABLED) {
            return false;
        }
        if (!control.looks_ahead) {
            return true;
        }
        return control.enabledIn(0) && control.enabledIn(1);
    }
}
