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

export class OffsetTickProvider implements TickProvider {
    static create(args: {
        base: TickProvider,
        offset: () => number,
    }): OffsetTickProvider {
        return new OffsetTickProvider(
            args.base,
            args.offset,
        );
    }
    constructor(
        private readonly base: TickProvider,
        private readonly offset: () => number,
    ) {}

    public getCurrentTick(): number {
        const offset = this.offset();
        return this.base.getCurrentTick() + offset;
    }
}

function create(tickProvider: () => number): TickProvider {
    return {
        getCurrentTick(): number {
            return tickProvider();
        }
    }
}

export const TickProvider = {
    create: create,
    mutable: MutableTickProvider.create,
    offset: OffsetTickProvider.create,
};