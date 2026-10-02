import { Duration, OpenRange } from "../data-types";
import { OffsetTickProvider, TickProvider } from "./current-tick-provider";
import { Resettable } from "./resettable";

export interface EnableControl {
    isEnabled(): boolean;
    /**
     * Used for debugging purposes to identify the control in logs.
     */
    toString?(): string;
}

export const AlwaysEnabledControl: EnableControl = {
    isEnabled(): boolean {
        return true;
    },
    toString: () => "AlwaysEnabledControl"
};

const NeverEnabledControl: EnableControl = {
    isEnabled(): boolean {
        return false;
    },
    toString: () => "NeverEnabledControl"
};

/** Position of a tick in a (possibly fractional) clock period; float error is snapped as the game's integer clock would be */
function clockPosition(tick: number, period: number): number {
    const position = tick % period;
    const nearest = Math.round(position);
    const snapped = Math.abs(position - nearest) < 1e-6 ? nearest : position;
    return snapped >= period ? 0 : snapped;
}

export class EnableControlLambda implements EnableControl {
    constructor(
        private readonly enabledFn: () => boolean
    ) { }

    public isEnabled(): boolean {
        return this.enabledFn();
    }
}

export class ClockedEnableControl implements EnableControl, Resettable {

    public static create(args: {
        periodDuration: Duration,
        enabledRanges: ReadonlyArray<OpenRange>,
        tickProvider: TickProvider
    }): ClockedEnableControl {
        return new ClockedEnableControl(
            args.periodDuration,
            args.enabledRanges,
            args.tickProvider
        );
    }
    private offset = 0;
    private readonly offset_tick_provider: OffsetTickProvider;

    constructor(
        public readonly periodDuration: Duration,
        public readonly enabledRanges: ReadonlyArray<OpenRange>,
        public readonly tickProvider: TickProvider
    ) {
        this.offset_tick_provider = TickProvider.offset({
            base: tickProvider,
            offset: this.getOffset.bind(this),
        })
    }

    public isEnabled(): boolean {
        const currentTick = this.offset_tick_provider.getCurrentTick()
        const adjustedTick = clockPosition(currentTick, this.periodDuration.ticks);
        return this.enabledRanges.some(range => range.contains(adjustedTick));
    }

    public getOffset(): number {
        return this.offset
    }

    public reset(): void {
        this.offset = this.tickProvider.getCurrentTick() * -1
    }
}

class PeriodicEnableControl implements EnableControl {
    constructor(
        public readonly periodDuration: Duration,
        public readonly enabledRanges: ReadonlyArray<OpenRange>,
        public readonly tickProvider: TickProvider
    ) { }

    public isEnabled(): boolean {
        const currentTick = this.tickProvider.getCurrentTick()
        const adjustedTick = clockPosition(currentTick, this.periodDuration.ticks);
        return this.enabledRanges.some(range => range.contains(adjustedTick));
    }
}

/**
 * Latches the enabled state until another condition is met
 */
export class LatchedEnableControl implements EnableControl {

    static create(args: {
        base: EnableControl,
        release: EnableControl,
    }): LatchedEnableControl {
        return new LatchedEnableControl(
            args.base,
            args.release,
        );
    }

    constructor(
        private readonly base: EnableControl,
        private readonly release: EnableControl,
    ) { }

    private latched: boolean = false;

    public isEnabled(): boolean {
        if (this.latched && this.release.isEnabled()) {
            if (this.release.isEnabled()) {
                this.latched = false;
            }
        } else {
            if (this.base.isEnabled()) {
                this.latched = true;
            }
        }
        return this.latched;
    }
}

export class AllEnableControl implements EnableControl {

    public static create(enable_controls: ReadonlyArray<EnableControl>): EnableControl {
        if (enable_controls.length === 0) {
            return AlwaysEnabledControl;
        }
        if (enable_controls.length === 1) {
            return enable_controls[0];
        }
        return new AllEnableControl(enable_controls);
    }

    constructor(
        private readonly enableControls: ReadonlyArray<EnableControl>
    ) { }

    public isEnabled(): boolean {
        return this.enableControls.every(control => control.isEnabled());
    }
}

export class AnyEnableControl implements EnableControl {

    public static create(enable_controls: ReadonlyArray<EnableControl>): EnableControl {
        if (enable_controls.length === 0) {
            return AlwaysEnabledControl;
        }
        if (enable_controls.length === 1) {
            return enable_controls[0];
        }
        return new AnyEnableControl(enable_controls);
    }

    constructor(
        private readonly enableControls: ReadonlyArray<EnableControl>
    ) { }

    public isEnabled(): boolean {
        return this.enableControls.some(control => control.isEnabled());
    }
}

/**
 * Creates an EnableControl that enables for a specified duration within a repeating period, with an optional offset.
 */
export function createPeriodicEnableControl(args: {
    /**
     * The total period in ticks for the enable/disable cycle.
     */
    periodDuration: Duration,
    /**
     * The duration in ticks for which the control is enabled within each period.
     */
    enabledRanges: ReadonlyArray<OpenRange>,
    tickProvider: TickProvider
}): PeriodicEnableControl {
    const { periodDuration, enabledRanges, tickProvider } = args;

    return new PeriodicEnableControl(
        periodDuration,
        enabledRanges,
        tickProvider
    );
}

export function createLambdaEnableControl(enabledFn: () => boolean): EnableControl {
    return new EnableControlLambda(enabledFn);
}

export const EnableControl = {
    lambda: createLambdaEnableControl,
    periodic: createPeriodicEnableControl,
    clocked: ClockedEnableControl.create,
    all: AllEnableControl.create,
    any: AnyEnableControl.create,
    latched: LatchedEnableControl.create,
    never: NeverEnabledControl,
    always: AlwaysEnabledControl
}