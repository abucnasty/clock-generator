import assert from "../common/assert";
import { fraction } from "../data-types/fraction";
import { Config } from "../config";
import { warnUncalibratedBeltPickups } from "../config/pickup-calibration";
import { warnLanesSharedByCopies } from "../config/lane-capacity-validator";
import { warnSideLoadedDrops } from "../config/side-loaded-drop";
import { warnMachinePrototypes } from "../config/machine-prototype";
import { Entity, EntityId } from "../entities";
import { FactorioBlueprint } from "../blueprints/blueprint";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { Logger, defaultLogger } from "../common/logger";
import { BackpressureLossVerdict } from "./backpressure-loss";
import { SharedItemDeadlockRisk, sharedItemDeadlockRisks } from "./deadlock-risk";
import { backpressureLossInsight, beltPickupNotTestedInsights, chestDrillInsights, ClockInsight, clockInsights, deadlockRiskInsight, dropSpacingInsights, lanesExactlyFullInsights, sideLoadedDropInsights, startDependenceInsight } from "./insights";
import { chestDrillFallbackConfig, ChestDrillClock, hasPlannedChestDrill } from "./chest-drill-windows";
import { chestDrillReasons } from "./always-on-reasons";
import { ClockBelt, clockBeltLabel, fuelHandRoomTicks } from "./clock";
import { evenHandsClock } from "./candidates/even-hands";
import { fullHandClock } from "./candidates/full-hand";
import { observedWindowsClock } from "./candidates/observed-windows";
import { shiftedSwingsClock } from "./candidates/shifted-swings";
import { generateClockForConfig, generateClockWithSwingBackoff, movingBeltClock } from "./generate-clock";
import { BlueprintGenerationResult, GenerateClockOptions, SimulationStabilityCheck } from "./plan/plan-run";
import { withRunMemo } from "./plan/run-memo";
import { ClockRanking, combineClockAlternativeRuns, rankingOf, rankingWindowCount, ROUNDED_CLOCK_MAX_FAST, RoundedClock, roundedRateAllowed, searchesAreNeeded } from "./rank";
import { TargetProductionRate } from "./target-production-rate";
import { AsBuiltStabilityCheck, BackpressureLossAssessment, backpressureLossVerdictOf, ClockAssessment, ClockVerdict, clockVerdictOf, clockVerificationSignature, roundedClockTrial, startDependenceVerdictOf, withSettledOutput } from "./trial";
import { START_DEPENDENCE_NOT_CHECKED, StartDependence, startDependenceNote } from "./start-dependence";
import { NotMadeClock, notTriedSentence, WhyNotStable, whyNotStable, whyNotStableClockOf } from "./why-not-stable";
import { DEFAULT_LOOP_SEED_ITEMS } from "./runner/cold-start";


export interface ClockAlternative {
    id: string;
    label: string;
    description: string;
    /** Total decider windows across inserters, as exported; fewer means more batched swings */
    inserter_window_count: number;
    /** The decider combinators that switch inserters and drills on and off in the exported blueprint, the clock's own not counted */
    deciders: number;
    /** The windows the selection compares last: `inserter_window_count` without the windows of the output feeders */
    ranking_window_count: number;
    /** What the trial of the clock on its build found: holds, survives backpressure loss, rate, wake-ups */
    assessment: ClockAssessment;
    /** The one word for the clock, read off the assessment: stable, no recovery, or unstable */
    verdict: ClockVerdict;
    /** How the clock ranks against the others (see rank.ts); the selection compares these, in order */
    ranking: ClockRanking;
    /**
     * The deadlock risks of the build, the same for every clock of it (see deadlock-risk.ts): two inserters that bring
     * the same item to a machine, one of which brings another item too. Empty for a build without one.
     */
    deadlock_risks: SharedItemDeadlockRisk[];
    /** The belt the clock is made for; null when no inserter with windows picks up from a belt */
    belt: ClockBelt | null;
    /** What the simulation found that is worth explaining about the build and this clock */
    insights: ClockInsight[];
    /** For a clock of a period that is not whole, exported rounded down to whole ticks: how it runs against the target */
    rounded?: RoundedClock;
    result: BlueprintGenerationResult;
}


export interface ClockAlternativesResult {
    alternatives: ClockAlternative[];
    /**
     * The best alternative by its ranking: the one with the fewest wake-ups among those that meet the target rate,
     * or the one nearest to the target rate when none meets it
     */
    selected_index: number;
    /**
     * The labels of the searches that were not run, because a clock made without one can be selected as stable (see
     * `searchesAreNeeded`); empty when they ran. `overrides.search_for_fewer_wake_ups` runs them for every build.
     */
    skipped_searches: string[];
    /**
     * At least one clock was returned and all returned clocks have actual sampled-start outcomes.
     * `start_dependence_note` distinguishes not requested, unavailable and actual sample counts.
     */
    start_dependence_checked: boolean;
    /** What the generator says of start dependence for the build: that it was not checked, or how many clocks depend on the start */
    start_dependence_note: string;
    /** The alternatives that could not be made, each with the generator's reason, in the order they were tried */
    not_made: NotMadeClock[];
    /** Why the selected clock does not meet goal 1, in one of three causes (see whyNotStable); null when it is stable */
    why_not_stable: WhyNotStable | null;
}

/** The alternatives one generation run exports (a subtick and a rounded clock for a fractional period) */
export interface ClockAlternativeRun<T = ClockAlternative> {
    /** Runs with the same clock, physical assumptions and checked behavior are duplicates; only the first is listed */
    signature: string;
    alternatives: T[];
    /** Runs of the same clock made with shared windows (see `SHARED_WINDOWS_NOTE`), listed after this run when it is */
    also?: ClockAlternativeRun<T>[];
}

/** Observed windows re-simulate the build hundreds of times; above this period (a high LCM) that takes minutes */
const MAX_OBSERVED_WINDOWS_PERIOD_TICKS = 2400;

/** Output swing counts above the planned one offered as alternatives, also when the plan backed off to a lower count */
const EXTENDED_SWING_COUNTS = 3;

/** What the remaining alternatives need from the first (batched swings) run */
export interface ClockAlternativeContext {
    swings: number;
    /** The output swings per cycle the plan started with: more than `swings` when it backed off to a lower count */
    planned_swings?: number;
    primary_stable: boolean;
    /** Clock period of the primary alternative */
    period_ticks: number;
}


export interface ClockAlternativeTask {
    id: string;
    label: string;
    /**
     * True for a search the config does not ask for on every build: it waits for the tasks without this, and only
     * runs when `searchesAreNeeded` says so of their runs and the primary one. Also true for a fallback.
     */
    only_when_needed: boolean;
    /**
     * A clock for a belt other than the one the config describes: it waits for the searches too, and only runs when
     * `searchesAreNeeded` says so of every run before it, theirs included. It is not listed among the skipped searches.
     */
    fallback?: boolean;
}


export interface ClockAlternativesPlan {
    primary: ClockAlternativeRun | null;
    context: ClockAlternativeContext;
    /** Independent of each other, so they can run in parallel; listed in display order */
    tasks: ClockAlternativeTask[];
}

/** The id of the alternative made without belt pickup slack on purpose: batched swings for a backed-up belt */
const WITHOUT_BELT_PICKUP_SLACK_ID = "planned";

/** The id of the alternative made for a moving belt on a config whose belts are backed up */
const FOR_A_MOVING_BELT_ID = "planned-moving-belt";


