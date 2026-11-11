import assert from "../common/assert";
import type { TargetCounts } from "../config/schema";
import { fraction } from "../data-types/fraction";
import { Config } from "../config";
import { warnUncalibratedBeltPickups } from "../config/pickup-calibration";
import { warnLanesSharedByCopies } from "../config/lane-capacity-validator";
import { warnSideLoadedDrops } from "../config/side-loaded-drop";
import { warnMachinePrototypes } from "../config/machine-prototype";
import { Entity, EntityId } from "../entities";
import { FactorioBlueprint } from "../blueprints/blueprint";
import { withNetwork } from "./inserter-counters";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { everyInputLaneIsDeadEnd } from "../entities/traits/lane-facts";
import { decimalOf } from "../entities/traits/ratio";
import { machinesInOrder, traitsOf } from "../entities/traits/traits-of";
import { Logger, defaultLogger } from "../common/logger";
import { DisturbanceTrialVerdict } from "./disturbance-trial";
import { SharedItemDeadlockRisk, sharedItemDeadlockRisks } from "./deadlock-risk";
import { disturbanceTrialInsight, beltPickupNotTestedInsights, chestDrillInsights, ClockInsight, clockInsights, deadlockRiskInsight, dropSpacingInsights, lanesExactlyFullInsights, onePerCopyFeedInsights, assumedCopySpacingInsights, droppedOntoSharedLaneInsights, sideLoadedDropInsights, startDependenceInsight, withWakeUpsFromStarts } from "./insights";
import { chestDrillFallbackConfig, ChestDrillClock, hasPlannedChestDrill } from "./chest-drill-windows";
import { chestDrillReasons, EntityRouteError, entityRoutesOf } from "./enable-control-router";
import { ClockBelt, clockBeltLabel, fuelHandRoomTicks, laneHandRoomTicks } from "./clock";
import { timeDivisionWindowsClock } from "./candidates/time-division-windows";
import { pitchPickupsClock } from "./candidates/pitch-pickups";
import { perHandWindowsClock } from "./candidates/round-robin-polling";
import { timeStudyWindowsClock } from "./candidates/time-study-windows";
import { phaseShiftedBatchClock } from "./candidates/phase-shifted-batch";
import { generateClockForConfig, generateClockWithSwingBackoff, terminalCountForAlternativePlanning } from "./generate-clock";
import { primitiveRoundRobinPollingOptionsSupported, verifiedPrimitiveRoundRobinPollingClock } from "./candidates/round-robin-polling-primitive-verified";
import { primitiveRoundRobinPollingConfigSupported } from "./candidates/round-robin-polling-primitive";
import { MAX_OBSERVED_WINDOWS_WINDOW_CYCLE_TICKS, swingCountsListed } from "./planner/window-cycles";
import { SecondaryPlanningInvariantError, secondaryPlanningCountOf, verificationPlanningConfigOf, withSecondaryPlanningProvenance, type SecondaryPlanningCount } from "./round-robin-polling-primitive-policy";
import { collectingParts, coordinatedSourcesInputOf, type CoordinatedSourcesInput, type CoordinatedSourcesPart } from "./candidates/coordinated-sources-parts";
import { coordinatedSourcesClock } from "./candidates/coordinated-sources";
import { BlueprintGenerationResult, clockedByConfig, GenerateClockOptions, SimulationStabilityCheck, fractionalStartOf, fractionalSwingsOf } from "./plan/unclocked-run";
import { EntityTransferCountMap } from "./sequence/cycle/swing-counts";
import { withRunMemo } from "./plan/run-memo";
import { clockCost, ClockRanking, combineClockAlternativeRuns, rankingOf, rankingWindowCount, ROUNDED_CLOCK_MAX_FAST, RoundedClock, roundedRateAllowed, searchesToRun, searchesAreNeeded } from "./rank";
import { TargetProductionRate } from "./target-production-rate";
import { loopStockBoundOf } from "./candidates/loop-stock-bound";
import { AsBuiltStabilityCheck, DisturbanceTrialAssessment, disturbanceTrialVerdictOf, ClockAssessment, ClockVerdict, clockVerdictOf, clockVerificationSignature, FREE_RUNNING_CHECK_TICKS, fractionalSwingsChangeChecksOf, LOOP_WINDOW_CHECK_TICKS, roundedClockTrial, startDependenceVerdictOf, wakeUpsFromStartsOf, withSettledOutput } from "./trial";
import { WakeUpsFromStarts } from "./wake-ups-from-starts";
import { alternativeIdOf, ChestDrillFallbackKind, ClockStrategy, DefinitionSettings, DefinitionStrategyId, ListingSettings, StrategyId, StrategyRef, strategyListedAs, strategyOf } from "./clock-strategy";
import { catalogRowOf, fixedTuningMethodOf, routerRowOf, settingChipsOf, strategyRowOf } from "./strategy-catalog";
import { type ExploredClocks, exploredClocksOf, isExplored } from "./explore";
import { signalsPerMinuteOf } from "./clock-signals";
import { START_DEPENDENCE_NOT_CHECKED, StartDependence, startDependenceNote } from "./start-dependence";
import { NotMadeClock, notTriedSentence, WhyNotStable, whyNotStable, whyNotStableClockOf } from "./why-not-stable";
import { DEFAULT_KICK_START_ITEMS } from "./runner/cold-start";
import { judgeSharedLanes, SharedLaneLoss } from "./shared-lane-verdict";
import { copiesDisturbanceTrial, CopiesTrialVerdict } from "./shared-lane-trial";


export interface ClockAlternative {
    /** Derived from the clock's strategy and settings (`alternativeIdOf`), such as takt_batches_observed or round_robin_polling_per_hand */
    id: string;
    /** The slot that made the clock, as its id was before it was derived: planned-belt-slack, swings-6, planned-belt-slack-subtick */
    maker: string;
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
    /** Which Enable Control Strategy the clock follows, its tuning method and settings, and its router, as ids (see clock-strategy.ts) */
    strategy: ClockStrategy;
    /** For a clock of a window cycle that is not whole, exported rounded down to whole ticks: how it runs against the target */
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
     * The labels of the searches that were not run, because a clock made without one can be selected as stable and
     * they were not among those that can still improve on it (see `searchesToRun`); empty when all ran.
     * `overrides.search_for_fewer_wake_ups` runs them for every build.
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
    /** The clocks of the explored strategies and whether the best of them beats the selected clock; set only when `explore_strategies` asks for it */
    explored?: ExploredClocks;
}

/** The alternatives one generation run exports (a subtick and a rounded clock for a fractional window cycle) */
export interface ClockAlternativeRun<T = ClockAlternative> {
    /** Runs with the same clock, physical assumptions and checked behavior are duplicates; only the first is listed */
    signature: string;
    alternatives: T[];
    /** Runs of the same clock made with shared windows (see `SHARED_WINDOWS_NOTE`), listed after this run when it is */
    also?: ClockAlternativeRun<T>[];
    /**
     * The clocks this run made, listed or not, as parts of the per-branch clock (coordinated-sources-parts.ts): its alternatives and the
     * ways of the constructions it ran. Absent on a run that made none.
     */
    parts?: CoordinatedSourcesPart[];
}

/** What the remaining alternatives need from the first (batched swings) run */
export interface ClockAlternativeContext {
    /** Count-only AUTO policy from an accepted primitive primary; other families still choose their own LCM. */
    secondary_planning?: SecondaryPlanningCount;
    swings: number;
    /** The output swings each output cycle the plan started with: more than `swings` when it backed off to a lower count */
    planned_swings?: number;
    primary_stable: boolean;
    /** Clock window cycle of the primary alternative */
    window_cycle_ticks: number;
    /** The primary alternative's results come too rarely for whole hands in a window cycle: it is a clock of result windows */
    exhaust?: boolean;
    /** Round-Robin Polling with a shorter window cycle was tried for the primary alternative (its first plan's window cycle too long): it is not offered again */
    primitive_tried?: boolean;
    /** The "Euclidean Swings" alternative would make the primary clock again (see fractionalMakesThePrimary): it is not made */
    fractional_is_primary?: true;
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
    /**
     * The per-branch clock: made last, from the parts of every run before it and the clock they recommend
     * (`coordinatedSourcesInputOf`), by `runCoordinatedSourcesTask`, not by `runClockAlternativeTask`. It is not a search and not a fallback.
     */
    coordinated_sources?: true;
    /** The strategy it runs is explored, not shipped (`STRATEGY_STATUS`): its clock is reported beside the selection and never selected */
    explored?: true;
}


export interface ClockAlternativesPlan {
    primary: ClockAlternativeRun | null;
    context: ClockAlternativeContext;
    /** Independent of each other, so they can run in parallel; listed in display order */
    tasks: ClockAlternativeTask[];
}

/** The options Round-Robin Polling with a shorter window cycle is verified with, as the primary alternative's (see primaryDefinition) */
const SMALL_BATCHES_OPTIONS: GenerateClockOptions = { verify_as_built: true, lane_hand_room: "always" };


/**
 * An error of the generator itself, which fails the generation: not a clock that could not be made, so no maker's fallback
 * passes over it
 */
const isInternalError = (error: unknown): boolean => error instanceof SecondaryPlanningInvariantError || error instanceof EntityRouteError;

interface AlternativeDefinition {
    id: string;
    label: string;
    description: string;
    /** The strategy it stands for (see clock-strategy.ts); the batched swings' is Takt Batches or Round-Robin Polling by what the run made */
    strategy: DefinitionStrategyId;
    /** What it sets on its clock beyond what the result shows */
    settings?: DefinitionSettings;
    /**
     * Coordinated Sources: the strategy of the windows its clock keeps beside its sources' (the recommended clock's, which the
     * drills keep), for the router to name them
     */
    beside_sources?: StrategyRef;
    /** It offers another output count than the plan's: its clock's id says which (`_swings_N`) */
    offers_output_count?: true;
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
     * Made without the shared-windows variant (`shared_windows`): the other output swing counts and fractional swings,
     * whose shared clocks were never selected on a sample or fixture, where the batched swings' own shared clock covers
     * what shared windows give
     */
    no_shared_windows?: true;
    /**
     * The same alternative with the inserters of a loop and those that take out of it always enabled (`loop_windows` of
     * GenerateClockOptions false): made when its clock has windows for them (`loop_windows` of the result) and does not
     * hold, or does not get back from a loss, with them, or with only those out of the loop.
     */
    without_loop_windows?: () => AlternativeDefinition | undefined;
    /**
     * The same alternative with the loop's own inserters always enabled and windows only for those that take out of it
     * (`loop_windows` "out-of-loop"): made first when its clock has windows for the loop's own inserters
     * (`loop_windows.in_loop_ids` of the result) and does not hold, or does not get back from a loss, with them.
     */
    without_in_loop_windows?: () => AlternativeDefinition | undefined;
}

