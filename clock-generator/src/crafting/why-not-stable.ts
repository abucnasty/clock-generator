/**
 * Why the selected clock does not meet goal 1 (GOALS.md: hold the target rate and get back to it after a loss), in one
 * of five causes, each told from what the alternatives already carry: no search is added and nothing is generated
 * again.
 *
 * - **Moving lane phases:** the clock is made for a moving belt and holds from the modeled start, but falls short from
 *   another lane phase of the belt: at the start (`as_built.failed_pickup_phases`), or only after a loss
 *   (`backpressure_loss.broken_at_other_lane_phases` holds every loss it does not get back from).
 * - **Output chest full:** the build puts its output into a chest nothing takes from, and where the run that failed the
 *   clock ended the chest had no room left for it: the same chest the web form warns can fill up.
 * - **Export belt short:** the clock moves the target, and a belt with a consumption rate gets less than its consumers
 *   take; the same words name the belt, the item and both rates.
 * - **No recovery:** it holds the rate, and does not get back to it after the losses it names.
 * - **Nothing holds:** it does not hold the rate; the nearest clock is selected, and the clocks that could not be made
 *   are listed with their reasons.
 *
 * The UI calls this on its own view of the clocks, so the same words show there as in the result.
 */
import type { BackpressureLossVerdict } from "./backpressure-loss";
import type { ClockBelt } from "./clock";
import type { ExportShortfall } from "./export-delivery";
import type { FullOutputChest } from "./full-output-chests";
import type { ClockInsight } from "./insights";
import type { ClockRanking } from "./rank";
import type { AsBuiltStabilityCheck, ClockAssessment, ClockVerdict } from "./trial";

export type WhyNotStableCause = "moving lane phases" | "output chest full" | "export belt short" | "no recovery" | "nothing holds";

export interface WhyNotStable {
    cause: WhyNotStableCause;
    /** What to tell the user, with the build's numbers */
    message: string;
}

/** A clock alternative that could not be made, with the generator's one-line reason */
export interface NotMadeClock {
    id: string;
    label: string;
    reason: string;
}

/** What the build's tightest machine has to spare a clock period (the spare-time insight) */
export interface SpareTime {
    /** "Machine 3 (metallurgic-science-pack)" */
    machine: string;
    spare_ticks: number;
    /** The ticks of a period it crafts */
    working_ticks: number;
    /** The periods after a loss a build is given to be back at its expected output (see backpressure-loss.ts) */
    recovery_periods: number;
}

/** What the summary reads of a clock: fields the engine's alternatives and the UI's view of them both carry */
export interface WhyNotStableClock {
    label: string;
    verdict: ClockVerdict;
    /** Goal 1, as the selection reads it (`ClockRanking.meets_target_rate`) */
    meets_target_rate: boolean;
    assessment: Pick<ClockAssessment, "holds" | "items_per_second"> & {
        backpressure_loss: Pick<BackpressureLossVerdict, "survives" | "broken_by" | "broken_at_other_lane_phases" | "not_tried"> | null;
    };
    /** Whether the clock is made for a moving belt (its belt pickups have belt pickup slack) */
    moving_belt: boolean;
    /** The lane phases, by inserter, of the first lane-phase start that fell short after the modeled start held */
    failed_pickup_phases?: Record<string, readonly [number, number]>;
    /** Items the output inserters move in a period of the clock when it holds */
    expected_output_items: number;
    /** What the clock-only check moved from the start it reports: a period, or over `repeat_periods` */
    as_built_output?: { items: number; repeat_periods?: number; repeat_output_items?: number };
    spare_time: SpareTime | null;
    /** The chests the output goes into that nothing empties and that were full where the run that failed the clock ended */
    full_output_chests: readonly FullOutputChest[];
    /** The export belts that got less than their consumers take, over the run that failed the clock */
    export_shortfalls: readonly ExportShortfall[];
}

/**
 * What the summary reads of a clock, from the fields an alternative has under these names; `belt` may be missing from a
 * view kept before it was carried, and is then not taken for a moving belt
 */