interface AlternativeDefinition {
    id: string;
    label: string;
    description: string;
    run: () => BlueprintGenerationResult;
    /** The config its clock is planned on, where that is not the one the alternatives are made for */
    planned_on?: Config;
    /** One of the four searches: it makes its clock by trying many, which takes most of the time of a generation */
    search?: boolean;
    /**
     * A clock for a belt other than the one the config describes: it waits for the searches as well, and is only made
     * when no clock made before it, theirs included, can be selected as stable. It is not one of the searches.
     */
    fallback?: boolean;
    /**
     * The same alternative with the windows of the drills into chests a tick longer, then with those drills always
     * enabled: made in turn when the clock does not hold, or does not survive backpressure loss, with the fewest (see
     * chestDrillFallbackConfig). Absent where the generator makes no such windows.
     */
    chest_drill_fallbacks?: (() => AlternativeDefinition | undefined)[];
    /**
     * The same alternative with the windows of the takers that open together shared (`shared_windows` of
     * GenerateClockOptions), made when this one is a clock of the grouped hands rule. Throws or gives nothing where
     * it has none.
     */
    shared_windows?: () => AlternativeDefinition | undefined;
    /**
     * The same alternative with the inserters that take out of a loop always enabled (`loop_windows` of
     * GenerateClockOptions false): made when its clock has windows for them (`loop_windows` of the result) and does not
     * hold, or does not get back from a loss, with them.
     */
    without_loop_windows?: () => AlternativeDefinition | undefined;
}

/** Whether a search, or a fallback, waits until it is known that no clock made without one can be selected as stable */
function onlyWhenNeeded(definition: AlternativeDefinition, config: Config): boolean {
    return definition.fallback === true || (definition.search === true && config.overrides?.search_for_fewer_wake_ups !== true);
}


function quietOptions(options: GenerateClockOptions, logger: Logger, report?: (detail: string) => void): GenerateClockOptions {
    return {
        ...options,
        logger: { log: () => { }, warn: () => { }, error: logger.error.bind(logger), debug: () => { } },
        verify_as_built: true,
        on_progress_detail: report,
    };
}

/**
 * Whether the clock-only check reached the expected output from the start the generator gives a clock (the "holds"
 * of a clock's assessment), or the planning run did, where no clock-only check ran
 */
function holds(result: BlueprintGenerationResult): boolean {
    return result.stability_check.as_built?.holds ?? result.stability_check.holds;
}

/** The decider combinators of a clock's blueprint that switch inserters and drills on and off */
export function windowDeciderCount(blueprint: FactorioBlueprint): number {
    return blueprint.entities.filter(entity => entity.name === "decider-combinator"
        && ((entity.tags as { clock_generator?: { inserters?: unknown; drills?: unknown } } | undefined)?.clock_generator?.inserters !== undefined
            || (entity.tags as { clock_generator?: { drills?: unknown } } | undefined)?.clock_generator?.drills !== undefined)).length;
}

/** What a clock with shared windows says about itself, after how its alternative is made */
const SHARED_WINDOWS_NOTE = "Inserters that take into their machines at the same moment share one wake window, as long as the longest of them needs, "
    + "so they share one decider combinator. An inserter that needs fewer hands than that window stays enabled longer than it must, "
    + "so it can wake more often. It is only listed when it keeps the rate and recovers after being starved or jammed.";

/** The alternative every run starts with, and the one the others are described against */
const BATCHED_SWINGS_LABEL = "Batched swings";


const BATCHED_SWINGS_DESCRIPTION = "The swing schedule the generator plans for the target rate. The build is simulated with each "
    + "inserter waiting on its machine's inventory, and each inserter's windows are the ticks it moved items. Swings are "
    + "grouped into batches that match the crafting cycle.";

/** True when an inserter of the build takes fuel for its machine off a belt as well as an ingredient */
function takesFuelOffABelt(config: Config): boolean {
    return fuelHandRoomTicks(createEntityRegistryFromConfig(config)).size > 0;
}

/**
 * For a config whose belts are backed up. A clock is then made without belt pickup slack, and some clocks do not hold
 * the expected output that way, also on the simulator's belt.
 *
 * Such a clock is made again with room for a hand of fuel in the windows of the inserters that take fuel off a belt
 * as well as an ingredient (`withFuelHandRoom`, which gives nothing for a build without one), and that one is kept
 * when it holds. It is still a clock for a backed-up belt: the room is what the fuel needs there. A clock
 * that does not hold either way is offered as it is, without the slack: until 2026-10-10 it was made again with the
 * slack, which no selected clock of any sample needed once the simulator took from the nearest lane of a belt first.
 */
function withFuelHandRoomWhereNeeded(
    withoutRoom: () => BlueprintGenerationResult,
    withFuelHandRoom: () => BlueprintGenerationResult | undefined,
): BlueprintGenerationResult {
    const result = withoutRoom();
    // the room changes nothing where no clocked inserter picks up from a belt, or in a period of part ticks
    if (holds(result) || result.belt?.kind !== "backed_up" || !Number.isInteger(result.simulation_duration.ticks)) {
        return result;
    }
    try {
        const with_room = withFuelHandRoom();
        return with_room !== undefined && Object.keys(with_room.fuel_hand_room_ticks).length > 0 && holds(with_room) ? with_room : result;
    } catch {
        return result;
    }
}


function primaryDefinition(config: Config, options: GenerateClockOptions, report?: (detail: string) => void): AlternativeDefinition {
    const generate = (belt_config: Config, fuel_hand_room: boolean = false) => generateClockWithSwingBackoff(
        { ...belt_config, overrides: { ...belt_config.overrides, derive_clock_windows: false } },
        { ...options, verify_as_built: true, belt_pickup_slack: "always", fuel_hand_room, on_progress_detail: report });
    const result = config.overrides?.backed_up_belts === true
        ? withFuelHandRoomWhereNeeded(() => generate(config), () => takesFuelOffABelt(config) ? generate(config, true) : undefined)
        : generate(config);
    return {
        id: "planned-belt-slack",
        label: BATCHED_SWINGS_LABEL,
        description: BATCHED_SWINGS_DESCRIPTION,
        run: () => result,
    };
}

/**
 * A sentence for an alternative's description about the belt its clock is made for, and why. `made_without_slack` is
 * the alternative that leaves belt pickup slack out on purpose.
 */
function beltNote(config: Config, result: BlueprintGenerationResult, made_without_slack: boolean): string {
    const { belt } = result;
    if (belt === null) {
        return "";
    }
    if (belt.kind === "moving") {
        const [first, last] = [belt.slack_ticks[0], belt.slack_ticks[belt.slack_ticks.length - 1]];
        const ticks = first === last ? `${first} more tick${first === 1 ? "" : "s"}` : `${first}–${last} more ticks`;
        const pickup = " Reachable moving stacks are timed using the pickup geometry (straight belt by default). "
            + "The remaining slack is margin for late starts and gaps; sparse upstream supply is not simulated.";
        const moving = ` Made for a moving belt: every inserter that picks up from a belt stays enabled ${ticks} after each window `
            + "(belt pickup slack), long enough for one more full hand at one belt stack a tick. On a moving belt, and more so on "
            + "one with gaps, a pickup can come late; the extra ticks let it finish instead of the inserter being switched off "
            + `holding a partial hand.${pickup}`;
        if (config.overrides?.backed_up_belts === true) {
            return `${moving} The config says the input belts are backed up: this clock is planned with the belts moving, so a hand `
                + "is given the time moving stacks take to come into reach, and it is checked with the belts backed up. A backed-up "
                + "belt refills a pickup at its own speed, which can be slower than a stack a tick. It is only made when no clock "
                + "made for a backed-up belt can be selected as stable.";
        }
        return moving;
    }
    const backed_up = " Made for a backed-up belt: its belt inserters get only the windows they need with backed-up supply at the pickup, "
        + "without belt pickup slack. On a moving belt an inserter can be switched off holding a partial hand.";
    if (config.overrides?.backed_up_belts === true) {
        const room = Object.entries(result.fuel_hand_room_ticks);
        const config_ids = config.inserters.map((inserter, index) => inserter.id ?? index + 1);
        const inserter_ids = new Map(config_ids.map(id => [EntityId.forInserter(id).id, id]));
        const ids = room.map(([key]) => inserter_ids.get(key));
        const fuel = room.length === 0 ? ""
            : ` ${ids.length === 1 ? `Inserter ${ids[0]} takes` : `Inserters ${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]} take`} fuel off the belt as `
            + `well as an ingredient and stay${ids.length === 1 ? "s" : ""} enabled ${room[0][1]} more ticks after each window, the ticks a hand of fuel takes to fill: `
            + "the fuel slot asks for a hand in any window, ahead of the hands the window is planned for, and this clock did not hold "
            + "the expected output without the room for it.";
        return `${backed_up} The config says the input belts are backed up, so it goes without the slack.${fuel}`;
    }
    if (!Number.isInteger(result.simulation_duration.ticks)) {
        return `${backed_up} The slack is not given to a clock whose period is not a whole number of ticks.`;
    }
    const only_selected_when = "it is only selected for you when no clock for a moving belt holds the target rate.";
    return made_without_slack ? `${backed_up} So ${only_selected_when}`
        : `${backed_up} This clock did not hold the expected output with the slack, so ${only_selected_when}`;
}