/** Whether a search, or a fallback, waits until it is known that no clock made without one can be selected as stable */
function onlyWhenNeeded(definition: AlternativeDefinition, config: Config): boolean {
    return definition.fallback === true || (definition.search === true && config.overrides?.search_for_fewer_wake_ups !== true);
}

/** The definitions a generation may run: the explored ones only where `explore_strategies` asks for them */
function runnable(definitions: AlternativeDefinition[], options: GenerateClockOptions): AlternativeDefinition[] {
    return options.explore_strategies === true ? definitions : definitions.filter(definition => !isExplored(definition.strategy));
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
const SHARED_WINDOWS_NOTE = "Inserters that take into their machines at the same moment share one enable window, as long as the longest of them needs, "
    + "so they share one decider combinator. An inserter that needs fewer hands than that enable window stays enabled longer than it must, "
    + "so it can have more wakeups. It is only listed when it keeps the rate and goes back to it by itself after a supply stop or an output blockage.";

/** What a clock with a window at each swing says about itself, after how its alternative is made */
const PER_HAND_WINDOWS_NOTE = "Inserters whose machines have room for more than the hands they need are enabled for one tick at the start of "
    + "each of their swings instead of one enable window for all of them, so they have fewer wakeups while they wait between swings. "
    + "It is only listed when it keeps the rate and goes back to it by itself after a supply stop or an output blockage.";

/**
 * The name a definition's label starts with, read from the strategy catalog. Takt Batches is Takt Batches until a run says which
 * strategy it made (`withResolvedName`); Coordinated Sources is a router, named by the router's row.
 */
function nameOf(definition: DefinitionStrategyId): string {
    if (definition === "coordinated_sources") return routerRowOf("coordinated_sources").name;
    const id: StrategyId = definition === "batched_swings" ? "takt_batches" : definition;
    return catalogRowOf({ id, tuning_method: fixedTuningMethodOf(id) ?? "calculated" }).name;
}

/** The alternative every run starts with, and the one the others are described against */
const TAKT_BATCHES = nameOf("batched_swings");

/** The words the labels of the clocks with a shorter window cycle carry after their strategy's name: the setting's chip */
const SHORTER_WINDOW_CYCLE = settingChipsOf({ output_count: { kind: "output_swings", count: 0 }, window_cycle: [{ kind: "shorter_window_cycle" }], belt_pickups: [] })[1].label;

/**
 * A text of a batched swings definition that starts with the name it was written with (Takt Batches), starting with the name of the
 * strategy the run made: Round-Robin Polling where that rule built the windows. Other definitions name their strategy for sure.
 */
function withResolvedName(definition: Pick<AlternativeDefinition, "strategy">, text: string, strategy: ClockStrategy): string {
    if (definition.strategy !== "batched_swings" || !text.startsWith(TAKT_BATCHES)) return text;
    return `${strategyRowOf(strategy).name}${text.slice(TAKT_BATCHES.length)}`;
}


const RESULTS_IN_TURN_ID = "results-in-turn";
const RESULTS_IN_TURN_DESCRIPTION = "For results that come by small chances. The inserters that take each result out of the container "
    + "the machine fills open once a window cycle, in turn, each for as many hands as its results give in all but 1 window cycle in 740, "
    + "with room for the part hand it may still hold. The window cycle time is the longest whose results the container holds at the "
    + "worst moment, just before an opening.";

const BATCHED_SWINGS_DESCRIPTION = "The swing schedule the generator plans for the setpoint. The build is simulated with each "
    + "inserter waiting on its machine's inventory, and each inserter's enable windows are the ticks it moved items. Swings are "
    + "grouped into batches that match the output cycle.";

/**
 * True when an inserter of the build takes fuel for its machine off a belt as well as an ingredient, and its windows get
 * no room for one more hand (a side pickup of an item both lanes carry): the room for one hand holds the fuel's hand already
 */
function takesFuelOffABelt(config: Config): boolean {
    const registry = createEntityRegistryFromConfig(config);
    const lane_hand_room = laneHandRoomTicks(registry);
    return Array.from(fuelHandRoomTicks(registry).keys()).some(id => !lane_hand_room.has(id));
}

/**
 * A clock that does not hold the expected output is made again with room for a hand of fuel in the windows of the
 * inserters that take fuel off a belt as well as an ingredient (`withFuelHandRoom`, which gives nothing for a build
 * without one), and that one is kept when it holds. The fuel slot asks for a hand in any window, whatever the lane does.
 * A clock that does not hold either way is offered as it is.
 */
function withFuelHandRoomWhereNeeded(
    withoutRoom: () => BlueprintGenerationResult,
    withFuelHandRoom: () => BlueprintGenerationResult | undefined,
): BlueprintGenerationResult {
    const result = withoutRoom();
    // the room changes nothing where no clocked inserter picks up from a belt, or in a window cycle of part ticks
    if (holds(result) || result.belt === null || !Number.isInteger(result.simulation_duration.ticks)) {
        return result;
    }
    try {
        const with_room = withFuelHandRoom();
        return with_room !== undefined && Object.keys(with_room.fuel_hand_room_ticks).length > 0 && holds(with_room) ? with_room : result;
    } catch (error) {
        if (isInternalError(error)) throw error;
        return result;
    }
}


function primaryDefinition(config: Config, options: GenerateClockOptions, report?: (detail: string) => void): AlternativeDefinition {
    const generate = (belt_config: Config, fuel_hand_room: boolean = false) => generateClockWithSwingBackoff(
        { ...belt_config, overrides: { ...belt_config.overrides, derive_clock_windows: false } },
        { ...options, verify_as_built: true, lane_hand_room: "always", fuel_hand_room, on_progress_detail: report });
    const result = withFuelHandRoomWhereNeeded(() => generate(config), () => takesFuelOffABelt(config) ? generate(config, true) : undefined);
    if (result.exhaust !== undefined) {
        return { id: RESULTS_IN_TURN_ID, label: nameOf("exhaust"), description: RESULTS_IN_TURN_DESCRIPTION, strategy: "exhaust", run: () => result };
    }
    if (result.primitive_round_robin_polling !== undefined) {
        return { id: "primitive-grouped", label: `${nameOf("round_robin_polling")}, ${SHORTER_WINDOW_CYCLE}`,
            description: `${nameOf("round_robin_polling")} with a ${SHORTER_WINDOW_CYCLE}. Uses small output batches when the initial clock would be too long. Checked for timing margin, clock starts and recovery after interruptions.`,
            strategy: "round_robin_polling", settings: { shorter_window_cycle: true },
            run: () => result };
    }
    return {
        id: "planned-belt-slack",
        label: TAKT_BATCHES,
        description: BATCHED_SWINGS_DESCRIPTION,
        strategy: "batched_swings",
        run: () => result,
    };
}

/** Sentences for an alternative's description about the belt its clock is made for, and the room for a hand of fuel */
function beltNote(config: Config, result: BlueprintGenerationResult): string {
    const { belt } = result;
    if (belt === null) {
        return "";
    }
    const made_for = belt.kind === "moving"
        ? " Made for a moving belt. The pickup geometry times each pickup from the belt (a straight belt by default)."
        : " Made for a backed-up belt. Each belt inserter gets the enable windows it needs with backpressure at the pickup. "
            + "On a moving belt, an inserter can be switched off with a partial hand.";
    const room = Object.entries(result.fuel_hand_room_ticks);
    const config_ids = config.inserters.map((inserter, index) => inserter.id ?? index + 1);
    const inserter_ids = new Map(config_ids.map(id => [EntityId.forInserter(id).id, id]));
    const ids = room.map(([key]) => inserter_ids.get(key));
    const fuel = room.length === 0 ? ""
        : ` ${ids.length === 1 ? `Inserter ${ids[0]} takes` : `Inserters ${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]} take`} fuel off the belt as `
        + `well as an ingredient and stay${ids.length === 1 ? "s" : ""} enabled ${room[0][1]} more ticks after each enable window, the ticks a hand of fuel takes to fill: `
        + "the fuel slot asks for a hand in any enable window, ahead of the hands the enable window is planned for, and this clock did not hold "
        + "the expected output without the room for it.";
    return made_for + fuel;
}