export function whyNotStableClockOf(clock: {
    label: string;
    verdict: ClockVerdict;
    ranking: Pick<ClockRanking, "meets_target_rate">;
    assessment: WhyNotStableClock["assessment"];
    belt?: ClockBelt | null;
    as_built: AsBuiltStabilityCheck | null | undefined;
    expected_output_items: number;
    insights: readonly Pick<ClockInsight, "spare_time">[];
}): WhyNotStableClock {
    const { as_built } = clock;
    return {
        label: clock.label,
        verdict: clock.verdict,
        meets_target_rate: clock.ranking.meets_target_rate,
        assessment: clock.assessment,
        moving_belt: clock.belt?.kind === "moving",
        ...(as_built?.failed_pickup_phases !== undefined && { failed_pickup_phases: as_built.failed_pickup_phases }),
        expected_output_items: clock.expected_output_items,
        ...(as_built && { as_built_output: { items: as_built.actual_output_items, repeat_periods: as_built.repeat_periods,
            repeat_output_items: as_built.repeat_output_items } }),
        spare_time: clock.insights.find(it => it.spare_time !== undefined)?.spare_time ?? null,
        full_output_chests: as_built?.full_output_chests ?? [],
        export_shortfalls: as_built?.export_shortfalls ?? [],
    };
}

/** A rate this near the target prints as the target at two decimals, so it is told as at the target */
const MIN_OFF_TARGET = 0.005;

/** A number as the messages print it: at most two decimals, no trailing zeros ("240", "12.5", "0.33") */
const figure = (value: number) => Number(value.toFixed(2)).toString();

/** "Inserter 2" or "inserters 2 and 4", from "inserter:2"-style keys */
function insertersOf(phases: Record<string, readonly [number, number]>): string {
    return insertersNumbered(Object.keys(phases).map(key => key.replace(/^inserter:/, "")));
}