/**
 * Every alternative after the primary one. `known_stable` answers from runs that already finished, so the full-hand
 * alternative only re-simulates a planned run when it was not generated yet (e.g. in another worker). With belts that
 * do not move, a clock that does not hold is made again with room for a hand of fuel where the build has an inserter
 * that takes fuel off a belt (see withFuelHandRoomWhereNeeded).
 */
function alternativeDefinitions(
    config: Config,
    context: ClockAlternativeContext,
    quiet: GenerateClockOptions,
    known_stable: (id: string) => boolean | undefined = () => undefined,
    with_chest_drill_fallbacks: boolean = true,
): AlternativeDefinition[] {
    const definitions = withChestDrillFallbacks(alternativeDefinitionsWithFuelHandRoom(config, context, quiet, known_stable), config,
        with_chest_drill_fallbacks, fallback_config => alternativeDefinitions(fallback_config, context, quiet, known_stable, false));
    // the same alternatives made with shared windows, made when one of them is a clock of the grouped hands rule, and
    // with the inserters that take out of a loop always enabled, made when a clock with windows for them does not meet goal 1
    let shared: AlternativeDefinition[] | undefined;
    let without_loop: AlternativeDefinition[] | undefined;
    return definitions.map(definition => ({ ...definition, shared_windows: () => {
        shared ??= alternativeDefinitionsWithFuelHandRoom(config, context, { ...quiet, shared_windows: true }, known_stable);
        return shared.find(it => it.id === definition.id);
    }, without_loop_windows: () => {
        without_loop ??= alternativeDefinitionsWithFuelHandRoom(config, context, { ...quiet, loop_windows: false }, known_stable);
        return without_loop.find(it => it.id === definition.id);
    } }));
}

function alternativeDefinitionsWithFuelHandRoom(
    config: Config,
    context: ClockAlternativeContext,
    quiet: GenerateClockOptions,
    known_stable: (id: string) => boolean | undefined,
): AlternativeDefinition[] {
    const definitions = alternativeDefinitionsFor(config, context, quiet, known_stable);
    if (config.overrides?.backed_up_belts !== true || !takesFuelOffABelt(config)) {
        return definitions;
    }
    const with_fuel_hand_room = alternativeDefinitionsFor(config, context, { ...quiet, fuel_hand_room: true }, known_stable);
    return definitions.map(definition => {
        const with_room = with_fuel_hand_room.find(it => it.id === definition.id);
        return with_room === undefined ? definition
            : { ...definition, run: () => withFuelHandRoomWhereNeeded(definition.run, with_room.run) };
    });
}

/**
 * Each definition with its chest drill fallbacks (see AlternativeDefinition), made lazily: the same definition on the
 * config with the drills' windows a tick longer, then with the drills always enabled. A fallback's clock is checked
 * on the config it was made on.
 */
function withChestDrillFallbacks(
    definitions: AlternativeDefinition[],
    config: Config,
    wanted: boolean,
    definitionsOn: (config: Config) => AlternativeDefinition[],
): AlternativeDefinition[] {
    if (!wanted || !hasPlannedChestDrill(config)) {
        return definitions;
    }
    const fallbacks = (["one tick longer", "always enabled"] as const).map(fallback => {
        let made: AlternativeDefinition[] | undefined;
        const fallback_config = chestDrillFallbackConfig(config, fallback);
        return (id: string) => () => {
            made ??= definitionsOn(fallback_config);
            const definition = made.find(it => it.id === id);
            return definition === undefined ? undefined : { ...definition, planned_on: definition.planned_on ?? fallback_config };
        };
    });
    return definitions.map(definition => ({ ...definition, chest_drill_fallbacks: fallbacks.map(of => of(definition.id)) }));
}

