import { DEFAULT_TAKER_ORDER, TakerOrder } from "../control-logic/inserter/competing-takers";

/**
 * Whether a clock reaches its target from every sampled cold phase/order start, or only from some
 * (docs/stability.md, "How a clock is started"). The generator tries every clock from the cold start of the staged
 * scaffold alone; with `overrides.check_start_dependence` it tries each from the starts below too.
 */

/** Positions of the clock at the first tick, for the cold starts that are tried besides the plain one (0) */
export const COLD_START_SHIFTS: readonly number[] = [0, 30, 300, 700, 1000];

/** The seeds of the random orders tried: one start for each, with the same permutations in every run of the generator */
export const RANDOM_ORDER_SEEDS: readonly number[] = [1, 2];

/** One start a clock is tried from: where the clock stands at the first tick, and in what order competing inserters are served */
export interface ClockStart {
    /** Short name: "cold", "cold+300", "ascending", "random-1" */
    id: string;
    /** In words, for the line that names it */
    label: string;
    /** Ticks into its period the clock stands at the first tick, 0 for the plain cold start */
    clock_shift: number;
    /** In what order inserters that compete for one machine's product are updated where the turn rule cannot decide */
    competing_takers_order: TakerOrder;
}

/**
 * The cold start of the staged scaffold (machines, buffers and hands empty, the clock from tick 0) with the clock
 * standing 0, 30, 300, 700 and 1000 ticks into its period, and the cold start with the competing inserters served in
 * the order of ascending config ids and in two random orders. The first is the one every clock is judged on.
 */
export const CLOCK_STARTS: readonly ClockStart[] = [
    ...COLD_START_SHIFTS.map(shift => ({
        id: shift === 0 ? "cold" : `cold+${shift}`,
        label: shift === 0 ? "the cold start" : `the cold start with the clock ${shift} ticks into its period`,
        clock_shift: shift,
        competing_takers_order: DEFAULT_TAKER_ORDER,
    })),
    { id: "ascending", label: "the cold start with the competing inserters served in ascending order", clock_shift: 0, competing_takers_order: "ascending" as const },
    ...RANDOM_ORDER_SEEDS.map(seed => ({
        id: `random-${seed}`,
        label: `the cold start with the competing inserters served in a random order (draw ${seed})`,
        clock_shift: 0,
        competing_takers_order: { seed },
    })),
];

/** What a clock does from one start */
export interface StartOutcome {
    id: string;
    label: string;
    /** The clock holds its expected output from this start, judged on the same checks as from every other start (see `startsReachingTarget`) */
    reaches_target: boolean;
    /** Items a clock period moves from this start once it has settled, averaged over the judged part of a long run; null when none was run */
    output_items_per_period: number | null;
    /** Items the settled clock moves in each period of the judged part, repeating (see `cycleOf`); null when it repeats in no short cycle */
    cycle: number[] | null;
    /** Periods (bins) of the judged part more than a hand off the expected output, and how many were judged; null when no long run was made */
    off_bins: { count: number; of: number } | null;
    /** Items the judged part moved over (+) or under (-) what it expects in all its periods, which has to be within a hand; null when no long run was made */
    span_items: number | null;
    /** The long run alone keeps up; the cold start can fail the other checks of the generator (the one-period check, the start phases) and still do */
    long_run_keeps_up: boolean | null;
}

/**
 * Stable when the clock reaches its target from every start, start-dependent when it does from some and not from
 * others, unstable when it does from none. A clock that fails the same checks from every start is unstable, not
 * start-dependent.
 */
export type StartVerdict = "stable" | "start-dependent" | "unstable";

/**
 * Which starts reach the target, every start judged on the same checks. `cold_holds` is the verdict of the generator on
 * the cold start (all its checks); `ran[i]` is whether the run from start i, the cold start first, keeps up, which is
 * the one check the shifted starts are given. A cold start that fails although its own run keeps up fails on a check
 * that is not about the start (the one-period check, the start phases) and every start fails it: no start is
 * different, so the clock is not start-dependent. Otherwise the cold start is judged on all checks and the others on
 * their run, as the cold start's failure then is a run that does not keep up.
 */