/**
 * Every alternative after the primary one. `known_stable` answers from runs that already finished, so the full-hand
 * alternative only re-simulates a planned run when it was not generated yet (e.g. in another worker). A clock that does
 * not hold is made again with room for a hand of fuel where the build has an inserter that takes fuel off a belt (see
 * withFuelHandRoomWhereNeeded).
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
    // the same alternatives made with shared windows, made when one of them is a clock of the grouped hands rule (except
    // where a definition goes without, see no_shared_windows), and with the inserters that take out of a loop always
    // enabled, made when a clock with windows for them does not meet goal 1
    let shared: AlternativeDefinition[] | undefined;
    let without_loop: AlternativeDefinition[] | undefined;
    let without_in_loop: AlternativeDefinition[] | undefined;
    return definitions.map(definition => ({ ...definition, ...(definition.no_shared_windows !== true && { shared_windows: () => {
        shared ??= alternativeDefinitionsWithFuelHandRoom(config, context, { ...quiet, shared_windows: true }, known_stable);
        return shared.find(it => it.id === definition.id);
    } }), without_loop_windows: () => {
        without_loop ??= alternativeDefinitionsWithFuelHandRoom(config, context, { ...quiet, loop_windows: false }, known_stable);
        return without_loop.find(it => it.id === definition.id);
    }, without_in_loop_windows: () => {
        without_in_loop ??= alternativeDefinitionsWithFuelHandRoom(config, context, { ...quiet, loop_windows: "out-of-loop" }, known_stable);
        return without_in_loop.find(it => it.id === definition.id);
    } }));
}

function alternativeDefinitionsWithFuelHandRoom(
    config: Config,
    context: ClockAlternativeContext,
    quiet: GenerateClockOptions,
    known_stable: (id: string) => boolean | undefined,
): AlternativeDefinition[] {
    let definitions = alternativeDefinitionsFor(config, context, quiet, known_stable);
    if (takesFuelOffABelt(config)) {
        const with_fuel_hand_room = alternativeDefinitionsFor(config, context, { ...quiet, fuel_hand_room: true }, known_stable);
        definitions = definitions.map(definition => {
            const with_room = with_fuel_hand_room.find(it => it.id === definition.id);
            return with_room === undefined ? definition
                : { ...definition, run: () => withFuelHandRoomWhereNeeded(definition.run, with_room.run) };
        });
    }
    // This boundary also serves shared/loop/fuel/chest variants. Annotate the actual returned plan, not the request.
    return secondaryPlanningCountOf(config, context) === undefined ? definitions : definitions.map(definition => ({ ...definition,
        run: () => withSecondaryPlanningProvenance(definition.run()) }));
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
const EVEN_HANDS_DESCRIPTION = "One enable window for each hand an inserter moves in the window cycle, the enable windows spread evenly over the window cycle "
    + "and each a tick shorter than the inserter's swing time, so an enable window moves one hand whenever in it the source "
    + "has the hand and the sink takes it. Inserters that move the same hands each window cycle, such as those of two "
    + "halves of a build that do the same thing, get the same enable windows and share an enable window decider. Only offered "
    + "where every inserter takes from a machine or a chest and moves a whole number of hands each window cycle.";

function alternativeDefinitionsFor(
    config: Config,
    context: ClockAlternativeContext,
    quiet: GenerateClockOptions,
    known_stable: (id: string) => boolean | undefined,
): AlternativeDefinition[] {
    const secondary = secondaryPlanningCountOf(config, context);
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false,
        ...(secondary === undefined ? {} : { terminal_swing_count: secondary.terminal_swing_count }) } };
    const { swings } = context;
    // as the primary alternative makes it (see primaryDefinition), on the config's own counts
    const small_batches_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const withSwings = (count: number, extra: GenerateClockOptions) => generateClockForConfig(
        { ...base_config, overrides: { ...base_config.overrides, terminal_swing_count: count } }, extra);
    // a forced count applies to every alternative
    const swings_forced = config.overrides?.terminal_swing_count !== undefined;
    // the counts the build plan lists its main-period choices for (planner/periods.ts)
    const { lower: lower_counts, higher: higher_counts } = swingCountsListed(swings, context.planned_swings ?? swings, swings_forced, context.window_cycle_ticks);
    // a target that counts an item destroyed is planned by arithmetic: its window cycle and every inserter's hands are worked
    // out, not tried, so no other count or search is offered; even hands moves the same hands
    if (config.setpoint.counts === "destroyed" && context.exhaust === true) {
        // results that come by small chances: the windows are worked out, and the primary clock opens them in turn
        return [];
    }
    if (config.setpoint.counts === "destroyed") {
        return [{
            id: "even-hands",
            label: nameOf("time_division_windows"),
            description: EVEN_HANDS_DESCRIPTION,
            strategy: "time_division_windows",
            run: () => generateClockWithSwingBackoff(base_config, quiet, timeDivisionWindowsClock),
        }];
    }
    return [
        ...(context.fractional_is_primary === true ? [] : [{
            id: "fractional",
            label: nameOf("euclidean_swings"),
            description: `${TAKT_BATCHES} with fractional swings turned on: an inserter that needs e.g. 3/2 swings each output cycle alternates `
                + "between 1 and 2 swings instead of rounding, which can need fewer or shorter enable windows.",
            strategy: "euclidean_swings" as const,
            // planned with fractional swings asked for: its clock's runs are planned so too, as its cycle plan says
            run: () => generateClockWithSwingBackoff(base_config, { ...quiet, fractional_swings: true }),
            // the config it is checked on is the alternatives' own, as with the other definitions, and stays so for its
            // chest drill fallbacks, whose own configs would otherwise take its place (withChestDrillFallbacks)
            planned_on: config,
            no_shared_windows: true as const,
        }]),
        {
            id: "even-hands",
            label: nameOf("time_division_windows"),
            description: EVEN_HANDS_DESCRIPTION,
            strategy: "time_division_windows" as const,
            run: () => generateClockWithSwingBackoff(base_config, quiet, timeDivisionWindowsClock),
        },
        ...(context.window_cycle_ticks > MAX_OBSERVED_WINDOWS_WINDOW_CYCLE_TICKS ? [] : [{
            id: "derived",
            label: nameOf("time_study_windows"),
            strategy: "time_study_windows" as const,
            description: "Built from what the inserters actually do rather than from the planned schedule. The build is simulated with only "
                + "the output inserters clocked and every other inserter running freely; each inserter's enable windows are the ticks "
                + "it was busy picking up, swinging and dropping, plus a few ticks of padding. Swings end up spread out, roughly "
                + `one per craft, so its inserters usually have more enable windows than in ${TAKT_BATCHES}, which groups several swings into one enable window. An inserter between two machines that waits at `
                + "its source for a full hand gets short, evenly spaced enable windows instead when they stay stable, so it grabs a hand "
                + "that is already there rather than staying enabled while the machine crafts.",
            run: () => generateClockWithSwingBackoff(base_config, quiet, (swings_config, options) => timeStudyWindowsClock(swings_config, options, "always")),
            search: true,
        }]),
        ...(context.window_cycle_ticks > MAX_OBSERVED_WINDOWS_WINDOW_CYCLE_TICKS ? [] : [{
            id: "uneven-output",
            label: nameOf("moved_output_swing"),
            strategy: "moved_output_swing" as const,
            description: `${nameOf("time_study_windows")} with one output swing moved off its planned start, so the output swings are not evenly `
                + "spaced. A machine only has to make up for what the output inserter takes over the whole window cycle, so it can "
                + "craft more between one pair of swings than the next and carry the difference in its output slot. The swing is "
                + "tried at positions a craft apart and every other inserter's enable windows are observed again for each; a position "
                + "whose neighbours work too is used, the smallest move of those. Only offered when the window cycle has more than one "
                + "output swing and a moved swing passes the clock-only check.",
            run: () => {
                // one search at the planned swing count; backing off would repeat it for every lower count
                const result = timeStudyWindowsClock(base_config, quiet, "moved_output_swing");
                assert(result.search?.kind === "moved output swing" && result.search.picked !== null, "no moved output swing passes the clock-only check");
                return result;
            },
            search: true,
        }]),
        {
            id: "shifted-swings",
            label: nameOf("phase_shifted_batch"),
            strategy: "phase_shifted_batch" as const,
            description: `${TAKT_BATCHES} with one round of swings moved together to another place in the `
                + "window cycle: an output swing and the input swings planned with it. The plan spaces these rounds evenly, but a "
                + "machine takes a swing whenever its limits allow: an input hand once it is below its insertion limit and before "
                + "it runs out of that ingredient, an output hand once a full one is ready and before the output fills up. Within "
                + "those limits a round can run earlier or later. Enable window lengths and their spacing within the round are kept, so "
                + "swings stay as batched as planned. Every shift is checked with the clock-only check and a shift whose "
                + "neighbours work too is used, the smallest of those. Only offered when the window cycle has more than one round "
                + "and a shift passes.",
            run: () => {
                // one search at the planned swing count, like uneven output swings
                const result = phaseShiftedBatchClock(base_config, { ...quiet, lane_hand_room: "always" });
                assert(result.search?.kind === "shifted cycle" && result.search.picked !== null, `no ${nameOf("phase_shifted_batch")} passes the clock-only check`);
                return result;
            },
            search: true,
        },
        ...higher_counts.map(higher => ({
            id: `swings-${higher}`,
            label: `${TAKT_BATCHES}: ${higher} output swings each output cycle`,
            strategy: "batched_swings" as const,
            offers_output_count: true as const,
            description: `${TAKT_BATCHES} with a longer output cycle: the output inserter takes ${higher} hands each output cycle instead of `
                + `${swings} while the machine keeps crafting between swings. Batches more swings into fewer, longer enable windows.`,
            run: () => withSwings(higher, quiet),
            no_shared_windows: true as const,
        })),
        ...lower_counts.map(lower => ({
            id: `swings-${lower}`,
            label: `${TAKT_BATCHES}: ${lower} output swing${lower === 1 ? "" : "s"} each output cycle`,
            strategy: "batched_swings" as const,
            offers_output_count: true as const,
            description: `${TAKT_BATCHES} with the output inserter limited to ${lower} swing${lower === 1 ? "" : "s"} each output cycle `
                + `instead of ${swings}. The output machine buffers more between swings; useful when the higher swing count `
                + "is unstable.",
            run: () => withSwings(lower, quiet),
            no_shared_windows: true as const,
        })),
        {
            id: "full-hand",
            label: nameOf("pitch_pickups"),
            strategy: "pitch_pickups" as const,
            description: "Output inserters swing once per enable window, evenly spaced and timed so the machine already holds a full hand when "
                + "the inserter arrives, instead of grabbing a few items at a time while the machine crafts. Only offered when the "
                + "planned output inserters often need more than one grab per hand and a full hand fits below the output block. The timing is "
                + "searched with clock-only checks, preferring the fewest pickups that wait for items. The timing must "
                + "let the build go back to its rate by itself when the output machines are full; if it does not, some enable windows are lengthened so a second grab can drain the "
                + `surplus. Other inserters keep the enable windows of ${TAKT_BATCHES}.`,
            run: () => {
                // input windows come from the first planned run whose clock passes, most batched first
                const full_hand: GenerateClockOptions = { ...quiet, lane_hand_room: "always" };
                if (context.primary_stable) {
                    return generateClockWithSwingBackoff(base_config, full_hand, pitchPickupsClock);
                }
                const stable_lower = lower_counts.find(lower =>
                    known_stable(`swings-${lower}`) ?? holds(withSwings(lower, { ...quiet, on_progress_detail: undefined })));
                return stable_lower === undefined
                    ? generateClockWithSwingBackoff(base_config, full_hand, pitchPickupsClock)
                    : pitchPickupsClock({ ...base_config, overrides: { ...base_config.overrides, terminal_swing_count: stable_lower } }, full_hand);
            },
            search: true,
        },
        // Round-Robin Polling with a shorter window cycle, where its first plan's window cycle was not too long, so the primary did not try it: a fallback, made
        // only where no clock made before it can be selected as stable, so it never moves a clock that was selected
        ...(context.primitive_tried === true || !primitiveRoundRobinPollingOptionsSupported(small_batches_config, SMALL_BATCHES_OPTIONS)
            || !primitiveRoundRobinPollingConfigSupported(small_batches_config) ? [] : [{
            id: "primitive-grouped",
            label: `${nameOf("round_robin_polling")}, ${SHORTER_WINDOW_CYCLE}`,
            strategy: "round_robin_polling" as const,
            settings: { shorter_window_cycle: true as const },
            description: `${nameOf("round_robin_polling")} with a ${SHORTER_WINDOW_CYCLE}. Uses small output batches when no planned clock holds. Checked for timing margin, clock starts and recovery after interruptions.`,
            run: () => {
                const made = verifiedPrimitiveRoundRobinPollingClock(small_batches_config, { ...quiet, ...SMALL_BATCHES_OPTIONS },
                    context.planned_swings ?? swings, "no-count-holds");
                if (made.clock === null) throw new Error(made.report.reason ?? `no ${nameOf("round_robin_polling")} clock with a ${SHORTER_WINDOW_CYCLE} holds`);
                return made.clock;
            },
            fallback: true,
        }]),
    ];
}

/** Sentences for an alternative's description about what the clock-only check found beyond the output count */
function asBuiltNotes(as_built: AsBuiltStabilityCheck | undefined, expected_output_items: number): string {
    if (as_built === undefined) {
        return "";
    }
    let notes = "";
    if (as_built.repeat_window_cycles !== undefined && as_built.repeat_output_items !== undefined) {
        const expected = expected_output_items * as_built.repeat_window_cycles;
        notes += ` In the clock-only check the build repeats every ${as_built.repeat_window_cycles} window cycles instead of every window cycle, `
            + `moving ${as_built.repeat_output_items} of ${expected} items over them.`;
    }
    return notes;
}