/** The alternatives as the config asks for them, each made once */
function alternativeDefinitionsFor(
    config: Config,
    context: ClockAlternativeContext,
    quiet: GenerateClockOptions,
    known_stable: (id: string) => boolean | undefined,
): AlternativeDefinition[] {
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const fractional = config.overrides?.use_fractional_swings === true;
    const { swings } = context;
    const withSwings = (count: number, extra: GenerateClockOptions) => generateClockForConfig(
        { ...base_config, overrides: { ...base_config.overrides, terminal_swing_count: count } }, extra);
    // a forced count applies to every alternative
    const swings_forced = config.overrides?.terminal_swing_count !== undefined;
    const lower_counts = swings_forced ? [] : Array.from({ length: Math.max(0, swings - 1) }, (_, i) => swings - 1 - i);
    // the planned count only covers what a machine crafts before its output blocks; it keeps crafting while the
    // output inserter takes hands, so longer cycles can work too, but the machine holds the planned count when a cycle's
    // swings start: the farthest count is only tried as a multiple of it (the planned cycle repeated)
    const planned = context.planned_swings ?? swings;
    const higher_counts = swings_forced || context.period_ticks > MAX_OBSERVED_WINDOWS_PERIOD_TICKS ? []
        : Array.from({ length: planned + EXTENDED_SWING_COUNTS - swings }, (_, i) => swings + 1 + i)
            .filter(count => count < planned + EXTENDED_SWING_COUNTS || (planned > 1 && count % planned === 0));
    // Supply still matters for always-enabled and fuel pickups, even when the clock has no belt windows.
    const offer_backed_up_belt = config.overrides?.backed_up_belts !== true
        && config.inserters.some(inserter => inserter.source.type === "belt");
    // the reverse for a config whose belts are backed up, as a fallback: made where no clock for them can be selected as stable
    const offer_moving_belt = config.overrides?.backed_up_belts === true
        && config.inserters.some(inserter => inserter.source.type === "belt");

    return [
        ...(offer_moving_belt ? [{
            id: FOR_A_MOVING_BELT_ID,
            label: `${BATCHED_SWINGS_LABEL}, moving belt`,
            description: BATCHED_SWINGS_DESCRIPTION,
            run: () => generateClockWithSwingBackoff(base_config, quiet, movingBeltClock),
            fallback: true,
        }] : []),
        ...(offer_backed_up_belt ? [{
            id: WITHOUT_BELT_PICKUP_SLACK_ID,
            label: `${BATCHED_SWINGS_LABEL}, backed-up belt`,
            description: BATCHED_SWINGS_DESCRIPTION,
            run: () => {
                const result = generateClockWithSwingBackoff(
                    { ...base_config, overrides: { ...base_config.overrides, backed_up_belts: true } },
                    { ...quiet, belt_pickup_slack: "never" });
                // The simulation uses backed-up supply, but this alternative still opts out of the user's moving-belt choice.
                return { ...result, belt_pickup_slack_left_out: result.belt !== null && Number.isInteger(result.simulation_duration.ticks) };
            },
        }] : []),
        {
            id: "fractional",
            label: fractional ? "Without fractional swings" : "Fractional swings",
            description: fractional ? `${BATCHED_SWINGS_LABEL} with fractional swings turned off: every cycle uses the same whole number of swings.`
                : `${BATCHED_SWINGS_LABEL} with fractional swings turned on: an inserter that needs e.g. 3/2 swings per cycle alternates `
                + "between 1 and 2 swings instead of rounding, which can need fewer or shorter windows.",
            run: () => generateClockWithSwingBackoff(
                { ...base_config, overrides: { ...base_config.overrides, use_fractional_swings: !fractional } },
                quiet
            ),
            planned_on: { ...config, overrides: { ...config.overrides, use_fractional_swings: !fractional } },
        },
        {
            id: "even-hands",
            label: "Even hands",
            description: "One window for each hand an inserter moves in the clock period, the windows spread evenly over the period "
                + "and each a tick shorter than the inserter's hand cycle, so a window moves one hand whenever in it the source "
                + "has the hand and the sink takes it. Inserters that move the same hands a period, such as those of two "
                + "halves of a build that do the same thing, get the same windows and share a window decider. Only offered "
                + "where every inserter takes from a machine or a chest and moves a whole number of hands a period.",
            run: () => generateClockWithSwingBackoff(base_config, quiet, evenHandsClock),
        },
        ...(context.period_ticks > MAX_OBSERVED_WINDOWS_PERIOD_TICKS ? [] : [{
            id: "derived",
            label: "Observed windows",
            description: "Built from what the inserters actually do rather than from the planned schedule. The build is simulated with only "
                + "the output inserters clocked and every other inserter running freely; each inserter's windows are the ticks "
                + "it was busy picking up, swinging and dropping, plus a few ticks of padding. Swings end up spread out, roughly "
                + `one per craft, so its inserters usually have more wake windows than in ${BATCHED_SWINGS_LABEL}, which groups several swings into one window. An inserter between two machines that waits at `
                + "its source for a full hand gets short, evenly spaced windows instead when they stay stable, so it grabs a hand "
                + "that is already there rather than staying enabled while the machine crafts.",
            run: () => generateClockWithSwingBackoff(base_config, quiet, (swings_config, options) => observedWindowsClock(swings_config, options, "always")),
            search: true,
        }]),
        ...(context.period_ticks > MAX_OBSERVED_WINDOWS_PERIOD_TICKS ? [] : [{
            id: "uneven-output",
            label: "Uneven output swings",
            description: "Observed windows with one output swing moved off its planned start, so the output swings are not evenly "
                + "spaced. A machine only has to make up for what the output inserter takes over the whole clock period, so it can "
                + "craft more between one pair of swings than the next and carry the difference in its output slot. The swing is "
                + "tried at positions a craft apart and every other inserter's windows are observed again for each; a position "
                + "whose neighbours work too is used, the smallest move of those. Only offered when the period has more than one "
                + "output swing and a moved swing passes the clock-only check.",
            run: () => {
                // one search at the planned swing count; backing off would repeat it for every lower count
                const result = observedWindowsClock(base_config, quiet, "uneven_output");
                assert(result.search?.kind === "moved output swing" && result.search.picked !== null, "no moved output swing passes the clock-only check");
                return result;
            },
            search: true,
        }]),
        {
            id: "shifted-swings",
            label: "Shifted swings",
            description: `${BATCHED_SWINGS_LABEL} with one round of swings moved together to another place in the `
                + "clock period: an output swing and the input swings planned with it. The plan spaces these rounds evenly, but a "
                + "machine takes a swing whenever its limits allow: an input hand once it is below its insertion limit and before "
                + "it runs out of that ingredient, an output hand once a full one is ready and before the output fills up. Within "
                + "those limits a round can run earlier or later. Window lengths and their spacing within the round are kept, so "
                + "swings stay as batched as planned. Every shift is checked with the clock-only simulation and a shift whose "
                + "neighbours work too is used, the smallest of those. Only offered when the clock period has more than one round "
                + "and a shift passes.",
            run: () => {
                // one search at the planned swing count, like uneven output swings
                const result = shiftedSwingsClock(base_config, { ...quiet, belt_pickup_slack: "always" });
                assert(result.search?.kind === "shifted cycle" && result.search.picked !== null, "no shifted round of swings passes the clock-only check");
                return result;
            },
            search: true,
        },
        ...higher_counts.map(higher => ({
            id: `swings-${higher}`,
            label: `${higher} output swings per cycle`,
            description: `${BATCHED_SWINGS_LABEL} with a longer crafting cycle: the output inserter takes ${higher} hands per cycle instead of `
                + `${swings} while the machine keeps crafting between swings. Batches more swings into fewer, longer windows.`,
            run: () => withSwings(higher, quiet),
        })),
        ...lower_counts.map(lower => ({
            id: `swings-${lower}`,
            label: `${lower} output swing${lower === 1 ? "" : "s"} per cycle`,
            description: `${BATCHED_SWINGS_LABEL} with the output inserter limited to ${lower} swing${lower === 1 ? "" : "s"} per crafting cycle `
                + `instead of ${swings}. The output machine buffers more between swings; useful when the higher swing count `
                + "is unstable.",
            run: () => withSwings(lower, quiet),
        })),
        {
            id: "full-hand",
            label: "Full-hand output swings",
            description: "Output inserters swing once per window, evenly spaced and timed so the machine already holds a full hand when "
                + "the inserter arrives, instead of grabbing a few items at a time while the machine crafts. Only offered when the "
                + "planned output inserters often need more than one grab per hand and a full hand fits below the output block. The timing is "
                + "searched with clock-only simulations, preferring the fewest pickups that wait for items. The timing must "
                + "recover from full output machines; if it does not, some windows are lengthened so a second grab can drain the "
                + `surplus. Other inserters keep the windows of ${BATCHED_SWINGS_LABEL}.`,
            run: () => {
                // input windows come from the first planned run whose clock passes, most batched first
                const full_hand: GenerateClockOptions = { ...quiet, belt_pickup_slack: "always" };
                if (context.primary_stable) {
                    return generateClockWithSwingBackoff(base_config, full_hand, fullHandClock);
                }
                const stable_lower = lower_counts.find(lower =>
                    known_stable(`swings-${lower}`) ?? holds(withSwings(lower, { ...quiet, on_progress_detail: undefined })));
                return stable_lower === undefined
                    ? generateClockWithSwingBackoff(base_config, full_hand, fullHandClock)
                    : fullHandClock({ ...base_config, overrides: { ...base_config.overrides, terminal_swing_count: stable_lower } }, full_hand);
            },
            search: true,
        },
    ];
}

/** Sentences for an alternative's description about what the clock-only check found beyond the output count */
function asBuiltNotes(as_built: AsBuiltStabilityCheck | undefined, expected_output_items: number): string {
    if (as_built === undefined) {
        return "";
    }
    let notes = "";
    if (as_built.repeat_periods !== undefined && as_built.repeat_output_items !== undefined) {
        const expected = expected_output_items * as_built.repeat_periods;
        notes += ` In the clock-only check the build repeats every ${as_built.repeat_periods} periods instead of every period, `
            + `moving ${as_built.repeat_output_items} of ${expected} items over them.`;
    }
    return notes;
}

