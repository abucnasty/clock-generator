import type { EnableControl } from "../../control-logic/enable-control";

/**
 * The Control of an entity a circuit enables: a reference to its current enable control, the clock's decider for it.
 * What a control latches stays inside the control (`enable-control.ts`). Asked once a tick, before the entity acts: a
 * latched control answers by how often it is asked.
 */
export class Control {
    constructor(private readonly current: EnableControl) { }

    /** Whether the control enables the entity in this tick */
    public enabled(): boolean {
        return this.current.isEnabled();
    }
}
