import { isWindowCycleClock, type WindowCycleClock } from "./enable-control";
import { Resettable } from "./resettable";

/**
 * Registry for collecting and managing Resettable objects.
 * Provides a single source of truth for resetting all registered objects.
 */
export class ResettableRegistry {
    private readonly resettables: Resettable[] = [];

    /**
     * Register a single resettable object.
     */
    public register(resettable: Resettable): void {
        this.resettables.push(resettable);
    }

    /**
     * Reset all registered objects. `starts_clock`: the reset is the start of the clocks, which a run puts on its build
     * as its warm-up starts, rather than a later step's.
     */
    public resetAll(starts_clock: boolean = false): void {
        this.resettables.forEach(r => r.reset(starts_clock));
    }

    /** The clocks of window cycles among the registered objects */
    public clocks(): WindowCycleClock[] {
        return this.resettables.filter((it): it is Resettable & WindowCycleClock => isWindowCycleClock(it));
    }

    /** Whether none of the registered objects starts again when a later step of a run starts (`Resettable.runs_through_steps`) */
    public everyOneRunsThroughSteps(): boolean {
        return this.resettables.every(r => r.runs_through_steps === true);
    }
}