/** A sentence for an alternative's description about the losses its clock does not get back from, or why none was tried */
function backpressureLossNote(verdict: BackpressureLossVerdict | null, not_tried: string | undefined): string {
    if (verdict === null) {
        return not_tried === undefined ? "" : ` Its backpressure losses could not be tried, so whether it gets back after one is not known: ${not_tried.replace(/\.$/, "")}.`;
    }
    if (verdict.survives) {
        return "";
    }
    return verdict.broken_by.length === 0 ? " It was off its expected output in the run the backpressure losses are tried on, so it is not counted as stable."
        : ` It does not survive backpressure loss: the build does not get back to its expected output under this clock after ${verdict.broken_by.join(", or after ")}.${notTriedSentence(verdict.not_tried)}`;
}


/**
 * Items a second the clock moves over all copies. A whole number of copies keeps the plain product; a fractional one
 * is multiplied as an exact fraction, so 5.5 copies carry no float error of their own.
 */
function itemsPerSecondOverCopies(items_per_period: number, period_ticks: number, copies: number): number {
    if (Number.isInteger(copies)) {
        return items_per_period * 60 / period_ticks * copies;
    }
    return fraction(copies).multiply(items_per_period * 60).divide(period_ticks).toDecimal();
}

type VerificationAssessment = BackpressureLossAssessment & Pick<ClockAssessment, "start_dependence">;

/** Whether a clock has windows the generator made for a drill into a chest */
function plannedChestDrillWindows(result: BlueprintGenerationResult): boolean {
    return result.chest_drills?.some(drill => drill.planned && drill.enabled_ticks !== null) ?? false;
}

/**
 * A run of the alternative and, where its clock is the grouped hands rule's, the run of the same alternative with shared
 * windows (`also`) when that holds the rate and recovers and is another clock than the separate one.
 */
function runAlternative(
    definition: AlternativeDefinition,
    config: Config,
    logger: Logger,
    report?: (detail: string) => void,
    assessed?: ReadonlySet<string>,
    verification_cache?: Map<string, VerificationAssessment>,
    on_not_made?: (clock: NotMadeClock) => void,
    settle_unstable?: boolean,
): ClockAlternativeRun | null {
    const run = runAlternativeOf(definition, config, logger, report, assessed, verification_cache, on_not_made, settle_unstable);
    if (run === null || definition.shared_windows === undefined || !run.alternatives.some(it => it.result.grouped_hands !== undefined)) {
        return run;
    }
    let shared_definition: AlternativeDefinition | undefined;
    try {
        shared_definition = definition.shared_windows();
    } catch (error) {
        logger.log(`Clock alternative "${definition.label}" with shared windows could not be generated: ${error instanceof Error ? error.message : String(error)}`);
        return run;
    }
    if (shared_definition === undefined) {
        return run;
    }
    const shared_run = shared_definition.run;
    const shared = runAlternativeOf({
        ...shared_definition,
        // a clock that is not the grouped hands' with shared windows is not an alternative, and not worth assessing
        run: () => {
            const made = shared_run();
            if (made.grouped_hands?.shared_windows !== true) throw new Error("no shared windows hold");
            return made;
        },
        id: `${definition.id}-shared`,
        label: `${definition.label}, shared windows`,
        description: `${definition.description} ${SHARED_WINDOWS_NOTE}`,
        shared_windows: undefined,
    }, config, logger, report, new Set([...(assessed ?? []), run.signature]), verification_cache, undefined, settle_unstable);
    const listed = shared?.alternatives.filter(it => it.verdict === "stable" && it.result.grouped_hands?.shared_windows === true) ?? [];
    return shared === null || listed.length === 0 ? run : { ...run, also: [...(run.also ?? []), { ...shared, alternatives: listed }] };
}