/**
 * The verdict of the disturbance trials of a clock with those on the copies that share a lane: a new verdict, the one of the
 * trials of one copy unchanged (a memo keeps it). A loss after which a copy is not back makes it one the clock does not get
 * back from.
 */
function withCopiesTrial(verdict: DisturbanceTrialVerdict | null, copies: CopiesTrialVerdict | null): DisturbanceTrialVerdict | null {
    if (verdict === null || copies === null) return verdict;
    // the window cycles to be back stay those of one copy, which the ranking reads; the copies' are in `on_copies`
    if (copies.survives) return { ...verdict, on_copies: copies };
    return { ...verdict, survives: false, broken_by: [...verdict.broken_by, `${copies.broken_by} on the copies that share a lane`], recovered_after_window_cycles: null, on_copies: copies };
}

/** A sentence for an alternative's description about the losses its clock does not get back from, or why none was tried */
function disturbanceTrialNote(verdict: DisturbanceTrialVerdict | null, not_tried: string | undefined): string {
    if (verdict === null) {
        return not_tried === undefined ? "" : ` Its supply stops and output blockages could not be tried, so whether it goes back to its rate by itself after one is not known: ${not_tried.replace(/\.$/, "")}.`;
    }
    if (verdict.survives) {
        return "";
    }
    return verdict.broken_by.length === 0 ? " It was off its expected output in the run used for the loss trials, so it is not counted as stable."
        : ` It is not stable: the build does not go back to its expected output by itself under this clock after ${verdict.broken_by.join(", or after ")}.${notTriedSentence(verdict.not_tried)}`
            + (verdict.on_copies?.text === undefined ? "" : ` ${verdict.on_copies.text}`);
}


/**
 * Items a second the clock moves over all copies. A whole number of copies keeps the plain product; a fractional one
 * is multiplied as an exact fraction, so 5.5 copies carry no float error of their own.
 */
function itemsPerSecondOverCopies(items_per_window_cycle: number, window_cycle_ticks: number, copies: number): number {
    if (Number.isInteger(copies)) {
        return items_per_window_cycle * 60 / window_cycle_ticks * copies;
    }
    return fraction(copies).multiply(items_per_window_cycle * 60).divide(window_cycle_ticks).toDecimal();
}

type VerificationAssessment = DisturbanceTrialAssessment & Pick<ClockAssessment, "start_dependence"> & {
    /** The wake-ups of the clock from the starts, once tried: null where its build has no loop */
    wake_ups_from_starts?: WakeUpsFromStarts | null;
};

/**
 * A sentence for an alternative's description about its wake-ups from more than one start, on a build with a loop, whose
 * wake-ups depend on the start: the mean it is ranked by, the cold start's figure and the range.
 */
function wakeUpsFromStartsNote(from_starts: WakeUpsFromStarts | undefined, cold: number | null): string {
    if (from_starts === undefined) {
        return "";
    }
    const figures = from_starts.wake_ups_per_minute;
    const round = (figure: number) => Math.round(figure).toLocaleString("en-US");
    return ` With a loop in the build, its wakeups depend on where its clock is when the build starts: from ${figures.length} start points,`
        + ` ${round(Math.min(...figures))} to ${round(Math.max(...figures))} a minute, ${round(from_starts.mean)} on average, which it is ranked by`
        + (cold === null ? "." : ` (${round(cold)} from a cold start).`);
}

/** Whether a clock has windows the generator made for a drill into a chest */
function plannedChestDrillWindows(result: BlueprintGenerationResult): boolean {
    return result.chest_drills?.some(drill => drill.planned && drill.enabled_ticks !== null) ?? false;
}

/**
 * A run of the alternative and, where its clock is the grouped hands rule's, the runs of its variants listed after it (`also`):
 * the per-hand windows of its guarded takers (`perHandRun`), then the same alternative with shared windows (`sharedRun`).
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
    const { value: made, parts } = collectingParts(() => {
        const run = runAlternativeOf(definition, config, logger, report, assessed, verification_cache, on_not_made, settle_unstable);
        if (run === null) return run;
        const per_hand = perHandRun(definition, run, config, logger, report, assessed, verification_cache, settle_unstable);
        const with_per_hand = per_hand === null ? run : { ...run, also: [...(run.also ?? []), per_hand] };
        return sharedRun(definition, with_per_hand, config, logger, report, assessed, verification_cache, settle_unstable);
    });
    return made === null ? null : withParts(made, config, parts);
}

/**
 * A run with its parts for the per-branch clock (`ClockAlternativeRun.parts`): every alternative it lists, its own and those of
 * the runs listed after it, then the ways the constructions offered while it ran (`ways`)
 */
function withParts(run: ClockAlternativeRun, config: Config, ways: readonly CoordinatedSourcesPart[]): ClockAlternativeRun {
    const listed: ClockAlternative[] = [];
    const walk = (it: ClockAlternativeRun) => { listed.push(...it.alternatives); it.also?.forEach(walk); };
    walk(run);
    const parts = [...listed.map(alternative => alternativePart(config, alternative)), ...ways,
        ...(run.parts ?? []).filter(part => part.alternative_id === undefined)];
    return parts.length === 0 ? run : { ...run, parts };
}

/** An alternative as a part of the per-branch clock, with how its clock is planned */
function alternativePart(config: Config, alternative: ClockAlternative): CoordinatedSourcesPart {
    const { result } = alternative;
    const { overrides } = verificationPlanningConfigOf(config, result);
    return {
        name: alternative.id, alternative_id: alternative.id, verdict: alternative.verdict, wake_ups_per_minute: clockCost(alternative.ranking),
        window_cycle_ticks: result.simulation_duration.ticks, windows: result.clock_windows,
        counted: result.stability_check.as_built?.wake_ups !== undefined,
        ...(result.always_on_reasons !== undefined && { always_on: result.always_on_reasons }),
        plan: { ...(overrides?.terminal_swing_count !== undefined && { terminal_swing_count: overrides.terminal_swing_count }),
            ...(overrides?.lcm !== undefined && { lcm: overrides.lcm }),
            ...(fractionalSwingsOf(result.output_cycle_plan).fractional_swings === true && { fractional_swings: true as const }) },
    };
}

/**
 * The run of a grouped hands clock with guarded takers made with a window of a tick at each of their swings (`perHandWindowsClock`),
 * listed right after the clock it varies (`also`) when it holds the rate and recovers and is another clock; null elsewhere
 */
function perHandRun(
    definition: AlternativeDefinition,
    run: ClockAlternativeRun,
    config: Config,
    logger: Logger,
    report?: (detail: string) => void,
    assessed?: ReadonlySet<string>,
    verification_cache?: Map<string, VerificationAssessment>,
    settle_unstable?: boolean,
): ClockAlternativeRun | null {
    const varied = run.alternatives.find(it => it.result.round_robin_polling?.guarded_takers !== undefined && it.result.primitive_round_robin_polling === undefined);
    if (varied === undefined) return null;
    const per_hand = runAlternativeOf({
        ...definition,
        run: () => {
            const made = perHandWindowsClock(varied.result);
            if (made === null) throw new Error("no per-hand enable windows");
            return made;
        },
        id: `${definition.id}-per-hand`,
        label: `${definition.label}, one enable window a swing`,
        settings: { ...definition.settings, window_a_swing: true },
        description: `${definition.description} ${PER_HAND_WINDOWS_NOTE}`,
        chest_drill_fallbacks: undefined,
        shared_windows: undefined,
        without_loop_windows: undefined,
        without_in_loop_windows: undefined,
    }, config, logger, report, new Set([...(assessed ?? []), run.signature]), verification_cache, undefined, settle_unstable);
    const listed = per_hand?.alternatives.filter(it => it.verdict === "stable") ?? [];
    return per_hand === null || listed.length === 0 ? null : { ...per_hand, alternatives: listed };
}

