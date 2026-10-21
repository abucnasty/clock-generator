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
     * Register multiple resettable objects.
     */
    public registerAll(resettables: readonly Resettable[]): void {
        this.resettables.push(...resettables);
    }

    /**
     * Reset all registered objects. `starts_clock`: the reset is the start of the clocks, which a run puts on its build
     * as its warm-up starts, rather than a later step's.
     */
    public resetAll(starts_clock: boolean = false): void {
        this.resettables.forEach(r => r.reset(starts_clock));
    }

    /**
     * Get the count of registered resettables.
     */
    public get count(): number {
        return this.resettables.length;
    }
}