function runAlternativeOf(
    definition: AlternativeDefinition,
    config: Config,
    logger: Logger,
    report?: (detail: string) => void,
    /** Signatures of clocks another run assesses: a run that makes one of them again is merged away, so it skips assessing it */
    assessed?: ReadonlySet<string>,
    verification_cache?: Map<string, VerificationAssessment>,
    on_not_made?: (clock: NotMadeClock) => void,
    /**
     * List a clock that fails its first check by the mean of its long run (see `withSettledOutput`). That costs a
     * long run for each, and the rates only rank the selection where no clock holds, so it is done where the primary
     * clock does not hold (the primary's own run: where it does not hold itself).
     */
    settle_unstable?: boolean,
): ClockAlternativeRun | null {
    const copies = config.target_output.copies ?? 1;
    let result: BlueprintGenerationResult;
    try {
        result = definition.run();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.log(`Clock alternative "${definition.label}" could not be generated: ${reason}`);
        on_not_made?.({ id: definition.id, label: definition.label, reason });
        return null;
    }
    const { id } = definition;
    const signature = clockVerificationSignature(definition.planned_on ?? config, result);
    if (assessed?.has(signature)) {
        // listed behind the run that assessed it, which combineClockAlternativeRuns keeps in its place
        return { signature, alternatives: [] };
    }
    const entity_registry = createEntityRegistryFromConfig(config);
    // the planning simulation drives inserters from inventory levels and can over- or undershoot
    // where the exported clock does not; in game, recordings matched the clock-only check
    let held = holds(result);
    const cached = verification_cache?.get(signature);
    let loss: BackpressureLossAssessment = cached
        ? { backpressure_loss: cached.backpressure_loss, backpressure_loss_not_tried: cached.backpressure_loss_not_tried }
        : held ? backpressureLossVerdictOf(definition.planned_on ?? config, result, logger, report) : { backpressure_loss: null };
    let used = definition;
    // the inserters that take out of a loop on windows: a clock that does not meet goal 1 with them is made again with
    // them always enabled, as every clock was before they had windows (see trialWithLoopWindows)
    if (cached === undefined && result.loop_windows !== undefined && !(held && loss.backpressure_loss?.survives !== false)) {
        const without = definition.without_loop_windows?.();
        try {
            if (without !== undefined) {
                result = without.run();
                used = without;
                held = holds(result);
                loss = held ? backpressureLossVerdictOf(without.planned_on ?? config, result, logger, report) : { backpressure_loss: null };
                logger.log(`Clock alternative "${definition.label}": the windows out of its loop did not meet goal 1; always enabled: holds=${held} survives=${loss.backpressure_loss?.survives ?? "not tried"}`);
            }
        } catch (error) {
            logger.log(`Clock alternative "${definition.label}" with the inserters out of its loop always enabled could not be generated: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // the drills into chests on their fewest windows: a clock that does not meet goal 1 with them is made again with
    // them a tick longer, then always enabled, as it was before they had windows, and the first that does is kept
    const fallbacks = cached === undefined && !(held && loss.backpressure_loss?.survives !== false) && plannedChestDrillWindows(result)
        ? definition.chest_drill_fallbacks ?? [] : [];
    for (const [index, fallbackOf] of fallbacks.entries()) {
        const fallback = fallbackOf();
        let made: BlueprintGenerationResult;
        try {
            if (fallback === undefined) continue;
            made = fallback.run();
        } catch (error) {
            logger.log(`Clock alternative "${definition.label}" with its drill windows ${index === 0 ? "a tick longer" : "always enabled"} could not be generated: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        result = made;
        used = fallback;
        held = holds(result);
        loss = held ? backpressureLossVerdictOf(fallback.planned_on ?? config, result, logger, report) : { backpressure_loss: null };
        logger.log(`Clock alternative "${definition.label}": the fewest drill windows did not meet goal 1; ${index === 0 ? "a tick longer" : "always enabled"}: holds=${held} survives=${loss.backpressure_loss?.survives ?? "not tried"}`);
        if (held && loss.backpressure_loss?.survives !== false) break;
    }
    if (used !== definition && !plannedChestDrillWindows(result) && result.chest_drills !== undefined) {
        // left always enabled by the fallback: say so, not that the config asks for it
        const chest_drills = result.chest_drills.map((drill): ChestDrillClock => drill.enabled_ticks !== null ? drill
            : { ...drill, planned: true, always_enabled_because: { kind: "fallback" } });
        result = { ...result, chest_drills, always_on_reasons: { ...result.always_on_reasons, ...chestDrillReasons(chest_drills) } };
    }
    const { backpressure_loss } = loss;
    const label = withOutputSwings(definition, result.used_terminal_swing_count);
    const inserter_window_count = entity_registry.getAll().filter(Entity.isInserter)
        .reduce((sum, inserter) => sum + (result.clock_windows[inserter.entity_id.id]?.length ?? 0), 0);
    const ranking_window_count = rankingWindowCount(inserter_window_count, result.clock_windows, result.loop_windows);
    const { as_built, actual_output_items, expected_output_items } = result.stability_check;
    const start_dependence = cached ? cached.start_dependence : config.overrides?.check_start_dependence === true
        ? startDependenceVerdictOf(used.planned_on ?? config, result, held, logger, report)
        : null;
    // a fallback's verdicts are of its clock, not of the one the signature names: a run that makes that clock again
    // makes its own fallback
    if (used === definition) {
        verification_cache?.set(signature, {...loss, start_dependence});
    }
    const deadlock_risks = sharedItemDeadlockRisks(entity_registry);
    const planning_note = actual_output_items === expected_output_items ? ""
        : ` The planning simulation moved ${actual_output_items} of ${expected_output_items} items per period; `
        + "stability is judged by the clock-only check, which runs the exported clock windows.";
    const search = result.search?.picked ? result.search : undefined;
    const moved_note = search?.kind !== "moved output swing" ? ""
        : ` Output swing ${search.picked!.row} starts ${Math.abs(search.picked!.setting)} ticks ${search.picked!.setting < 0 ? "earlier" : "later"} than planned.`;
    const shifted_note = search?.kind !== "shifted cycle" ? ""
        : ` The swings planned in clock ticks ${search.planned_ticks!.start}–${search.planned_ticks!.end} (`
        + search.moved!.map(it => `${it.entity_id.type} ${it.entity_id.number}: ${it.item_names.join(", ")}`).join("; ")
        + `) start ${Math.abs(search.picked!.setting)} ticks ${search.picked!.setting < 0 ? "earlier" : "later"} than planned.`;
    const { belt } = result;
    const belt_note = beltNote(config, result, id === WITHOUT_BELT_PICKUP_SLACK_ID);
    const period = result.simulation_duration.ticks;
    /** What a trial of the clock found, on the exact period or, for a clock rounded down, on its own */
    interface Trial {
        result: BlueprintGenerationResult;
        held: boolean;
        loss: BackpressureLossAssessment;
        start_dependence: StartDependence | null;
        /** The ticks of a period it is run at */
        clock_period: number;
    }
    /** The stability check of a trial with its output as the clock is listed by (see `withSettledOutput`), made once per trial */
    const settled_checks = new Map<SimulationStabilityCheck, Map<number, SimulationStabilityCheck>>();
    const settledStability = (trial: Trial): SimulationStabilityCheck => {
        const check = trial.result.stability_check;
        const by_period = settled_checks.get(check) ?? new Map<number, SimulationStabilityCheck>();
        settled_checks.set(check, by_period);
        if (!by_period.has(trial.clock_period)) {
            by_period.set(trial.clock_period, withSettledOutput(used.planned_on ?? config, trial.result, trial.clock_period, logger).stability_check);
        }
        return by_period.get(trial.clock_period)!;
    };
    /** The alternative for a trial of the clock: its notes, insights, assessment and ranking */
    const alternativeOf = (trial: Trial, row: { id: string; label: string; description_suffix: string; result: BlueprintGenerationResult; rounded?: RoundedClock }): ClockAlternative => {
        // a clock that fails its first check is listed by the mean of its long run, not the one period measured
        const settled = (settle_unstable ?? !held) ? settledStability(trial) : trial.result.stability_check;
        trial = { ...trial, result: { ...trial.result, stability_check: settled } };
        row = { ...row, result: { ...row.result, stability_check: settled } };
        const { as_built } = trial.result.stability_check;
        const { backpressure_loss, backpressure_loss_not_tried } = trial.loss;
        const start_dependence_note = trial.start_dependence === null ? null
            : startDependenceNote(trial.start_dependence, items => itemsPerSecondOverCopies(items, trial.clock_period, copies));
        const description = definition.description + moved_note + shifted_note + belt_note + planning_note + asBuiltNotes(as_built, expected_output_items)
            + backpressureLossNote(backpressure_loss, backpressure_loss_not_tried)
            + (start_dependence_note === null ? "" : ` ${start_dependence_note[0].toUpperCase()}${start_dependence_note.slice(1)}`) + row.description_suffix;
        // what a clock that holds says about the build is read from it, whether it gets back from a loss or not
        const insights = [
            ...clockInsights(trial.result, trial.held, config.overrides?.loop_seed_items ?? DEFAULT_LOOP_SEED_ITEMS),
            ...(backpressure_loss !== null && !backpressure_loss.survives ? [backpressureLossInsight(backpressure_loss, expected_output_items)] : []),
            ...(deadlock_risks.length > 0 ? [deadlockRiskInsight(deadlock_risks)] : []),
            ...beltPickupNotTestedInsights(config),
            ...sideLoadedDropInsights(config),
            ...lanesExactlyFullInsights(config),
            ...dropSpacingInsights(trial.result, config),
            ...(start_dependence_note !== null && trial.start_dependence !== null ? [startDependenceInsight(start_dependence_note, trial.start_dependence)] : []),
            ...chestDrillInsights(trial.result),
        ];
        // what the exported clock moved in its clock-only run, not the target, which is the same for every alternative
        const achieved_output_items = as_built?.actual_output_items ?? trial.result.stability_check.actual_output_items;
        const assessment: ClockAssessment = { holds: trial.held, backpressure_loss, ...(backpressure_loss_not_tried !== undefined && { backpressure_loss_not_tried }),
            items_per_second: itemsPerSecondOverCopies(achieved_output_items, trial.clock_period, copies),
            wake_ups_per_minute: as_built?.wake_ups?.wake_ups_per_minute ?? null, start_dependence: trial.start_dependence };
        const clock = { id: row.id, label: row.label, description, result: row.result, ...(row.rounded && { rounded: row.rounded }),
            inserter_window_count, deciders: windowDeciderCount(row.result.blueprint), ranking_window_count, assessment, verdict: clockVerdictOf(assessment), deadlock_risks, belt, insights };
        return { ...clock, ranking: rankingOf(clock, config) };
    };
    const exact_trial: Trial = { result, held, loss, start_dependence, clock_period: period };
    const exact = alternativeOf(exact_trial, { id, label, description_suffix: "", result });
    logger.log(`Clock alternative "${label}": windows=${inserter_window_count} verdict=${exact.verdict} survives=${backpressure_loss?.survives ?? "not tried"} as-built=${as_built?.actual_output_items}/${expected_output_items} planned=${actual_output_items} belt=${clockBeltLabel(belt) || "none"}`);
    if (Number.isInteger(period)) {
        return { signature, alternatives: [exact] };
    }
    // the blueprint of a period that is not a whole number of ticks counts it rounded down (blueprint.ts), unless it
    // has a subtick clock: listed as that clock, at the rate it runs the build at, it is judged by its own rate. One
    // whose rate may meet goal 1 (at most 0.1% fast, within the machines) is tried on its own period
    const rounded_ticks = Math.floor(period);
    const rounded_rate = itemsPerSecondOverCopies(expected_output_items, rounded_ticks, copies);
    const target = config.target_output.items_per_second;
    const runs_fast = rounded_rate / target - 1;
    const within_machines = rounded_rate <= outputCapacityPerSecond(config) * (1 + 1e-9);
    const may_meet = roundedRateAllowed({ runs_fast, within_machines });
    let not_tried_on_its_period: string | null = null;
    const rounded_trial: Trial | null = may_meet ? (() => {
        try {
            const tried = roundedClockTrial(used.planned_on ?? config, result, rounded_ticks, logger, report);
            return { result: tried.result, held: tried.holds, loss: tried.loss, start_dependence: tried.start_dependence, clock_period: rounded_ticks };
        } catch (error) {
            not_tried_on_its_period = error instanceof Error ? error.message : String(error);
            logger.log(`Clock alternative "${label}" rounded to ${rounded_ticks} ticks could not be tried on its own period: ${not_tried_on_its_period}`);
            return null;
        }
    })() : null;
    const rounded: RoundedClock = { period_ticks: rounded_ticks, runs_fast, within_machines, tried_on_its_period: rounded_trial !== null };
    const fast = `${fastPercent(runs_fast)} fast`;
    const roundedAlternative = (why: string) => alternativeOf(rounded_trial ?? { ...exact_trial, clock_period: rounded_ticks }, {
        id,
        label: `${label} (clock rounded to ${rounded_ticks} ticks, runs ${fast})`,
        description_suffix: ` The period is not a whole number of ticks (${period.toFixed(3)})${why}, so this clock runs it `
            + `rounded down to ${rounded_ticks} ticks, ${fastPercent(runs_fast)} faster than the target`
            + (rounded_trial !== null
                ? `: within the ${fastPercent(ROUNDED_CLOCK_MAX_FAST)} a rounded clock may run and what the machines make, so it is checked on its own ${rounded_ticks}-tick period.`
                : not_tried_on_its_period !== null
                    ? `; it could not be tried on its own period (${(not_tried_on_its_period as string).replace(/\.$/, "")}), so the clock-only check models the exact period.`
                    : `, ${within_machines ? `more than the ${fastPercent(ROUNDED_CLOCK_MAX_FAST)} a rounded clock may run` : "more than the machines make"}; `
                    + "the clock-only check models the exact period."),
        result: rounded_trial?.result ?? result,
        rounded,
    });
    if (rounded_trial !== null) {
        logger.log(`Clock alternative "${label}" rounded to ${rounded_ticks} ticks (runs ${fast}): holds=${rounded_trial.held} survives=${rounded_trial.loss.backpressure_loss?.survives ?? "not tried"}`);
    }
    if (!result.subtick) {
        return { signature, alternatives: [roundedAlternative(" and has no subtick clock of a small enough scale")] };
    }
    const { period_ticks, scale } = result.subtick.clock;
    return {
        signature,
        alternatives: [
            // listed first so it wins ties with the rounded clock for the default selection
            alternativeOf(exact_trial, {
                id: `${id}-subtick`,
                label: `${label}, subtick clock`,
                description_suffix: ` Exported with a subtick clock: the ${period.toFixed(3)}-tick period is `
                    + `${period_ticks}/${scale} ticks, so a ${period_ticks}-tick clock is multiplied by ${scale} and taken modulo `
                    + `${period_ticks} by two extra arithmetic combinators, giving the position in the period in 1/${scale} ticks. `
                    + "Window starts can move by a tick between periods but never drift, so the build runs at exactly the target rate.",
                result: { ...result, blueprint: result.subtick.blueprint, schedule: result.subtick.schedule },
            }),
            roundedAlternative(""),
        ],
    };
}

/** A share as a percentage the labels print: "0.02%", "1.14%", "under 0.01%" */
function fastPercent(share: number): string {
    const percent = share * 100;
    return percent < 0.005 ? "under 0.01%" : `${Number(percent.toFixed(2))}%`;
}

/** Items a second the machines that make the target item can make together, over all copies */
function outputCapacityPerSecond(config: Config): number {
    const item = TargetProductionRate.fromConfig(config.target_output).machine_production_rate.item;
    return createEntityRegistryFromConfig(config).getAll().filter(Entity.isMachine)
        .filter(machine => machine.output.item_name === item)
        .reduce((sum, machine) => sum + machine.output.production_rate.amount_per_second.toDecimal(), 0) * (config.target_output.copies ?? 1);
}

/** Runs the primary (batched swings) alternative and lists the rest as independent tasks */
export function planClockAlternatives(
    config: Config,
    options: GenerateClockOptions = {},
    /**
     * Called with the tasks once the primary clock is made, before it is assessed (its backpressure losses tried): the
     * tasks need its clock, not its assessment, so they can run alongside the rest of the primary alternative. A task
     * that makes the primary clock again can pass its signature to runClockAlternativeTask.
     */
    on_tasks?: (context: ClockAlternativeContext, tasks: ClockAlternativeTask[], primary_signature: string) => void,
): ClockAlternativesPlan {
    return withRunMemo(() => planPrimaryAndTasks(config, options, on_tasks));
}

function planPrimaryAndTasks(
    config: Config,
    options: GenerateClockOptions,
    on_tasks?: (context: ClockAlternativeContext, tasks: ClockAlternativeTask[], primary_signature: string) => void,
): ClockAlternativesPlan {
    const logger = options.logger ?? defaultLogger;
    const definition = primaryDefinition(config, options, options.on_progress_detail);
    const result = definition.run();
    // once a generation; where it goes changes no result, since the coverage check reads the game data itself when it comes first
    warnUncalibratedBeltPickups(config, logger);
    warnLanesSharedByCopies(config, logger);
    warnSideLoadedDrops(config, logger);
    warnMachinePrototypes(config, logger);
    const primary = {
        ...withChestDrillFallbacks([definition], config, true,
            fallback_config => [primaryDefinition(fallback_config, options, options.on_progress_detail)])[0],
        shared_windows: () => primaryDefinition(config, { ...options, shared_windows: true }, options.on_progress_detail),
        without_loop_windows: () => primaryDefinition(config, { ...options, loop_windows: false }, options.on_progress_detail),
    };
    const context: ClockAlternativeContext = {
        swings: result.used_terminal_swing_count,
        planned_swings: result.swing_backoff_report?.initial_terminal_swing_count,
        primary_stable: holds(result),
        period_ticks: result.simulation_duration.ticks,
    };
    const tasks = alternativeDefinitions(config, context, {})
        .map(definition => ({
            id: definition.id, label: definition.label, only_when_needed: onlyWhenNeeded(definition, config),
            ...(definition.fallback === true ? { fallback: true } : {}),
        }));
    on_tasks?.(context, tasks, clockVerificationSignature(config, result));
    const primary_run = runAlternative(primary, config, logger, options.on_progress_detail, undefined, undefined, options.on_not_made);
    return { primary: primary_run, context, tasks };
}

/**
 * The label of an alternative with the output swings per cycle it ended up with, e.g. "Batched swings: 6 output swings
 * per cycle". The alternatives named after a swing count already say it.
 */
function withOutputSwings(definition: { id: string; label: string }, swings: number): string {
    if (definition.id.startsWith("swings-")) {
        return definition.label;
    }
    const count = Number.isInteger(swings) ? `${swings}` : swings.toFixed(2).replace(/0+$/, "");
    return `${definition.label}: ${count} output swing${swings === 1 ? "" : "s"} per cycle`;
}

/** Generates one alternative listed by planClockAlternatives; progress goes to options.on_progress_detail */
export function runClockAlternativeTask(
    config: Config,
    context: ClockAlternativeContext,
    task_id: string,
    options: GenerateClockOptions = {},
    /** Signatures of clocks other runs assess, as the primary alternative's (see planClockAlternatives) */
    assessed_signatures: readonly string[] = [],
): ClockAlternativeRun | null {
    return withRunMemo(() => runTask(config, context, task_id, options, assessed_signatures));
}

function runTask(
    config: Config,
    context: ClockAlternativeContext,
    task_id: string,
    options: GenerateClockOptions,
    assessed_signatures: readonly string[],
): ClockAlternativeRun | null {
    const logger = options.logger ?? defaultLogger;
    const definition = alternativeDefinitions(config, context, quietOptions(options, logger, options.on_progress_detail))
        .find(it => it.id === task_id);
    assert(definition !== undefined, `Unknown clock alternative task "${task_id}"`);
    return runAlternative(definition, config, logger, options.on_progress_detail, new Set(assessed_signatures), undefined, options.on_not_made, !context.primary_stable);
}

/** The start dependence of a build's clocks in a line: that it was not checked, or which clocks depend on the start */
export function startDependenceSummary(config: Config, alternatives: readonly Pick<ClockAlternative, "id" | "assessment">[]): Pick<ClockAlternativesResult, "start_dependence_checked" | "start_dependence_note"> {
    if (config.overrides?.check_start_dependence !== true) {
        return { start_dependence_checked: false, start_dependence_note: START_DEPENDENCE_NOT_CHECKED };
    }
    const dependent = alternatives.filter(it => it.assessment.start_dependence?.verdict === "start-dependent").map(it => it.id);
    const counts = alternatives.flatMap(it => it.assessment.start_dependence?.starts.length ? [it.assessment.start_dependence.starts.length] : []);
    const unavailable = alternatives.length - counts.length;
    const minimum = counts.length > 0 ? Math.min(...counts) : 0;
    const maximum = counts.length > 0 ? Math.max(...counts) : 0;
    const samples = minimum === maximum ? `${minimum} starts` : `${minimum}–${maximum} starts`;
    return {
        start_dependence_checked: counts.length > 0 && unavailable === 0,
        start_dependence_note: alternatives.length === 0 ? "No clocks were available to check for start dependence."
            : counts.length === 0 ? "Start dependence was requested but no sampled-start results are available."
                : `Start dependence was checked from ${samples} per clock for ${counts.length} of ${alternatives.length} clocks: `
                    + (dependent.length === 0 ? "no evaluated clock is start-dependent." : `start-dependent: ${dependent.join(", ")}.`)
                    + (unavailable > 0 ? ` Results are unavailable for ${unavailable} clock${unavailable === 1 ? "" : "s"}.` : ""),
    };
}

/**
 * Generates the same config several ways (batched swings with and without belt pickup slack, derived
 * per-craft windows, fractional swings toggled, lower output swing counts, full-hand output) and checks each
 * with the clock-only simulation from several start phases. Alternatives with identical windows are listed once.
 *
 * The four searches come last and only run when none of the clocks made before them can be selected as stable
 * (`searchesAreNeeded`), unless the config asks for them on every build (`overrides.search_for_fewer_wake_ups`).
 * After them, on a config whose belts are backed up, a clock made for a moving belt, when still none can. The
 * alternatives are listed in the same order either way.
 *
 * Runs everything in sequence; the UI runs the tasks from planClockAlternatives in parallel workers instead.
 */
export function generateClockAlternatives(
    config: Config,
    options: GenerateClockOptions = {}
): ClockAlternativesResult {
    return withRunMemo(() => generateAllAlternatives(config, options));
}

function generateAllAlternatives(config: Config, options: GenerateClockOptions): ClockAlternativesResult {
    const logger = options.logger ?? defaultLogger;
    let current_step = BATCHED_SWINGS_LABEL;
    let completed = 0;
    let total: number | null = null;
    const report = (detail?: string) => options.on_progress?.({ step: current_step, detail, completed, total });

    const not_made: NotMadeClock[] = [];
    const on_not_made = (clock: NotMadeClock) => {
        not_made.push(clock);
        options.on_not_made?.(clock);
    };

    report();
    const plan = planClockAlternatives(config, { ...options, on_progress_detail: report, on_not_made });
    completed++;

    const stable_by_id = new Map<string, boolean>();
    // Request-local: a new generation (or changed config/data) never inherits another run's verdict.
    const verification_cache = new Map<string, VerificationAssessment>();
    if (plan.primary?.alternatives[0]) {
        const {backpressure_loss, backpressure_loss_not_tried, start_dependence} = plan.primary.alternatives[0].assessment;
        verification_cache.set(plan.primary.signature, {backpressure_loss, backpressure_loss_not_tried, start_dependence});
    }
    const known_stable = (id: string) => stable_by_id.get(id);
    const definitions = alternativeDefinitions(config, plan.context, quietOptions(options, logger, report), known_stable);
    // listed in the order of the definitions, whichever are made first
    const runs: (ClockAlternativeRun | null)[] = [plan.primary, ...definitions.map(() => null)];
    const generate = (made: AlternativeDefinition[]) => {
        for (const definition of made) {
            current_step = definition.label;
            report();
            const run = runAlternative(definition, config, logger, report, undefined, verification_cache, on_not_made, !plan.context.primary_stable);
            completed++;
            runs[1 + definitions.indexOf(definition)] = run;
            if (run) {
                // what the full-hand alternative is built on is a run that holds, as before a loss was ever tried
                stable_by_id.set(definition.id, run.alternatives[0].assessment.holds);
            }
        }
    };

    const waiting = definitions.filter(definition => onlyWhenNeeded(definition, config));
    const searches = waiting.filter(definition => definition.fallback !== true);
    const fallbacks = waiting.filter(definition => definition.fallback === true);
    const first = definitions.filter(definition => !waiting.includes(definition));
    total = 1 + first.length;
    generate(first);
    const searches_run = searches.length > 0 && searchesAreNeeded(runs, it => it.ranking);
    if (searches_run) {
        total += searches.length;
        generate(searches);
    } else if (searches.length > 0) {
        logger.log(`Not searched (${searches.map(it => it.label).join(", ")}): a clock made without a search is stable. `
            + "Set overrides.search_for_fewer_wake_ups to search for one with fewer wake-ups.");
    }
    // last, a clock for another belt than the config's, where nothing made so far can be selected as stable
    if (fallbacks.length > 0 && searchesAreNeeded(runs, it => it.ranking)) {
        total += fallbacks.length;
        generate(fallbacks);
    }

    current_step = "Done";
    report();
    const combined = combineClockAlternativeRuns(runs, it => it.ranking);
    return {
        ...combined,
        skipped_searches: searches_run ? [] : searches.map(it => it.label),
        ...startDependenceSummary(config, combined.alternatives),
        not_made,
        why_not_stable: whyNotStableOf(config, combined.alternatives, combined.selected_index, not_made),
    };
}

/** Why the selected clock of a generation does not meet goal 1, from its alternatives (see whyNotStable) */
export function whyNotStableOf(
    config: Config,
    alternatives: readonly ClockAlternative[],
    selected_index: number,
    not_made: readonly NotMadeClock[],
): WhyNotStable | null {
    const clocks = alternatives.map(alternative => whyNotStableClockOf({ ...alternative,
        as_built: alternative.result.stability_check.as_built, expected_output_items: alternative.result.stability_check.expected_output_items }));
    return whyNotStable(clocks, selected_index, {
        target_items_per_second: config.target_output.items_per_second,
        backed_up_belts: config.overrides?.backed_up_belts === true,
        not_made,
    });
}