/**
 * The run of the alternative with shared windows (`also`), where its clock is the grouped hands rule's, when that holds the rate and
 * recovers and is another clock than the separate one; the run as it is elsewhere
 */
function sharedRun(
    definition: AlternativeDefinition,
    run: ClockAlternativeRun,
    config: Config,
    logger: Logger,
    report?: (detail: string) => void,
    assessed?: ReadonlySet<string>,
    verification_cache?: Map<string, VerificationAssessment>,
    settle_unstable?: boolean,
): ClockAlternativeRun {
    if (definition.shared_windows === undefined || !run.alternatives.some(it => it.result.round_robin_polling !== undefined
        && it.result.primitive_round_robin_polling === undefined)) {
        return run;
    }
    let shared_definition: AlternativeDefinition | undefined;
    try {
        shared_definition = definition.shared_windows();
    } catch (error) {
        if (isInternalError(error)) throw error;
        logger.log(`Clock "${definition.label}" with shared enable windows could not be generated: ${error instanceof Error ? error.message : String(error)}`);
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
            if (made.round_robin_polling?.shared_windows !== true) throw new Error("no shared enable windows hold");
            return made;
        },
        id: `${definition.id}-shared`,
        label: `${definition.label}, shared enable windows`,
        description: `${definition.description} ${SHARED_WINDOWS_NOTE}`,
        shared_windows: undefined,
    }, config, logger, report, new Set([...(assessed ?? []), run.signature]), verification_cache, undefined, settle_unstable);
    const listed = shared?.alternatives.filter(it => it.verdict === "stable" && it.result.round_robin_polling?.shared_windows === true) ?? [];
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
    const copies = config.setpoint.copies ?? 1;
    let result: BlueprintGenerationResult;
    try {
        result = definition.run();
    } catch (error) {
        if (isInternalError(error)) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        logger.log(`Clock "${definition.label}" could not be generated: ${reason}`);
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
    const completed = result.primitive_round_robin_polling?.verification;
    const cached = completed?.signature === signature ? { disturbance_trial: completed.disturbance_trial,
        disturbance_trial_not_tried: undefined, start_dependence: completed.start_dependence } : verification_cache?.get(signature);
    let loss: DisturbanceTrialAssessment = cached
        ? { disturbance_trial: cached.disturbance_trial, disturbance_trial_not_tried: cached.disturbance_trial_not_tried }
        : held ? disturbanceTrialVerdictOf(definition.planned_on ?? config, result, logger, report) : { disturbance_trial: null };
    let used = definition;
    // the inserters of a loop on windows: a clock that does not meet goal 1 with them is made again with the loop's own
    // inserters always enabled, then with those out of the loop always enabled too, as every clock was before they had
    // windows (see trialWithLoopWindows), until one does
    const remakes = [
        { made: definition.without_in_loop_windows, applies: (it: BlueprintGenerationResult) => (it.loop_windows?.in_loop_ids?.length ?? 0) > 0,
            what: "the enable windows of its loop's own inserters", left: "the loop's own inserters always enabled" },
        { made: definition.without_loop_windows, applies: (it: BlueprintGenerationResult) => it.loop_windows !== undefined,
            what: "the enable windows out of its loop", left: "always enabled" },
    ];
    for (const remake of remakes) {
        if (cached !== undefined || !remake.applies(result) || (held && loss.disturbance_trial?.survives !== false)) {
            continue;
        }
        const without = remake.made?.();
        try {
            if (without !== undefined) {
                result = without.run();
                used = without;
                held = holds(result);
                loss = held ? disturbanceTrialVerdictOf(without.planned_on ?? config, result, logger, report) : { disturbance_trial: null };
                logger.log(`Clock "${definition.label}": ${remake.what} did not give a stable clock; ${remake.left}: holds=${held} stable=${loss.disturbance_trial?.survives ?? "not tried"}`);
            }
        } catch (error) {
            if (isInternalError(error)) throw error;
            logger.log(`Clock "${definition.label}" with ${remake.left === "always enabled" ? "the inserters out of its loop always enabled" : remake.left} could not be generated: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // the drills into chests on their fewest windows: a clock that does not meet goal 1 with them is made again with
    // them a tick longer, then always enabled, as it was before they had windows, and the first that does is kept
    const fallbacks = cached === undefined && !(held && loss.disturbance_trial?.survives !== false) && plannedChestDrillWindows(result)
        ? definition.chest_drill_fallbacks ?? [] : [];
    let chest_drill_fallback: ChestDrillFallbackKind | undefined;
    for (const [index, fallbackOf] of fallbacks.entries()) {
        const fallback = fallbackOf();
        let made: BlueprintGenerationResult;
        try {
            if (fallback === undefined) continue;
            made = fallback.run();
        } catch (error) {
            if (isInternalError(error)) throw error;
            logger.log(`Clock "${definition.label}" with its drill enable windows ${index === 0 ? "a tick longer" : "always enabled"} could not be generated: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        result = made;
        used = fallback;
        chest_drill_fallback = index === 0 ? "tick-longer" : "always-on";
        held = holds(result);
        loss = held ? disturbanceTrialVerdictOf(fallback.planned_on ?? config, result, logger, report) : { disturbance_trial: null };
        logger.log(`Clock "${definition.label}": the fewest drill enable windows did not give a stable clock; ${index === 0 ? "a tick longer" : "always enabled"}: holds=${held} stable=${loss.disturbance_trial?.survives ?? "not tried"}`);
        if (held && loss.disturbance_trial?.survives !== false) break;
    }
    if (used !== definition && !plannedChestDrillWindows(result) && result.chest_drills !== undefined) {
        // left always enabled by the fallback: say so, not that the config asks for it
        const chest_drills = result.chest_drills.map((drill): ChestDrillClock => drill.enabled_ticks !== null ? drill
            : { ...drill, planned: true, always_enabled_because: { kind: "fallback" } });
        result = { ...result, chest_drills, always_on_reasons: { ...result.always_on_reasons, ...chestDrillReasons(chest_drills) } };
    }
    const { disturbance_trial } = loss;
    const strategy = strategyOf(definition.strategy, result, { chest_drill_fallback, destroyed_target: config.setpoint.counts === "destroyed",
        ...(definition.settings !== undefined && { definition_settings: definition.settings }) });
    // phase 2 of the router: every inserter and drill has exactly one route, its windowed ones named by the strategy; the routes stay
    // inside the engine (enable-control-router.ts), so nothing listed below reads them
    entityRoutesOf(entity_registry, result, clockedByConfig(used.planned_on ?? config), strategy, definition.beside_sources);
    const label = withOutputSwings(definition, strategy, result.used_terminal_swing_count, config.setpoint.counts);
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
        : ` The planning simulation moved ${actual_output_items} of ${expected_output_items} items each window cycle; `
        + "stability is judged by the clock-only check, which runs the enable windows of the blueprint.";
    const search = result.search?.picked ? result.search : undefined;
    const moved_note = search?.kind !== "moved output swing" ? ""
        : ` Output swing ${search.picked!.row} starts ${Math.abs(search.picked!.setting)} ticks ${search.picked!.setting < 0 ? "earlier" : "later"} than planned.`;
    const shifted_note = search?.kind !== "shifted cycle" ? ""
        : ` The swings planned in clock ticks ${search.planned_ticks!.start}–${search.planned_ticks!.end} (`
        + search.moved!.map(it => `${it.entity_id.type} ${it.entity_id.number}: ${it.item_names.join(", ")}`).join("; ")
        + `) start ${Math.abs(search.picked!.setting)} ticks ${search.picked!.setting < 0 ? "earlier" : "later"} than planned.`;
    const { belt } = result;
    const belt_note = beltNote(config, result);
    const window_cycle_ticks = result.simulation_duration.ticks;
    /** What a trial of the clock found, on the exact window cycle or, for a clock rounded down, on its own */
    interface Trial {
        result: BlueprintGenerationResult;
        held: boolean;
        loss: DisturbanceTrialAssessment;
        start_dependence: StartDependence | null;
        /** The ticks of a window cycle it is run at */
        clock_window_cycle: number;
    }
    /** The stability check of a trial with its output as the clock is listed by (see `withSettledOutput`), made once per trial */
    const settled_checks = new Map<SimulationStabilityCheck, Map<number, SimulationStabilityCheck>>();
    const settledStability = (trial: Trial): SimulationStabilityCheck => {
        const check = trial.result.stability_check;
        const by_window_cycle = settled_checks.get(check) ?? new Map<number, SimulationStabilityCheck>();
        settled_checks.set(check, by_window_cycle);
        if (!by_window_cycle.has(trial.clock_window_cycle)) {
            by_window_cycle.set(trial.clock_window_cycle, withSettledOutput(used.planned_on ?? config, trial.result, trial.clock_window_cycle, logger).stability_check);
        }
        return by_window_cycle.get(trial.clock_window_cycle)!;
    };
    /**
     * The wake-ups of a trial's clock from the starts (see wake-ups-from-starts.ts), made once per trial: of the exact clock as its
     * long run was made (with the windows out of a loop, twice as long), of a clock rounded down on its own window cycle
     */
    const from_starts_of = new Map<Trial, WakeUpsFromStarts | null>();
    const fromStarts = (trial: Trial, exact: boolean): WakeUpsFromStarts | null => {
        if (!from_starts_of.has(trial)) {
            const remembered = exact ? cached?.wake_ups_from_starts : undefined;
            let made: WakeUpsFromStarts | null;
            try {
                made = remembered !== undefined ? remembered : wakeUpsFromStartsOf(
                    { ...(used.planned_on ?? config), overrides: { ...(used.planned_on ?? config).overrides, terminal_swing_count: trial.result.used_terminal_swing_count } },
                    trial.result.clock_windows, trial.clock_window_cycle, expected_output_items,
                    exact && trial.result.loop_windows !== undefined ? LOOP_WINDOW_CHECK_TICKS : FREE_RUNNING_CHECK_TICKS, logger,
                    fractionalSwingsOf(trial.result.output_cycle_plan));
            } catch (error) {
                logger.log(`Clock "${label}" could not be started from other places: ${error instanceof Error ? error.message : String(error)}`);
                made = null;
            }
            from_starts_of.set(trial, made);
            const entry = exact && used === definition ? verification_cache?.get(signature) : undefined;
            if (entry !== undefined) entry.wake_ups_from_starts = made;
        }
        return from_starts_of.get(trial)!;
    };
    /**
     * The takers of the copies that lose swings on a lane they share (see shared-lane-verdict.ts), made once per trial, of
     * the clock it runs and on the config it is verified on: only of a clock that holds its expected output, which alone
     * the lanes can keep from being stable
     */
    const shared_lane_losses_of = new Map<Trial, SharedLaneLoss[]>();
    const sharedLaneLosses = (trial: Trial): SharedLaneLoss[] => {
        if (!trial.held) return [];
        if (!shared_lane_losses_of.has(trial)) {
            const on = used.planned_on ?? config;
            let judged;
            try {
                judged = judgeSharedLanes({ ...on, overrides: { ...on.overrides, terminal_swing_count: trial.result.used_terminal_swing_count } },
                    trial.result.clock_windows, trial.clock_window_cycle, logger);
            } catch (error) {
                if (isInternalError(error)) throw error;
                logger.warn(`Clock "${label}": the lanes its copies share could not be checked: ${error instanceof Error ? error.message : String(error)}`);
                shared_lane_losses_of.set(trial, []);
                return [];
            }
            if (judged.lanes.length > 0) {
                logger.log(`Clock "${label}": the shared lanes ${judged.lanes.join(", ")}: the refill arithmetic says ${judged.fast_check_passes ? "they refill in time" : "they may run short"}; `
                    + `with every copy on them, ${judged.losses.length === 0 ? "no copy loses swings" : `${judged.losses.length} takers lose swings`}`);
            }
            shared_lane_losses_of.set(trial, judged.losses);
        }
        return shared_lane_losses_of.get(trial)!;
    };
    /**
     * The disturbance trials on the copies that share a lane (see shared-lane-trial.ts), made once per trial: only of a clock
     * that holds, gets back from every loss on one copy and loses no swings on the shared lanes, unless the config switches
     * them off (`overrides.disturbance_trials_on_copies`); null where they are not made
     */
    const copies_trials_of = new Map<Trial, CopiesTrialVerdict | null>();
    const copiesTrial = (trial: Trial, shared_lane_losses: readonly SharedLaneLoss[]): CopiesTrialVerdict | null => {
        if (config.overrides?.disturbance_trials_on_copies === false || !trial.held || shared_lane_losses.length > 0
            || trial.loss.disturbance_trial?.survives !== true) return null;
        if (!copies_trials_of.has(trial)) {
            const on = used.planned_on ?? config;
            let tried: CopiesTrialVerdict | null;
            try {
                tried = copiesDisturbanceTrial({ ...on, overrides: { ...on.overrides, terminal_swing_count: trial.result.used_terminal_swing_count } },
                    trial.result.clock_windows, trial.clock_window_cycle, trial.result.stability_check.expected_output_items, logger);
            } catch (error) {
                if (isInternalError(error)) throw error;
                const reason = error instanceof Error ? error.message : String(error);
                logger.warn(`Clock "${label}": the disturbance trials on the copies that share a lane could not be made: ${reason}`);
                // the clock keeps the verdict of one copy, and the result says why the copies were not tried
                tried = { survives: true, lanes: [], expected_output_items: trial.result.stability_check.expected_output_items, recovered_after_window_cycles: null, not_tried: reason };
            }
            copies_trials_of.set(trial, tried);
        }
        return copies_trials_of.get(trial)!;
    };
    /** The trial of a clock rounded down to whole ticks on its own window cycle, where one is made (below) */
    let rounded_trial: Trial | null = null;
    /** The alternative for a trial of the clock: its notes, insights, assessment and ranking */
    const alternativeOf = (trial: Trial, row: { id: string; label: string; description_suffix: string; result: BlueprintGenerationResult; rounded?: RoundedClock;
        /** What this listing of the clock adds to the settings of its strategy: a subtick clock, a clock rounded down */
        listing?: ListingSettings }): ClockAlternative => {
        const tried_as = trial;
        const shared_lane_losses = sharedLaneLosses(trial);
        const copies_trial = copiesTrial(trial, shared_lane_losses);
        // a clock that fails its first check is listed by the mean of its long run, not the one window cycle measured
        const settled_check = (settle_unstable ?? !held) ? settledStability(trial) : trial.result.stability_check;
        // the counters of its inserters learn which decider switches each from the blueprint it is listed with
        const settled = settled_check.as_built?.counters === undefined ? settled_check : { ...settled_check,
            as_built: { ...settled_check.as_built, counters: withNetwork(settled_check.as_built.counters, row.result.blueprint, windowDeciderCount(row.result.blueprint)) } };
        trial = { ...trial, result: { ...trial.result, stability_check: settled } };
        row = { ...row, result: { ...row.result, stability_check: settled } };
        const { as_built } = trial.result.stability_check;
        const { disturbance_trial_not_tried } = trial.loss;
        const disturbance_trial = withCopiesTrial(trial.loss.disturbance_trial, copies_trial);
        const start_dependence_note = trial.start_dependence === null ? null
            : startDependenceNote(trial.start_dependence, items => itemsPerSecondOverCopies(items, trial.clock_window_cycle, copies));
        const description = withResolvedName(definition, definition.description, strategy) + moved_note + shifted_note + belt_note + planning_note + asBuiltNotes(as_built, expected_output_items)
            + disturbanceTrialNote(disturbance_trial, disturbance_trial_not_tried) + sharedLaneLossNote(shared_lane_losses)
            + (start_dependence_note === null ? "" : ` ${start_dependence_note[0].toUpperCase()}${start_dependence_note.slice(1)}`) + row.description_suffix;
        // what a clock that holds says about the build is read from it, whether it gets back from a loss or not
        const insights = [
            ...clockInsights(trial.result, trial.held, config.overrides?.kick_start_items ?? DEFAULT_KICK_START_ITEMS),
            ...(disturbance_trial !== null && !disturbance_trial.survives ? [disturbanceTrialInsight(disturbance_trial, expected_output_items)] : []),
            ...(deadlock_risks.length > 0 ? [deadlockRiskInsight(deadlock_risks)] : []),
            ...beltPickupNotTestedInsights(config),
            ...sideLoadedDropInsights(config),
            ...lanesExactlyFullInsights(config),
            ...onePerCopyFeedInsights(config),
            ...assumedCopySpacingInsights(config),
            ...droppedOntoSharedLaneInsights(config),
            ...dropSpacingInsights(trial.result, config),
            ...(start_dependence_note !== null && trial.start_dependence !== null ? [startDependenceInsight(start_dependence_note, trial.start_dependence)] : []),
            ...chestDrillInsights(trial.result),
        ];
        // what the exported clock moved in its clock-only run, not the target, which is the same for every alternative
        const achieved_output_items = as_built?.actual_output_items ?? trial.result.stability_check.actual_output_items;
        const assessment: ClockAssessment = { holds: trial.held, disturbance_trial, ...(disturbance_trial_not_tried !== undefined && { disturbance_trial_not_tried }),
            items_per_second: itemsPerSecondOverCopies(achieved_output_items, trial.clock_window_cycle, copies),
            wake_ups_per_minute: as_built?.wake_ups?.wake_ups_per_minute ?? null,
            signals_per_minute: as_built?.wake_ups === undefined ? null : signalsPerMinuteOf(as_built.counters, row.result.blueprint, row.result.chest_drills, trial.clock_window_cycle),
            start_dependence: trial.start_dependence, ...(shared_lane_losses.length > 0 && { shared_lane_losses }),
            ...loopStockBoundOf(config, row.result, trial.clock_window_cycle) };
        const listed_strategy = strategyListedAs(strategy, row.listing ?? {});
        const clock = { id: alternativeIdOf(listed_strategy, definition), maker: row.id, label: row.label, description, result: row.result, ...(row.rounded && { rounded: row.rounded }),
            inserter_window_count, deciders: windowDeciderCount(row.result.blueprint), ranking_window_count, assessment, verdict: clockVerdictOf(assessment), deadlock_risks, belt, insights,
            strategy: listed_strategy };
        const ranking = rankingOf(clock, config);
        // where its wake-ups decide the selection, a clock of a build with a loop, whose wake-ups depend on how it starts, is ranked by their mean
        // over the starts; the clock of a trial that is neither the exact one nor the rounded one tried meets no target
        const is_exact = tried_as === exact_trial;
        const from_starts = ranking.meets_target_rate && assessment.wake_ups_per_minute !== null && (is_exact || tried_as === rounded_trial)
            ? fromStarts(tried_as, is_exact) : null;
        if (from_starts === null) {
            return { ...clock, ranking };
        }
        const with_mean = { ...clock, description: clock.description + wakeUpsFromStartsNote(from_starts, assessment.wake_ups_per_minute),
            assessment: { ...assessment, wake_ups_per_minute: from_starts.mean, wake_ups_from_starts: from_starts },
            insights: withWakeUpsFromStarts(clock.insights, from_starts) };
        return { ...with_mean, ranking: rankingOf(with_mean, config) };
    };
    const exact_trial: Trial = { result, held, loss, start_dependence, clock_window_cycle: window_cycle_ticks };
    const exact = alternativeOf(exact_trial, { id, label, description_suffix: "", result });
    logger.log(`Clock "${label}": windows=${inserter_window_count} verdict=${exact.verdict} stable=${disturbance_trial?.survives ?? "not tried"} as-built=${as_built?.actual_output_items}/${expected_output_items} planned=${actual_output_items} belt=${clockBeltLabel(belt) || "none"}`);
    if (Number.isInteger(window_cycle_ticks)) {
        return { signature, alternatives: [exact] };
    }
    // a window cycle that is not a whole number of ticks is exported with its subtick clock where it has one: listed as that
    // clock, it runs the build at exactly the target rate
    if (result.subtick) {
        const { window_cycle_ticks: counted_ticks, scale } = result.subtick.clock;
        return { signature, alternatives: [alternativeOf(exact_trial, {
            id: `${id}-subtick`,
            label: `${label}, subtick clock`,
            listing: { subtick_clock: true },
            description_suffix: ` The blueprint has a subtick clock: the ${window_cycle_ticks.toFixed(3)}-tick window cycle time is `
                + `${counted_ticks}/${scale} ticks, so a ${counted_ticks}-tick clock is multiplied by ${scale} and taken modulo `
                + `${counted_ticks} by two extra arithmetic combinators, giving the position in the window cycle in 1/${scale} ticks. `
                + "Enable window starts can move by a tick between window cycles but never drift, so the build runs at exactly the setpoint.",
            result: { ...result, blueprint: result.subtick.blueprint, schedule: result.subtick.schedule },
        })] };
    }
    // with no subtick clock its blueprint counts the window cycle rounded down (blueprint.ts): listed as that clock, it is
    // judged by its own rate. One whose rate may meet goal 1 (at most 0.1% fast, within the machines) is tried on its
    // own window cycle
    const rounded_ticks = Math.floor(window_cycle_ticks);
    const rounded_rate = itemsPerSecondOverCopies(expected_output_items, rounded_ticks, copies);
    const target = config.setpoint.items_per_second;
    const runs_fast = rounded_rate / target - 1;
    const within_machines = rounded_rate <= outputCapacityPerSecond(config) * (1 + 1e-9);
    const may_meet = roundedRateAllowed({ runs_fast, within_machines });
    let not_tried_on_its_window_cycle: string | null = null;
    rounded_trial = may_meet ? (() => {
        try {
            const tried = roundedClockTrial(used.planned_on ?? config, result, rounded_ticks, logger, report);
            return { result: tried.result, held: tried.holds, loss: tried.loss, start_dependence: tried.start_dependence, clock_window_cycle: rounded_ticks };
        } catch (error) {
            if (isInternalError(error)) throw error;
            not_tried_on_its_window_cycle = error instanceof Error ? error.message : String(error);
            logger.log(`Clock "${label}" rounded to ${rounded_ticks} ticks could not be tried on its own window cycle: ${not_tried_on_its_window_cycle}`);
            return null;
        }
    })() : null;
    const rounded: RoundedClock = { window_cycle_ticks: rounded_ticks, runs_fast, within_machines, tried_on_its_window_cycle: rounded_trial !== null };
    const fast = `${fastPercent(runs_fast)} fast`;
    if (rounded_trial !== null) {
        logger.log(`Clock "${label}" rounded to ${rounded_ticks} ticks (runs ${fast}): holds=${rounded_trial.held} stable=${rounded_trial.loss.disturbance_trial?.survives ?? "not tried"}`);
    }
    return { signature, alternatives: [alternativeOf(rounded_trial ?? { ...exact_trial, clock_window_cycle: rounded_ticks }, {
        id,
        label: `${label} (rounded to ${rounded_ticks} ticks, ${fast})`,
        listing: { rounded: { window_cycle_ticks: rounded_ticks, runs_fast } },
        description_suffix: ` The window cycle time is not a whole number of ticks (${window_cycle_ticks.toFixed(3)}) and has no subtick clock of a small `
            + `enough scale, so this clock runs it rounded down to ${rounded_ticks} ticks, ${fastPercent(runs_fast)} faster than the target`
            + (rounded_trial !== null
                ? `: within the ${fastPercent(ROUNDED_CLOCK_MAX_FAST)} a rounded clock may run and what the machines make, so it is checked on its own ${rounded_ticks}-tick window cycle.`
                : not_tried_on_its_window_cycle !== null
                    ? `; it could not be tried on its own window cycle (${(not_tried_on_its_window_cycle as string).replace(/\.$/, "")}), so the clock-only check models the exact window cycle.`
                    : `, ${within_machines ? `more than the ${fastPercent(ROUNDED_CLOCK_MAX_FAST)} a rounded clock may run` : "more than the machines make"}; `
                    + "the clock-only check models the exact window cycle."),
        result: rounded_trial?.result ?? result,
        rounded,
    })] };
}

/** The sentence for a clock under which a copy loses swings on a lane the copies share, with a space before it; empty for any other */
function sharedLaneLossNote(losses: readonly SharedLaneLoss[]): string {
    return losses.length === 0 ? "" : ` It is not stable on a lane its copies share. ${losses[0].text}`;
}

/** A share as a percentage the labels print: "0.02%", "1.14%", "under 0.01%" */
function fastPercent(share: number): string {
    const percent = share * 100;
    return percent < 0.005 ? "under 0.01%" : `${Number(percent.toFixed(2))}%`;
}

/**
 * Items a second the machines that make the target item can make together, over all copies: each one's main product
 * rate as its Yield trait gives it, as a decimal, added up in the order the entity registry holds the machines
 */
export function outputCapacityPerSecond(config: Config): number {
    const item = TargetProductionRate.fromConfig(config.setpoint).machine_production_rate.item;
    return machinesInOrder(config, traitsOf(config)).map(machine => machine.yield.results[0])
        .filter(main => main.item === item)
        .reduce((sum, main) => sum + decimalOf(main.per_second), 0) * (config.setpoint.copies ?? 1);
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
    // the primary clock is made here, before its run: the ways its constructions offer are the primary run's parts
    const { value: definition, parts: primary_ways } = collectingParts(() => primaryDefinition(config, options, options.on_progress_detail));
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
        without_in_loop_windows: () => primaryDefinition(config, { ...options, loop_windows: "out-of-loop" }, options.on_progress_detail),
    };
    const context: ClockAlternativeContext = {
        ...(result.primitive_round_robin_polling === undefined ? {} : { secondary_planning: {
            source: "primitive-primary" as const, terminal_swing_count: result.primitive_round_robin_polling.terminal_swing_count } }),
        swings: terminalCountForAlternativePlanning(result),
        planned_swings: result.primitive_round_robin_polling?.terminal_swing_count ?? result.swing_backoff_report?.window_cycle_limit_pruning?.requested_terminal_swing_count
            ?? result.swing_backoff_report?.initial_terminal_swing_count,
        primary_stable: holds(result),
        window_cycle_ticks: result.simulation_duration.ticks,
        ...((result.primitive_round_robin_polling !== undefined || result.swing_backoff_report?.primitive_grouped_attempt !== undefined) && { primitive_tried: true }),
        ...(result.exhaust !== undefined && { exhaust: true }),
        ...(fractionalMakesThePrimary(config, definition, result) && { fractional_is_primary: true as const }),
    };
    const tasks: ClockAlternativeTask[] = [...runnable(alternativeDefinitions(config, context, {}), options)
        .map(definition => ({
            id: definition.id, label: definition.label, only_when_needed: onlyWhenNeeded(definition, config),
            ...(definition.fallback === true ? { fallback: true } : {}),
            ...(isExplored(definition.strategy) && { explored: true as const }),
        })), ...(options.explore_strategies === true || !isExplored("coordinated_sources") ? [{
            id: COORDINATED_SOURCES_MAKER, label: COORDINATED_SOURCES_LABEL, only_when_needed: false, coordinated_sources: true as const,
            ...(isExplored("coordinated_sources") && { explored: true as const }),
        }] : [])];
    on_tasks?.(context, tasks, clockVerificationSignature(config, result));
    const primary_run = runAlternative(primary, config, logger, options.on_progress_detail, undefined, undefined, options.on_not_made);
    return { primary: primary_run === null ? null : withParts(primary_run, config, primary_ways), context, tasks };
}

/**
 * Whether the "Euclidean Swings" alternative would make the primary clock again, and so the same run with nothing to
 * add: its first plan starts where the machines' crafts put it, at the primary's own count, whole, with every inserter's
 * hands a cycle whole, so that it is the primary's plan; the primary held on that first plan, with nothing tried after
 * it (no lower count, no window cycle limit, no room for fuel, no loop windows, no chest drill windows to fall back from), so
 * the alternative's run, which keeps the room for one hand where the clock holds with it, makes the same clock; and its
 * checks are those of the primary's, which planning them with fractional swings does not change. Then its clock is the
 * primary's, and is merged into it. Where the primary keeps the room inside its windows (`withHandRoomInside`), the
 * alternative's run makes the same windows with the room added after them, which the primary beats on wake-ups: it is
 * left out as well.
 */
function fractionalMakesThePrimary(config: Config, primary: AlternativeDefinition, result: BlueprintGenerationResult): boolean {
    const start = fractionalStartOf(result.output_cycle_plan)?.toDecimal();
    const report = result.swing_backoff_report;
    return primary.id === "planned-belt-slack" && holds(result) && config.setpoint.counts !== "destroyed"
        && config.overrides?.terminal_swing_count === undefined
        && report !== undefined && !report.triggered && report.window_cycle_limit_pruning === undefined && report.primitive_grouped_attempt === undefined
        && !takesFuelOffABelt(config)
        && result.loop_windows === undefined && !hasPlannedChestDrill(config)
        && start !== undefined && Number.isInteger(start) && start === result.used_terminal_swing_count
        && EntityTransferCountMap.lcm(result.output_cycle_plan.entity_transfer_map) === 1
        && !fractionalSwingsChangeChecksOf(config, result);
}

/**
 * The label of an alternative with the output swings each output cycle it ended up with, e.g. "Takt Batches: 6 output swings
 * each output cycle", or, for a target that counts an item destroyed, the hands of it brought in each output cycle
 * ("Time-Division Windows: 5 hands brought in each output cycle"). The alternatives named after a swing count already say it.
 */
function withOutputSwings(definition: Pick<AlternativeDefinition, "label" | "strategy" | "offers_output_count">, strategy: ClockStrategy, swings: number, counts?: TargetCounts): string {
    // the name of the strategy the run made, in place of the one the label was written with (batched swings: Takt Batches or Round-Robin Polling)
    const label = withResolvedName(definition, definition.label, strategy);
    if (definition.offers_output_count === true) {
        return label;
    }
    const count = Number.isInteger(swings) ? `${swings}` : swings.toFixed(2).replace(/0+$/, "");
    return counts === "destroyed" ? `${label}: ${count} hand${swings === 1 ? "" : "s"} brought in each output cycle`
        : `${label}: ${count} output swing${swings === 1 ? "" : "s"} each output cycle`;
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
    const definition = runnable(alternativeDefinitions(config, context, quietOptions(options, logger, options.on_progress_detail)), options)
        .find(it => it.id === task_id);
    assert(definition !== undefined, `Unknown clock task "${task_id}"`);
    return runAlternative(definition, config, logger, options.on_progress_detail, new Set(assessed_signatures), undefined, options.on_not_made, !context.primary_stable);
}

/** The id of the per-branch clock (DESIGN D7) */
export const COORDINATED_SOURCES_MAKER = "per-branch";
const COORDINATED_SOURCES_LABEL = nameOf("coordinated_sources");
const COORDINATED_SOURCES_DESCRIPTION = "The inserters of each source use the enable windows of one other clock made for the build, on one shared window cycle. "
    + "A source is a machine, belt or chest that inserters take from. The generator sets the sources one at a time, from the output "
    + "upstream. It keeps the setting with the smallest number of wakeups for the full clock, until no source changes.";

/**
 * Makes the per-branch clock (candidates/coordinated-sources.ts) from the parts of the runs before it and the clock they recommend
 * (`coordinatedSourcesInputOf`), checked as every alternative is; listed only where it is stable and another clock than those runs'
 * (`assessed_signatures`). A clock made that is not stable is not listed: it goes to `options.on_not_made` with what its check
 * found, and the task gives null. Null also where there is nothing to compose.
 */
export function runCoordinatedSourcesTask(
    config: Config,
    input: CoordinatedSourcesInput,
    options: GenerateClockOptions = {},
    assessed_signatures: readonly string[] = [],
): ClockAlternativeRun | null {
    return withRunMemo(() => {
        const logger = options.logger ?? defaultLogger;
        const quiet = quietOptions(options, logger, options.on_progress_detail);
        const beside_sources = input.parts.find(part => part.alternative_id === input.recommended_id)?.strategy;
        const run = runAlternativeOf({ id: COORDINATED_SOURCES_MAKER, label: COORDINATED_SOURCES_LABEL, description: COORDINATED_SOURCES_DESCRIPTION, strategy: "coordinated_sources",
            ...(beside_sources !== undefined && { beside_sources }), run: () => coordinatedSourcesClock(config, input, { ...quiet, logger }) }, config, logger, options.on_progress_detail, new Set(assessed_signatures), undefined, undefined, false);
        const listed = run?.alternatives.filter(it => it.verdict === "stable") ?? [];
        if (run !== null && run.alternatives.length > 0 && listed.length === 0) {
            options.on_not_made?.({ id: COORDINATED_SOURCES_MAKER, label: COORDINATED_SOURCES_LABEL, reason: notStableReason(run.alternatives) });
        }
        return run === null || listed.length === 0 ? null : { ...run, alternatives: listed };
    });
}

/** What the check found of a clock made that is not stable, for its entry in `not_made`: each alternative made, on its window cycle */
function notStableReason(alternatives: readonly ClockAlternative[]): string {
    return alternatives.map(({ id, result, assessment }) => {
        const found = (assessment.holds ? "" : " It does not reach its expected output.")
            + (assessment.start_dependence !== null && assessment.start_dependence.verdict !== "stable" ? " It does not reach it from every start." : "")
            + sharedLaneLossNote(assessment.shared_lane_losses ?? [])
            + (assessment.disturbance_trial?.survives === false ? " It does not get back from a loss." : "");
        return `${alternatives.length > 1 ? `${id}: m` : "M"}ade on ${Number(result.simulation_duration.ticks.toFixed(3))} ticks and not stable.${found}`;
    }).join(" ");
}

/** The signatures of every run and the runs listed after it, for a run that must not make one of their clocks again */
function signaturesOf(runs: readonly (ClockAlternativeRun | null)[]): string[] {
    const out: string[] = [];
    const walk = (run: ClockAlternativeRun) => { out.push(run.signature); run.also?.forEach(walk); };
    for (const run of runs) if (run !== null) walk(run);
    return out;
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
 * Generates the same config several ways (batched swings, derived
 * per-craft windows, fractional swings toggled, lower output swing counts, full-hand output) and checks each
 * with the clock-only simulation from several start phases. Alternatives with identical windows are listed once.
 *
 * The four searches come last and only run when none of the clocks made before them can be selected as stable
 * (`searchesAreNeeded`), unless the config asks for them on every build (`overrides.search_for_fewer_wake_ups`);
 * where one can, the two that can still improve on it run on a short window cycle where it has wake-ups (`searchesToRun`).
 * After them, on a config whose belts have backpressure, a clock made for a moving belt, when still none can. The
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
    let current_step = TAKT_BATCHES;
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
        const {disturbance_trial, disturbance_trial_not_tried, start_dependence} = plan.primary.alternatives[0].assessment;
        verification_cache.set(plan.primary.signature, {disturbance_trial, disturbance_trial_not_tried, start_dependence});
    }
    const known_stable = (id: string) => stable_by_id.get(id);
    const all_definitions = runnable(alternativeDefinitions(config, plan.context, quietOptions(options, logger, report), known_stable), options);
    // the explored ones are made after every shipped one and take no part in choosing what is made or selected (see exploredRuns)
    const definitions = all_definitions.filter(definition => !isExplored(definition.strategy));
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
    const searched = searches.length === 0 ? [] : searchesToRun(runs, it => it.ranking, searches, plan.context.window_cycle_ticks);
    const not_searched = searches.filter(it => !searched.includes(it));
    total += searched.length;
    generate(searched);
    if (not_searched.length > 0) {
        logger.log(`Not searched (${not_searched.map(it => it.label).join(", ")}): a clock made without a search is stable. `
            + "Set overrides.search_for_fewer_wake_ups to search for one with fewer wakeups.");
    }
    // last, a clock for another belt than the config's, where nothing made so far can be selected as stable
    if (fallbacks.length > 0 && searchesAreNeeded(runs, it => it.ranking)) {
        total += fallbacks.length;
        generate(fallbacks);
    }
    // and after every other clock, the per-branch clock, composed from their parts on the window cycle of the one they recommend
    const so_far = combineClockAlternativeRuns(runs, it => it.ranking);
    const recommended = so_far.alternatives[so_far.selected_index];
    if (recommended !== undefined && !isExplored("coordinated_sources")) {
        current_step = COORDINATED_SOURCES_LABEL;
        total++;
        report();
        runs.push(runCoordinatedSourcesTask(config, coordinatedSourcesInputOf(runs, recommended.id), { ...options, on_progress_detail: report, on_not_made }, signaturesOf(runs)));
        completed++;
    }

    // the explored strategies last, from the same runs: the selection below is of the shipped runs only
    const explored = options.explore_strategies !== true ? undefined : exploredRuns({ config, logger, report, definitions: all_definitions.filter(it => isExplored(it.strategy)),
        shipped: runs, recommended_id: recommended?.id, verification_cache, settle_unstable: !plan.context.primary_stable, options });

    current_step = "Done";
    report();
    const combined = combineClockAlternativeRuns(runs, it => it.ranking);
    return {
        ...combined,
        skipped_searches: not_searched.map(it => it.label),
        ...startDependenceSummary(config, combined.alternatives),
        not_made,
        why_not_stable: whyNotStableOf(config, combined.alternatives, combined.selected_index, not_made),
        ...(explored !== undefined && { explored: exploredClocksOf(combined.alternatives[combined.selected_index], explored.runs, explored.same_as_shipped) }),
    };
}

