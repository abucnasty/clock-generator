import { Duration, OpenRange } from "../data-types";
import { TickProvider } from "./current-tick-provider";
import { Resettable } from "./resettable";

export interface EnableControl {
    isEnabled(): boolean;
    /**
     * Whether it is enabled this many ticks from now. Only a control that answers from the clock alone has it: asking
     * such a control changes nothing, where one that latches answers differently the more often it is asked.
     */
    isEnabledIn?(ticks: number): boolean;
    /**
     * True for a clock as the game has it: the windows of an exported clock, or a fuel or by-product clock. An
     * inserter acts in every tick such a clock enables it, the first one included, as recorded in the game. On any
     * other control, which only the planning run has, an inserter wakes in the first tick and acts from the next:
     * the plan counts its ticks on that.
     */
    readonly is_game_clock?: boolean;
    /**
     * Used for debugging purposes to identify the control in logs.
     */
    toString?(): string;
}

export const AlwaysEnabledControl: EnableControl = {
    isEnabled(): boolean {
        return true;
    },
    isEnabledIn: () => true,
    toString: () => "AlwaysEnabledControl",
};

const NeverEnabledControl: EnableControl = {
    isEnabled(): boolean {
        return false;
    },
    isEnabledIn: () => false,
    toString: () => "NeverEnabledControl",
};

/**
 * The answers of a clock for the last two ticks it was asked about. An inserter asks about this tick and the next,
 * every tick, so all but one of its questions were answered the tick before.
 */
class LastTwoTicks {
    private tick_a = NaN;
    private value_a = false;
    private tick_b = NaN;
    private value_b = false;

    public get(tick: number, compute: (tick: number) => boolean): boolean {
        if (tick === this.tick_a) {
            return this.value_a;
        }
        if (tick === this.tick_b) {
            return this.value_b;
        }
        const value = compute(tick);
        this.tick_b = this.tick_a;
        this.value_b = this.value_a;
        this.tick_a = tick;
        this.value_a = value;
        return value;
    }
}

/** Position of a tick in a (possibly fractional) clock period; float error is snapped as the game's integer clock would be */
function clockPosition(tick: number, period: number): number {
    const position = tick % period;
    const nearest = Math.round(position);
    const snapped = Math.abs(position - nearest) < 1e-6 ? nearest : position;
    return snapped >= period ? 0 : snapped;
}

/**
 * The merged windows of a clock period. An ask is answered for the whole run of ticks that answer alike (a window, or
 * the gap to the next one), so the clock sleeps between boundaries instead of being worked out every tick, the way the
 * game sleeps an inserter until something wakes it. One binary search pays for the whole run; the answers match
 * ranges.some(r => r.contains(position)) ask for ask.
 */
class ClockWindows {
    private readonly starts: number[] = [];
    private readonly ends: number[] = [];
    /** Whole-tick periods map a whole tick to its remainder, which runs are counted in */
    private readonly whole_ticks: boolean;
    private run_answer = false;
    private run_start = 0;
    private run_end = 0;
    private readonly asked = new LastTwoTicks();
    private readonly answerAt = (tick: number) => this.inRange(clockPosition(tick, this.period));

    constructor(private readonly period: number, ranges: ReadonlyArray<OpenRange>) {
        const sorted = [...ranges].sort((a, b) => a.start_inclusive - b.start_inclusive);
        for (const range of sorted) {
            if (this.ends.length > 0 && range.start_inclusive <= this.ends[this.ends.length - 1]) {
                this.ends[this.ends.length - 1] = Math.max(this.ends[this.ends.length - 1], range.end_inclusive);
            } else {
                this.starts.push(range.start_inclusive);
                this.ends.push(range.end_inclusive);
            }
        }
        this.whole_ticks = Number.isInteger(period) && period > 0;
    }

    public inRange(position: number): boolean {
        const starts = this.starts;
        const ends = this.ends;
        let low = 0;
        let high = starts.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (position < starts[mid]) {
                high = mid - 1;
            } else if (position > ends[mid]) {
                low = mid + 1;
            } else {
                return true;
            }
        }
        return false;
    }

    public ask(tick: number): boolean {
        if (tick >= this.run_start && tick < this.run_end) {
            return this.run_answer;
        }
        if (!this.whole_ticks || !Number.isInteger(tick) || tick < 0) {
            // a fractional period or an odd tick: worked out as the game's integer clock would snap it
            return this.asked.get(tick, this.answerAt);
        }
        const period = this.period;
        const starts = this.starts;
        const ends = this.ends;
        const position = tick % period;
        let low = 0;
        let high = starts.length - 1;
        let next = starts.length;
        let answer = false;
        let change = Number.POSITIVE_INFINITY;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (position < starts[mid]) {
                next = mid;
                high = mid - 1;
            } else if (position > ends[mid]) {
                low = mid + 1;
            } else {
                answer = true;
                change = Math.min(ends[mid] + 1, period);
                break;
            }
        }
        if (!answer && starts.length > 0) {
            // the gap runs to the next window, through the period boundary when none is left in this period
            change = next < starts.length ? starts[next] : period + starts[0];
        }
        this.run_answer = answer;
        this.run_start = tick;
        this.run_end = tick + (change - position);
        return answer;
    }
}

class EnableControlLambda implements EnableControl {
    constructor(
        private readonly enabledFn: () => boolean
    ) { }

    public isEnabled(): boolean {
        return this.enabledFn();
    }
}

class ClockedEnableControl implements EnableControl, Resettable {

    public static create(args: {
        periodDuration: Duration,
        enabledRanges: ReadonlyArray<OpenRange>,
        tickProvider: TickProvider,
        is_game_clock?: boolean,
    }): ClockedEnableControl {
        return new ClockedEnableControl(
            args.periodDuration,
            args.enabledRanges,
            args.tickProvider,
            args.is_game_clock ?? false,
        );
    }
    private offset = 0;
    private readonly windows: ClockWindows;

    constructor(
        public readonly periodDuration: Duration,
        public readonly enabledRanges: ReadonlyArray<OpenRange>,
        public readonly tickProvider: TickProvider,
        public readonly is_game_clock: boolean = false,
    ) {
        this.windows = new ClockWindows(periodDuration.ticks, enabledRanges);
    }

    public isEnabled(): boolean {
        return this.isEnabledIn(0);
    }

    public isEnabledIn(ticks: number): boolean {
        // the tick of the clock: the tick provider's, moved by the offset of the last reset
        return this.windows.ask(this.tickProvider.getCurrentTick() + this.offset + ticks);
    }

    public getOffset(): number {
        return this.offset
    }

    public reset(): void {
        this.offset = this.tickProvider.getCurrentTick() * -1
    }
}

class PeriodicEnableControl implements EnableControl {
    private readonly windows: ClockWindows;

    constructor(
        public readonly periodDuration: Duration,
        public readonly enabledRanges: ReadonlyArray<OpenRange>,
        public readonly tickProvider: TickProvider
    ) {
        this.windows = new ClockWindows(periodDuration.ticks, enabledRanges);
    }

    public isEnabled(): boolean {
        return this.isEnabledIn(0);
    }

    public isEnabledIn(ticks: number): boolean {
        return this.windows.ask(this.tickProvider.getCurrentTick() + ticks);
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

class AllEnableControl implements EnableControl {

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

class AnyEnableControl implements EnableControl {

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
function createPeriodicEnableControl(args: {
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

function createLambdaEnableControl(enabledFn: () => boolean): EnableControl {
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