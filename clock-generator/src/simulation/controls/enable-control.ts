import { Duration, OpenRange } from "../../data-types";
import { TickProvider } from "../current-tick-provider";
import { subtickClockForWindowCycle, wholeBounds } from "../../common/subtick-window-cycle";
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
     * Where the decider that enables the inserter stands in the order the clock's deciders are built, 0 the first, on
     * a clock of the game that the check of an exported clock runs (`deciderBuildOrder`). Of two inserters whose
     * windows open in the same tick the game updates the one whose decider was built last first. Unset where the
     * order is not known.
     */
    readonly decider_build_order?: number;
    /**
     * Used for debugging purposes to identify the control in logs.
     */
    toString?(): string;
}

/** A clock of a window cycle, as a run holds it: where it stands in its count */
export interface WindowCycleClock {
    readonly windowCycleDuration: Duration;
    readonly is_game_clock: boolean;
    /** Ticks since the clock's start, in the tick of the run now: its position in the window cycle is this modulo the window cycle */
    clockTick(): number;
}

/** Whether a control (or anything a ResettableRegistry holds) is a clock of a window cycle */
export function isWindowCycleClock(it: unknown): it is WindowCycleClock {
    return it instanceof ClockedEnableControl;
}

/**
 * What a proof that a run repeats needs of a clock: its window cycle, the ticks after its start that stay dark (`reset`),
 * and whether a p/q-tick window cycle answers in whole 1/q ticks, which repeat every p ticks (floats drift). Null for a
 * control that is not a clock.
 */
export function clockRepeatFacts(it: unknown): { window_cycle_ticks: number; start_latency_ticks: number; exact_subtick_positions: boolean } | null {
    return it instanceof ClockedEnableControl
        ? { window_cycle_ticks: it.windowCycleDuration.ticks, start_latency_ticks: it.start_latency_ticks, exact_subtick_positions: it.exact_subtick_positions }
        : null;
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

/** Position of a tick in a (possibly fractional) window cycle; float error is snapped as the game's integer clock would be */
export function clockPosition(tick: number, window_cycle_ticks: number): number {
    const position = tick % window_cycle_ticks;
    const nearest = Math.round(position);
    const snapped = Math.abs(position - nearest) < 1e-6 ? nearest : position;
    return snapped >= window_cycle_ticks ? 0 : snapped;
}

/**
 * The windows of a clock whose window cycle is p/q ticks (`subtickClockForWindowCycle`), in whole 1/q ticks: the position of
 * tick t is (t * q) mod p, an integer, and every window is the whole values inside it (`wholeBounds`), which is what
 * the deciders of the exported subtick clock are open for. Worked out in floats (`clockPosition`), a window one tick
 * long at a fractional position after the circuit latency's wrap (640/3 ticks: [212, 212] moved to [2/3, 2/3]) is met
 * in the first window cycle and missed from the second on, as t % window cycle drifts away from the window's bound.
 */
class SubtickPositions {
    private readonly starts: number[] = [];
    private readonly ends: number[] = [];

    constructor(private readonly window_cycle_ticks: number, private readonly scale: number, starts: readonly number[], ends: readonly number[]) {
        for (let i = 0; i < starts.length; i++) {
            const bounds = wholeBounds(starts[i] * scale, ends[i] * scale);
            if (bounds === null) {
                continue;
            }
            // inward rounding keeps the merged windows apart and in order; two that now touch answer as one
            this.starts.push(bounds[0]);
            this.ends.push(bounds[1]);
        }
    }

    /** Whether a whole tick from 0 on is in a window */
    public ask(tick: number): boolean {
        const position = (tick * this.scale) % this.window_cycle_ticks;
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
}

/**
 * The merged windows of a window cycle. An ask is answered for the whole run of ticks that answer alike (a window, or
 * the gap to the next one), so the clock sleeps between boundaries instead of being worked out every tick, the way the
 * game sleeps an inserter until something wakes it. One binary search pays for the whole run; the answers match
 * ranges.some(r => r.contains(position)) ask for ask.
 */
class ClockWindows {
    private readonly starts: number[] = [];
    private readonly ends: number[] = [];
    /** Whole-tick window cycles map a whole tick to its remainder, which runs are counted in */
    private readonly whole_ticks: boolean;
    private run_answer = false;
    private run_start = 0;
    private run_end = 0;
    private readonly asked = new LastTwoTicks();
    private readonly answerAt = (tick: number) => this.inRange(clockPosition(tick, this.window_cycle_ticks));
    /** A p/q-tick window cycle's windows in whole 1/q ticks, when the clock answers exactly; null to work in floats */
    private readonly subtick: SubtickPositions | null = null;

    constructor(private readonly window_cycle_ticks: number, ranges: ReadonlyArray<OpenRange>, exact_subtick_positions: boolean = false) {
        const sorted = [...ranges].sort((a, b) => a.start_inclusive - b.start_inclusive);
        for (const range of sorted) {
            if (this.ends.length > 0 && range.start_inclusive <= this.ends[this.ends.length - 1]) {
                this.ends[this.ends.length - 1] = Math.max(this.ends[this.ends.length - 1], range.end_inclusive);
            } else {
                this.starts.push(range.start_inclusive);
                this.ends.push(range.end_inclusive);
            }
        }
        this.whole_ticks = Number.isInteger(window_cycle_ticks) && window_cycle_ticks > 0;
        const subtick = exact_subtick_positions ? subtickClockForWindowCycle(window_cycle_ticks) : null;
        if (subtick !== null) {
            this.subtick = new SubtickPositions(subtick.window_cycle_ticks, subtick.scale, this.starts, this.ends);
        }
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
        if (this.subtick !== null && Number.isInteger(tick) && tick >= 0) {
            return this.subtick.ask(tick);
        }
        if (!this.whole_ticks || !Number.isInteger(tick) || tick < 0) {
            // a fractional window cycle or an odd tick: worked out as the game's integer clock would snap it
            return this.asked.get(tick, this.answerAt);
        }
        const window_cycle_ticks = this.window_cycle_ticks;
        const starts = this.starts;
        const ends = this.ends;
        const position = tick % window_cycle_ticks;
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
                change = Math.min(ends[mid] + 1, window_cycle_ticks);
                break;
            }
        }
        if (!answer && starts.length > 0) {
            // the gap runs to the next window, through the window cycle boundary when none is left in this window cycle
            change = next < starts.length ? starts[next] : window_cycle_ticks + starts[0];
        }
        this.run_answer = answer;
        this.run_start = tick;
        this.run_end = tick + (change - position);
        return answer;
    }
}

