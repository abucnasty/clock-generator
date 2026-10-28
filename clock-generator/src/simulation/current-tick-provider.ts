export interface TickProvider {
    getCurrentTick(): number;
}

export class MutableTickProvider implements TickProvider {

    static create(initialTick: number = 0): MutableTickProvider {
        return new MutableTickProvider(initialTick);
    }

    private currentTick: number;

    constructor(initialTick: number = 0) {
        this.currentTick = initialTick;
    }
    
    public getCurrentTick(): number {
        return this.currentTick;
    }

    public setCurrentTick(tick: number): void {
        this.currentTick = tick;
    }

    public incrementTick(): void {
        this.currentTick += 1;
    }
}

export const TickProvider = {
    mutable: MutableTickProvider.create,
};

/**
 * Counts ticks from a start that can be moved, as an offset of -1 * start from the base does: the ticks of a recorded
 * run count from where it starts. Read every tick by every entity, so without a closure per read.
 */
export class RelativeTickProvider implements TickProvider {
    public start = 0;

    constructor(private readonly base: MutableTickProvider) { }

    public getCurrentTick(): number {
        return this.base.getCurrentTick() + -1 * this.start;
    }
}
