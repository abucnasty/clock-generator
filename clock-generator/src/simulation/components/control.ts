import type { EnableControl } from "../../control-logic/enable-control";

/**
 * The Control of an entity a circuit enables: a reference to its current enable control, the clock's decider for it.
 * What a control latches stays inside the control (`enable-control.ts`). Asked once a tick, before the entity acts: a
 * latched control answers by how often it is asked, so `enabled` and `enabledIn` ask it exactly where and as often as
 * the entity's rules need an answer. What kind of control it is (a clock of the game, one that looks ahead, the order
 * of its decider) is read when it is given the control: every control keeps those in readonly fields.
 *
 * A control swap points it at another control (`use`), between runs and never in a tick: the entity keeps its Control,
 * and whatever reads the Control reads the new one (same-tick rule 12).
 */
export class Control {
    /**
     * True for a clock as the game has it: an inserter acts in every tick it enables, the first one included
     * (`EnableControl.is_game_clock`)
     */
    public is_game_clock: boolean = false;
    /** Whether it answers for ticks ahead (`EnableControl.isEnabledIn`): a control that answers from the clock alone */
    public looks_ahead: boolean = false;
    /** Where its decider stands in the order the clock's deciders are built, where that is known */
    public decider_build_order: number | undefined = undefined;

    constructor(private current: EnableControl) {
        this.use(current);
    }

    /** A control swap: from now on it asks `next`, and what kind of control it is is read from `next` */
    public use(next: EnableControl): void {
        this.current = next;
        this.is_game_clock = next.is_game_clock === true;
        this.looks_ahead = next.isEnabledIn !== undefined;
        this.decider_build_order = next.decider_build_order;
    }

    /** Whether the control enables the entity in this tick */
    public enabled(): boolean {
        return this.current.isEnabled();
    }

    /** Whether it enables the entity `ticks` from now: only for a control that looks ahead */
    public enabledIn(ticks: number): boolean {
        return this.current.isEnabledIn!(ticks);
    }
}