/** "inserter 2" or "inserters 2 and 4", from the inserters' numbers */
function insertersNumbered(ids: readonly string[]): string {
    return ids.length === 1 ? `inserter ${ids[0]}` : `inserters ${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;
}

/** "a, or after b, or after c" */
const lossList = (losses: readonly string[]) => losses.join(", or after ");

/**
 * The sentence for the losses a verdict did not try (`not_tried`), with a space before it to follow another sentence:
 * " Not tried, since one failure is enough: coal stops arriving, iron-plate is not taken away." Empty when every loss was tried.
 */
export function notTriedSentence(not_tried: readonly string[] | undefined): string {
    return not_tried === undefined || not_tried.length === 0 ? ""
        : ` Not tried, since one failure is enough: ${not_tried.join(", ")}.`;
}

/** What the clock moved from the start that fell short: "880 of 1056 items over 6 periods" */
function shortfallOf(clock: WhyNotStableClock): string {
    const output = clock.as_built_output;
    if (output === undefined) {
        return "";
    }
    if (output.repeat_periods !== undefined && output.repeat_periods > 1 && output.repeat_output_items !== undefined) {
        return `${output.repeat_output_items} of ${clock.expected_output_items * output.repeat_periods} items over ${output.repeat_periods} periods`;
    }
    return `${output.items} of ${clock.expected_output_items} items a period`;
}

/** What the config says of its belts and its target, which every clock of a generation shares */
export interface WhyNotStableBuild {
    /** The target over all copies, as the clocks' rates are */
    target_items_per_second: number;
    /** The config says its input belts are backed up (`overrides.backed_up_belts`) */
    backed_up_belts: boolean;
    not_made: readonly NotMadeClock[];
}

/** Said of a moving-belt clock on a config whose belts move; not promised, since no clock is generated to show it */
const BACKED_UP_MAY_HOLD = " If the input belts back up at their pickups, answer Backed up for the belts and generate again: "
    + "a clock may hold then.";

function movingLanePhases(clock: WhyNotStableClock, build: WhyNotStableBuild): WhyNotStable | null {
    if (!clock.moving_belt) {
        return null;
    }
    const lead = `The selected clock (${clock.label}) is made for a moving belt. It holds the target rate from the modeled start`;
    const in_the_game = "In the game a belt's lanes reach the pickups in whatever phase they happen to have, so the build can fall short."
        + (build.backed_up_belts ? "" : BACKED_UP_MAY_HOLD);
    if (clock.verdict === "unstable" && clock.failed_pickup_phases !== undefined) {
        const shortfall = shortfallOf(clock);
        return {
            cause: "moving lane phases",
            message: `${lead}, but not when the lanes reach ${insertersOf(clock.failed_pickup_phases)} in another phase`
                + `${shortfall ? `: from such a start it moves ${shortfall}` : ""}. ${in_the_game}`,
        };
    }
    const loss = clock.assessment.backpressure_loss;
    const other_phases = loss?.broken_at_other_lane_phases ?? [];
    if (clock.verdict === "no recovery" && loss !== null && loss.broken_by.length > 0 && loss.broken_by.every(it => other_phases.includes(it))) {
        return {
            cause: "moving lane phases",
            message: `${lead} and gets back to it from there after every loss, but not when the lanes come back in another `
                + `phase after ${lossList(loss.broken_by)}. ${in_the_game}`,
        };
    }
    return null;
}

/**
 * The spare-time sentence, when making up one period of crafting at the machine's spare ticks a period takes it more
 * periods than a build is given to get back after a loss
 */
function spareTimeSentence(spare: SpareTime | null): string {
    if (spare === null) {
        return "";
    }
    const make_up_periods = spare.spare_ticks > 0 ? spare.working_ticks / spare.spare_ticks : Infinity;
    if (make_up_periods <= spare.recovery_periods) {
        return "";
    }
    const ticks = figure(spare.spare_ticks);
    const periods = Number.isFinite(make_up_periods) ? `${Math.ceil(make_up_periods)} periods` : "forever";
    return ` ${spare.machine} crafts ${figure(spare.working_ticks)} ticks of a period and has ${ticks} ${ticks === "1" ? "tick" : "ticks"} `
        + `to spare: making up one period it lost takes it ${periods}, more than the ${spare.recovery_periods} a build is given to `
        + "get back. That is too little to make up what it lost.";
}

function noRecovery(clock: WhyNotStableClock): WhyNotStable {
    const broken_by = clock.assessment.backpressure_loss?.broken_by ?? [];
    const other_phases = clock.assessment.backpressure_loss?.broken_at_other_lane_phases ?? [];
    const at_the_start = broken_by.filter(it => !other_phases.includes(it));
    const elsewhere = broken_by.filter(it => other_phases.includes(it));
    const sentences = [
        ...(at_the_start.length > 0 ? [`does not get back to it by itself after ${lossList(at_the_start)}.`] : []),
        ...(elsewhere.length > 0 ? [`${at_the_start.length > 0 ? "After" : "after"} ${lossList(elsewhere)} it gets back to it from the `
            + "modeled start, but not when a moving belt's lanes come back in another phase."] : []),
    ];
    const losses = sentences.length > 0 ? sentences.join(" ")
        : "was off its expected output in the run the losses are tried on, so whether it gets back after one is not known.";
    return {
        cause: "no recovery",
        message: `The selected clock (${clock.label}) holds the target rate, but ${losses}${notTriedSentence(clock.assessment.backpressure_loss?.not_tried)}${spareTimeSentence(clock.spare_time)}`
            + " A buffer, or a faster machine, lets it catch up.",
    };
}

/**
 * The selected clock is the nearest to the target where none meets goal 1 (see combineClockAlternativeRuns), and one
 * that holds the target and does not recover is told by noRecovery, so no clock holds the target here
 */
function nothingHolds(clock: WhyNotStableClock, build: WhyNotStableBuild): WhyNotStable {
    return {
        cause: "nothing holds",
        message: `No clock holds the target rate of ${figure(build.target_items_per_second)} a second. ${nearestOf(clock, build)}${notMadeOf(build)}`,
    };
}

/** The clock nearest to the target, with how far it is off */
function nearestOf(clock: WhyNotStableClock, build: WhyNotStableBuild): string {
    const rate = clock.assessment.items_per_second;
    const off = rate - build.target_items_per_second;
    return Math.abs(off) < MIN_OFF_TARGET
        ? `The closest, ${clock.label}, moves ${figure(rate)} a second from the modeled start, and does not keep it up from every start.`
        : `The closest, ${clock.label}, moves ${figure(rate)} a second, ${figure(Math.abs(off))} ${off < 0 ? "under" : "over"} the target.`;
}

/** " Not made: ...", the clocks that could not be made with their reasons; empty when all were */
function notMadeOf(build: WhyNotStableBuild): string {
    return build.not_made.length === 0 ? ""
        : ` Not made: ${build.not_made.map(it => `${it.label} (${it.reason.replace(/\.$/, "")})`).join("; ")}.`;
}

/** A count as a player reads it, with thousands separators: "9,600" */
const count = (value: number) => value.toLocaleString("en-US");

/** "Chest 1 fills up. Nothing takes any electromagnetic science pack out of it, so it holds 9,600 of 9,600 and inserters 1 and 2 have nowhere to drop." */
function fullChestSentence(chest: FullOutputChest): string {
    const inserters = chest.inserter_ids.map(String);
    return `${chest.name} fills up. Nothing takes any ${chest.item_label} out of it, so it holds ${count(chest.held)} of ${count(chest.capacity)} `
        + `and ${insertersNumbered(inserters)} ${inserters.length === 1 ? "has" : "have"} nowhere to drop.`;
}

/**
 * The failing clock's run ended with a chest it puts its output into full, and nothing takes from it: the rate falls
 * short because of the chest, whatever else the clock does
 */
function outputChestFull(clock: WhyNotStableClock, build: WhyNotStableBuild): WhyNotStable | null {
    if (clock.full_output_chests.length === 0) {
        return null;
    }
    return {
        cause: "output chest full",
        message: `No clock holds the target rate of ${figure(build.target_items_per_second)} a second: ${clock.full_output_chests.map(fullChestSentence).join(" ")} `
            + `${nearestOf(clock, build)} Use an infinity chest, or add an inserter that takes the items out, and generate again.${notMadeOf(build)}`,
    };
}

/** "Belt 2 gets 73.4 a second of electronic circuit, and 80 a second is taken off it (inserters 16 and 17 fill it)." The game's names of items have no plural. */
function exportShortfallSentence(short: ExportShortfall): string {
    return `Belt ${short.belt_id} gets ${figure(short.delivered_per_second)} a second of ${short.item_label}, and ${figure(short.expected_per_second)} a second `
        + `is taken off it (${insertersNumbered(short.inserter_ids.map(String))} fill${short.inserter_ids.length === 1 ? "s" : ""} it).`;
}

/**
 * The failing clock moves the target (`at_target`) and a belt with a consumption rate receives less than that rate: the line that
 * takes the items off the belt runs dry, whatever the target says
 */
function exportBeltShort(clock: WhyNotStableClock, at_target: boolean): WhyNotStable | null {
    if (clock.export_shortfalls.length === 0 || !at_target) {
        return null;
    }
    return {
        cause: "export belt short",
        message: `The selected clock (${clock.label}) moves ${figure(clock.assessment.items_per_second)} a second, but ${clock.export_shortfalls.map(exportShortfallSentence).join(" ")}`,
    };
}

/**
 * Why the selected clock does not meet goal 1; null when it does. A stable clock off the target rate (one with a
 * rounded period, or a build the plan cannot run at the target) is told as nothing holding the target.
 */
export function whyNotStable(clocks: readonly WhyNotStableClock[], selected_index: number, build: WhyNotStableBuild): WhyNotStable | null {
    const clock = clocks[selected_index];
    if (clock === undefined || clock.meets_target_rate) {
        return null;
    }
    // a clock that does not recover is told so when it holds the target itself, not another rate
    const at_target = Math.abs(clock.assessment.items_per_second - build.target_items_per_second) < MIN_OFF_TARGET;
    return outputChestFull(clock, build)
        ?? exportBeltShort(clock, at_target)
        ?? movingLanePhases(clock, build)
        ?? (clock.verdict === "no recovery" && at_target ? noRecovery(clock) : nothingHolds(clock, build));
}