/**
 * What a control made of a function holds for a proof that a run repeats (`controlRepeatOf`). It reads entity states the
 * simulation's key holds and constants of the build, and besides them only what it states here:
 * - `key`: what it keeps of its own between asks that its later answers read; it keeps nothing when unset.
 * - `period_ticks`: the ticks its answers repeat in, when it reads the tick; it reads no tick when unset.
 * - `skip`: told that the warm-up left out this many ticks, a whole number of repeats, at its stop: it moves what it
 *   counts in ticks of the run as though they had run, so it stands where the full warm-up would have left it.
 * A control made of a function without it keeps what no key holds.
 */
export interface LambdaRepeat {
    key?: () => string;
    period_ticks?: number;
    skip?: (ticks: number) => void;
}

/** A function control that reads only entity states the key holds and constants: it keeps nothing and reads no tick */
export const READS_KEYED_STATE: LambdaRepeat = Object.freeze({});

class EnableControlLambda implements EnableControl {
    constructor(
        private readonly enabledFn: () => boolean,
        public readonly repeat?: LambdaRepeat,
    ) { }

    public isEnabled(): boolean {
        return this.enabledFn();
    }
}

class ClockedEnableControl implements EnableControl, Resettable, WindowCycleClock {

    public static create(args: {
        windowCycleDuration: Duration,
        enabledRanges: ReadonlyArray<OpenRange>,
        tickProvider: TickProvider,
        is_game_clock?: boolean,
        decider_build_order?: number,
        /** Ticks of circuit latency the ranges were moved by, which the clock's start leaves dark (see `reset`) */
        start_latency_ticks?: number,
        /** A clock of the game that keeps its count when a later step of the run starts (see `reset`) */
        runs_through_steps?: boolean,
        /** Whether a p/q-tick window cycle answers in whole 1/q ticks (`SubtickPositions`, the default) or works in floats */
        exact_subtick_positions?: boolean,
    }): ClockedEnableControl {
        return new ClockedEnableControl(
            args.windowCycleDuration,
            args.enabledRanges,
            args.tickProvider,
            args.is_game_clock ?? false,
            args.decider_build_order,
            args.start_latency_ticks ?? 0,
            args.runs_through_steps ?? false,
            args.exact_subtick_positions ?? true,
        );
    }
    private offset = 0;
    /** The ticks of the clock from its start that no window reaches yet: from 0 up to this one */
    private dark_until = 0;
    private readonly windows: ClockWindows;

    constructor(
        public readonly windowCycleDuration: Duration,
        public readonly enabledRanges: ReadonlyArray<OpenRange>,
        public readonly tickProvider: TickProvider,
        public readonly is_game_clock: boolean = false,
        public readonly decider_build_order?: number,
        public readonly start_latency_ticks: number = 0,
        public readonly runs_through_steps: boolean = false,
        public readonly exact_subtick_positions: boolean = true,
    ) {
        this.windows = new ClockWindows(windowCycleDuration.ticks, enabledRanges, exact_subtick_positions);
    }

    public isEnabled(): boolean {
        return this.isEnabledIn(0);
    }