/**
 * Makes the clocks of the explored strategies (`STRATEGY_STATUS`), each one whether or not a shipped run would have waited for it: an
 * explore generation is asked for to see them. They are made after every shipped run and read what those made, so that nothing they make
 * reaches a shipped run; a clock a shipped run made too is not assessed again.
 */
function exploredRuns(input: {
    config: Config;
    logger: Logger;
    report: (detail?: string) => void;
    definitions: AlternativeDefinition[];
    shipped: (ClockAlternativeRun | null)[];
    /** The clock the shipped runs recommend, which Coordinated Sources composes from when it is explored */
    recommended_id: string | undefined;
    verification_cache: Map<string, VerificationAssessment>;
    settle_unstable: boolean;
    options: GenerateClockOptions;
}): { runs: (ClockAlternativeRun | null)[]; same_as_shipped: string[] } {
    const { config, logger, report, options } = input;
    // a copy: what an explored run learns about a clock is not looked up by a shipped run
    const verification_cache = new Map(input.verification_cache);
    const shipped_signatures = signaturesOf(input.shipped);
    const same_as_shipped: string[] = [];
    const runs: (ClockAlternativeRun | null)[] = [];
    const made = (id: string, run: ClockAlternativeRun | null) => {
        if (run !== null && run.alternatives.length === 0) same_as_shipped.push(id);
        runs.push(run);
    };
    for (const definition of input.definitions) {
        report(definition.label);
        // not_made is the shipped runs' list, which says why the selected clock is not stable
        made(definition.id, runAlternative(definition, config, logger, report, new Set(shipped_signatures), verification_cache, undefined, input.settle_unstable));
    }
    if (isExplored("coordinated_sources") && input.recommended_id !== undefined) {
        report(COORDINATED_SOURCES_LABEL);
        made(COORDINATED_SOURCES_MAKER, runCoordinatedSourcesTask(config, coordinatedSourcesInputOf(input.shipped, input.recommended_id),
            { ...options, on_progress_detail: report, on_not_made: undefined }, shipped_signatures));
    }
    return { runs, same_as_shipped };
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
        target_items_per_second: config.setpoint.items_per_second,
        backed_up_belts: everyInputLaneIsDeadEnd(config),
        not_made,
    });
}
