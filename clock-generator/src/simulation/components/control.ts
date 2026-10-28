import type { EnableControl } from "../../control-logic/enable-control";

/**
 * The Control of an entity a circuit enables: a reference to its current enable control, the clock's decider for it.
 * What a control latches stays inside the control (`enable-control.ts`). Asked once a tick, before the entity acts: a
 * latched control answers by how often it is asked, so `enabled` and `enabledIn` ask it exactly where and as often as
 * the entity's rules need an answer. What kind of control it is (a clock of the game, one that looks ahead, the order
 * of its decider) is read once at build: every control keeps those in readonly fields.
 */
export class Control {
    /**
     * True for a clock as the game has it: an inserter acts in every tick it enables, the first one included
     * (`EnableControl.is_game_clock`)
     */
    public readonly is_game_clock: boolean;
    /** Whether it answers for ticks ahead (`EnableControl.isEnabledIn`): a control that answers from the clock alone */
    public readonly looks_ahead: boolean;
    /** Where its decider stands in the order the clock's deciders are built, where that is known */
    public readonly decider_build_order: number | undefined;

    constructor(private readonly current: EnableControl) {
        this.is_game_clock = current.is_game_clock === true;
        this.looks_ahead = current.isEnabledIn !== undefined;
        this.decider_build_order = current.decider_build_order;
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