    public clockTick(): number {
        return this.tickProvider.getCurrentTick() + this.offset;
    }

    public isEnabledIn(ticks: number): boolean {
        // the tick of the clock: the tick provider's, moved by the offset of the last reset
        const tick = this.tickProvider.getCurrentTick() + this.offset + ticks;
        if (tick < this.dark_until && tick >= 0) {
            return false;
        }
        return this.windows.ask(tick);
    }

    /**
     * Starts the clock's count again from this tick. A clock of the game that runs through the steps of a run
     * (`runs_through_steps`) keeps its count when a later step starts, as nothing restarts it in
     * the game; every other clock, the planning schedules included, starts again with that step. Where the reset puts
     * the clock on the build (`starts_clock`), its first `start_latency_ticks` stay dark: a clock of the game counts from
     * 1 at its start and a window decider is open for the values of its window only, so no window from before the start
     * has reached an inserter in the ticks the latency takes, the part of a window that the latency carries over the end
     * of the window cycle included (recorded in Factorio 2.1.21: docs/simulator.md, "Starting on supplied belts"). The reset
     * that starts a later step of a run leaves nothing dark, since the clock has run all along.
     */
    public reset(starts_clock: boolean = false): void {
        if (this.runs_through_steps && !starts_clock) return;
        this.offset = this.tickProvider.getCurrentTick() * -1;
        this.dark_until = starts_clock ? this.start_latency_ticks : 0;
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
        public readonly base: EnableControl,
        public readonly release: EnableControl,
    ) { }

    /** Whether it is latched on: kept between asks, so a proof of a repeat keys it (`controlRepeatOf`) */
    public latched: boolean = false;

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
        public readonly enableControls: ReadonlyArray<EnableControl>
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
        public readonly enableControls: ReadonlyArray<EnableControl>
    ) { }

    public isEnabled(): boolean {
        return this.enableControls.some(control => control.isEnabled());
    }
}

function createLambdaEnableControl(enabledFn: () => boolean, repeat?: LambdaRepeat): EnableControl {
    return new EnableControlLambda(enabledFn, repeat);
}

/** What a proof that a run repeats needs of a clock (`clockRepeatFacts`) */
export type ClockRepeatFacts = NonNullable<ReturnType<typeof clockRepeatFacts>>;

/**
 * What a proof that a run repeats needs of a control and of every control inside it (all, any, latched):
 * - `clocks`: the clocks inside it;
 * - `period_ticks`: the ticks the functions inside it that read the tick repeat in;
 * - `key`: what it keeps between asks that its later answers read: each latch's bit and each function's own count
 *   (`LambdaRepeat`), in a fixed order; a control asked less often than another keeps its state as it stands;
 * - `skip`: moves what the functions inside it count in ticks, where the warm-up left out a whole number of repeats.
 * Null where something inside keeps what no key holds: a function control made without its `LambdaRepeat`.
 */
export interface ControlRepeat {
    clocks: ClockRepeatFacts[];
    period_ticks: number[];
    key: () => string;
    skip: (ticks: number) => void;
}

export function controlRepeatOf(control: EnableControl): ControlRepeat | null {
    const clocks: ClockRepeatFacts[] = [];
    const period_ticks: number[] = [];
    const keys: (() => string)[] = [];
    const skips: ((ticks: number) => void)[] = [];
    const walk = (it: EnableControl): boolean => {
        if (it === AlwaysEnabledControl || it === NeverEnabledControl) {
            return true;
        }
        const clock = clockRepeatFacts(it);
        if (clock !== null) {
            clocks.push(clock);
            return true;
        }
        if (it instanceof EnableControlLambda) {
            if (it.repeat === undefined) {
                return false;
            }
            if (it.repeat.key !== undefined) keys.push(it.repeat.key);
            if (it.repeat.period_ticks !== undefined) period_ticks.push(it.repeat.period_ticks);
            if (it.repeat.skip !== undefined) skips.push(it.repeat.skip);
            return true;
        }
        if (it instanceof LatchedEnableControl) {
            keys.push(() => it.latched ? "1" : "0");
            return walk(it.base) && walk(it.release);
        }
        if (it instanceof AllEnableControl || it instanceof AnyEnableControl) {
            return it.enableControls.every(walk);
        }
        return false;
    };
    if (!walk(control)) {
        return null;
    }
    return {
        clocks,
        period_ticks,
        key: () => keys.map(key => key()).join(","),
        skip: ticks => skips.forEach(skip => skip(ticks)),
    };
}

export const EnableControl = {
    lambda: createLambdaEnableControl,
    clocked: ClockedEnableControl.create,
    all: AllEnableControl.create,
    any: AnyEnableControl.create,
    latched: LatchedEnableControl.create,
    never: NeverEnabledControl,
    always: AlwaysEnabledControl
}