export function startsReachingTarget(cold_holds: boolean, ran: readonly boolean[]): boolean[] {
    const fails_elsewhere = !cold_holds && ran[0];
    return ran.map((keeps_up, index) => !fails_elsewhere && (index === 0 ? cold_holds : keeps_up));
}

export function startVerdictOf(starts: readonly Pick<StartOutcome, "reaches_target">[]): StartVerdict {
    if (starts.every(it => it.reaches_target)) {
        return "stable";
    }
    return starts.some(it => it.reaches_target) ? "start-dependent" : "unstable";
}

/** What the trial of a clock from several starts found */
export interface StartDependence {
    verdict: StartVerdict;
    /** One outcome for each actually evaluated start of CLOCK_STARTS, in its order (fractional periods omit shifts) */
    starts: StartOutcome[];
    /** What the clock has to move in a period to reach its target */
    expected_output_items: number;
}

/**
 * The shortest cycle the values repeat in over their last half, which is what the settled run does; null when they
 * repeat in none up to a quarter of them. A flat run is a cycle of one.
 */
export function cycleOf(values: readonly number[]): number[] | null {
    const settled = values.slice(Math.floor(values.length / 2));
    for (let length = 1; length <= Math.floor(settled.length / 2); length++) {
        if (settled.every((value, index) => index < length || value === settled[index - length])) {
            return settled.slice(settled.length - length);
        }
    }
    return null;
}

const SAMPLE_CYCLE_ITEMS = 6;

/** "2688/2640/2736", the cycle in the order it repeats */
function cycleText(cycle: readonly number[]): string {
    return cycle.slice(0, SAMPLE_CYCLE_ITEMS).join("/") + (cycle.length > SAMPLE_CYCLE_ITEMS ? "/..." : "");
}

/**
 * The line that says where a start-dependent clock reaches its target and where it settles elsewhere, in a second of
 * all copies for the rate: "start-dependent: reaches 480/s from the cold start; settles at 2880 a period (128.6/s,
 * cycle 2784/2944/2912) from the ascending order". Null for a clock that is not start-dependent.
 */
export function startDependenceNote(dependence: StartDependence, items_per_second_of: (items_per_period: number) => number): string | null {
    if (dependence.verdict !== "start-dependent") {
        return null;
    }
    const reaching = dependence.starts.filter(it => it.reaches_target);
    const elsewhere = dependence.starts.filter(it => !it.reaches_target);
    const names = (starts: StartOutcome[]) => starts.map(it => it.id).join(", ");
    const settles = elsewhere.map(start => {
        if (start.output_items_per_period === null) {
            return `has no long run from ${start.id}`;
        }
        const mean = Math.round(start.output_items_per_period);
        const cycle = start.cycle !== null && start.cycle.length > 1 ? `, cycle ${cycleText(start.cycle)}` : "";
        const off = start.off_bins !== null && start.off_bins.count > 0 ? `, ${start.off_bins.count} of ${start.off_bins.of} periods more than a hand off it` : "";
        // a mean at the target and no period far off it: the judged part as a whole is a few hands short or over
        const span = off === "" && start.span_items !== null && start.span_items !== 0 && !start.long_run_keeps_up
            ? `, ${Math.abs(start.span_items)} items ${start.span_items < 0 ? "under" : "over"} the judged periods as a whole` : "";
        return `settles at ${mean} a period (${items_per_second_of(start.output_items_per_period).toFixed(1)}/s${cycle}${off}${span}) from ${start.id}`;    });
    const expected_rate = items_per_second_of(dependence.expected_output_items);
    return `start-dependent: reaches ${Number(expected_rate.toFixed(2))}/s from ${names(reaching)}; ${settles.join("; ")}.`;
}

/** What the generator says of a build whose clocks were tried from the cold start alone */
export const START_DEPENDENCE_NOT_CHECKED = "Start dependence was not checked: every clock was judged from the cold start of the scaffold alone. "
    + "Set overrides.check_start_dependence to try each clock from other starts too.";
