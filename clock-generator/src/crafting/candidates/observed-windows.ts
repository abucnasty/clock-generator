import { Config } from "../../config";
import { alwaysEnabledInserters } from "../sequence/unplanned-inserter-clock";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { OpenRange } from "../../data-types";
import { EntityId } from "../../entities";
import { InventoryTransferHistory } from "../sequence/inventory-transfer-history";
import { Logger } from "../../common/logger";
import { withBeltPickupSlack } from "../clock";
import { BlueprintGenerationResult, GenerateClockOptions, TrialRun, alwaysEnabledByConfig, clockOfPlan, clockOnlyRunOf, exportClock, planRun, windowsFromHistory } from "../plan/plan-run";
import { AS_BUILT_START_PHASES, AsBuiltRun, AsBuiltStabilityCheck, FREE_RUNNING_CHECK_TICKS, FULL_CHECK_START_PHASES, runAsBuiltCheck, runClockOnBuild, trialWithLoopWindows } from "../trial";
import { fullHandTransferWindows } from "./full-hand";
import { Confirmed, QuickTrial, SearchReport, confirm, quickTrial, search } from "./search";
import { busyDeciderRanges, evenlySpacedOutputWindows, outputSwingCountsOf, paddedWindows } from "./transforms";
import { deriveUnevenOutputClockWindows } from "./uneven-output";


export interface DerivedClockWindowsReport {
    /** Whether the blueprint's windows (planned or derived) pass the as-built check */
    succeeded: boolean;
    /** True when the planned windows already passed the as-built check from every start phase, so nothing was derived */
    kept_planned_windows: boolean;
    /** Ticks added to the end of every derived window; null when nothing was derived or derivation failed */
    end_padding_ticks: number | null;
    /** Machine-to-machine inserters whose observed windows were replaced by brief full-hand windows */
    full_hand_inserters?: string[];
}

/** End padding candidates, in order */
const DERIVED_WINDOW_END_PADDING_CANDIDATES = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16];

/** What deriving windows under given output windows yields */
export interface DerivedWindows {
    windows: Map<string, OpenRange[]> | null;
    end_padding_ticks: number | null;
    verification: TrialRun | null;
    as_built: AsBuiltStabilityCheck | null;
    /** The output windows spread evenly, when that would change them: a second try for `deriveClockWindows` */
    even_output_windows: Map<string, OpenRange[]> | null;
    /** The quick trial that passed on exactly `windows`, whose early stages a confirmation of them takes over */
    verified?: AsBuiltRun;
    search: SearchReport;
}

/**
 * Derives clock windows by simulating with only the output inserters clocked (their planned windows)
 * and every other inserter free, then turning each inserter's busy time (pickup through return swing)
 * into a decider window. Windows are padded and accepted only if a clock-only simulation stays stable.
 * Drills keep their planned windows.
 */
function deriveClockWindows(
    config: Config,
    planned_history: InventoryTransferHistory,
    output_inserter_ids: Set<string>,
    belt_pickup_slack: Map<string, number>,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
): DerivedWindows {
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const planned_windows = windowsFromHistory(planned_history, createEntityRegistryFromConfig(config), alwaysEnabledByConfig(config));
    const output_windows = new Map(Array.from(planned_windows).filter(([key]) => output_inserter_ids.has(key)));
    // drills only report WORKING/DISABLED, so their activity gives no useful window to derive
    const drill_ids = new Set(Array.from(planned_history.keys()).filter(EntityId.isDrill).map(it => it.id));
    const drill_windows = new Map(Array.from(planned_windows).filter(([key]) => drill_ids.has(key)));

    const planned = deriveWithOutputWindows(base_config, output_windows, drill_windows, output_inserter_ids, belt_pickup_slack, period, "planned output", logger, report);
    if (planned.windows !== null || planned.even_output_windows === null) {
        return planned;
    }
    // Bunched output swings (e.g. a double swing then a long gap) can leave a partial stack in hand when the window closes
    const even = deriveWithOutputWindows(base_config, planned.even_output_windows, drill_windows, output_inserter_ids, belt_pickup_slack, period, "evenly spaced output", logger, report);
    if (even.windows !== null) {
        return even;
    }
    return (even.as_built?.actual_output_items ?? 0) > (planned.as_built?.actual_output_items ?? 0) ? even : planned;
}

/** The clock-only check a single unshifted run stands for, where no check from several start phases was made */
function checkOfRun(run: TrialRun): AsBuiltStabilityCheck {
    return {
        holds: run.stability_check.holds,
        actual_output_items: run.stability_check.actual_output_items,
        start_phases_checked: 1,
        failed_start_offset: run.stability_check.holds ? undefined : 0,
        repeat_periods: run.stability_check.repeat_periods,
        repeat_output_items: run.stability_check.repeat_output_items,
    };
}

/**
 * The build run free under the output windows given, each other inserter's busy ticks read off the run as its windows,
 * and the padding of their ends searched (see search.ts): every padding gets the quick trial, and of those that pass
 * one whose neighbours pass too is confirmed before one whose do not, the smallest of those. Without `confirm_pick`
 * the pick is taken on its quick trial, for a caller that confirms its own pick. When no padding is confirmed, the
 * quick trial that moved the most is reported, as one run from the generator's start.
 */
export function deriveWithOutputWindows(
    base_config: Config,
    output_windows: Map<string, OpenRange[]>,
    drill_windows: Map<string, OpenRange[]>,
    output_inserter_ids: Set<string>,
    belt_pickup_slack: Map<string, number>,
    period: number,
    label: string,
    logger: Logger,
    report?: (detail: string) => void,
    confirm_pick: boolean = true,
): DerivedWindows {
    const fixed_windows = new Map([...output_windows, ...drill_windows]);
    report?.(`Simulating with only the output inserters clocked (${label} windows)`);
    const derivation = runClockOnBuild(base_config, fixed_windows, period, logger);
    logger.log(`Derived clock windows (${label}): output-only run actual=${derivation.stability_check.actual_output_items} expected=${derivation.stability_check.expected_output_items}`);
    const even_output_windows = evenlySpacedOutputWindows(output_windows, outputSwingCountsOf(derivation, new Set(output_windows.keys()), period), period);
    const reportOf = (tried: { candidate: number; quick: QuickTrial }[], picked: number | null): SearchReport => ({
        kind: "padding",
        candidates: tried.map(it => ({ row: 1, setting: it.candidate, holds: it.quick.holds })),
        picked: picked === null ? null : { row: 1, setting: picked },
    });
    if (!derivation.stability_check.holds) {
        return { windows: null, end_padding_ticks: null, verification: derivation, as_built: null, even_output_windows, search: reportOf([], null) };
    }

    const always_enabled_by_config = alwaysEnabledByConfig(base_config);
    // the inserters of a loop stay always enabled, as the plan leaves them (see alwaysEnabledInserters)
    const always_enabled = new Set(alwaysEnabledInserters(createEntityRegistryFromConfig(base_config)).map(it => it.entity_id.id));
    const busy_windows = new Map<string, OpenRange[]>();
    for (const entity of derivation.serializable_state_transition_history.entities) {
        if (entity.entity_type !== "inserter" || output_inserter_ids.has(entity.entity_id)
            || always_enabled_by_config.has(entity.entity_id) || always_enabled.has(entity.entity_id)) {
            continue;
        }
        const ranges = busyDeciderRanges(entity.initial_status, entity.transitions, period);
        if (ranges.length > 0) {
            busy_windows.set(entity.entity_id, ranges);
        }
    }
    const unpadded = new Map([...fixed_windows, ...busy_windows]);
    const ticks = (padding: number) => `${padding} tick${padding === 1 ? "" : "s"} of padding (${label} windows)`;

    const { picked, pick, tried } = search<number, QuickTrial & { windows: Map<string, OpenRange[]>; result: TrialRun; run: AsBuiltRun }, Confirmed>({
        candidates: DERIVED_WINDOW_END_PADDING_CANDIDATES,
        quick: padding => {
            const windows = withBeltPickupSlack(paddedWindows(unpadded, busy_windows.keys(), padding, period), belt_pickup_slack, period);
            report?.(`Trying ${ticks(padding)}`);
            const trial = quickTrial(base_config, windows, period, logger, true);
            logger.log(`Derived clock windows (${label}): end padding ${padding} -> actual=${trial.result.stability_check.actual_output_items} holds=${trial.holds}`);
            return { ...trial, windows };
        },
        neighbours: () => true,
        tieBreak: (a, b) => a.candidate - b.candidate,
        confirm: ({ candidate: padding, quick }) => confirm_pick
            ? confirm(base_config, quick.windows, period, logger, ticks(padding), report, quick.run, true)
            : { result: quick.result, check: checkOfRun(quick.result) },
    });
    if (picked !== null && pick !== null) {
        return { windows: pick.quick.windows, end_padding_ticks: pick.candidate, verification: picked.result, as_built: picked.check, even_output_windows, verified: pick.quick.run, search: reportOf(tried, pick.candidate) };
    }
    const best = tried.map(it => it.quick).reduce((a, b) => b.result.stability_check.actual_output_items > a.result.stability_check.actual_output_items ? b : a);
    return { windows: null, end_padding_ticks: null, verification: best.result, as_built: { ...checkOfRun(best.result), holds: false, failed_start_offset: 0 }, even_output_windows, search: reportOf(tried, null) };
}

/**
 * The observed windows candidate: the clock of the plan with the windows of every inserter but the output inserters
 * made anew from what it does in a run of the build under the output windows alone (see `deriveClockWindows`), and
 * for machine-to-machine inserters that wait at their source for a full hand, brief windows that find one
 * (`fullHandTransferWindows`). With `mode` "prefer_planned" the planned windows stay where they pass the clock-only
 * check from every start phase, which is what the config override `derive_clock_windows` asks for; "always" derives
 * anyway; "uneven_output" derives with one output swing moved off its planned start (`deriveUnevenOutputClockWindows`).
 * The windows of the inserters of a loop are kept or dropped as for a planned clock. When nothing derived passes, the
 * planned windows are exported with the report of what was tried.
 *
 * The clock-only checks made here of the windows observed and of the planned windows judge each moving lane-phase
 * start over its repeating cycle (see runAsBuiltCheck): the windows are read off a run from one lane phase, so they can
 * hold their first period from another and still fall short every few periods. The plan's belt pickup slack is decided
 * as for any planned clock (see clockOfPlan).
 */
export function observedWindowsClock(
    config: Config,
    options: GenerateClockOptions = {},
    mode: "prefer_planned" | "always" | "uneven_output" = "prefer_planned",
): BlueprintGenerationResult {
    const plan = planRun(config, options);
    const clock = clockOfPlan(plan, options);
    const { logger, run } = plan;
    const { stability_check, duration, final_history, output_inserter_ids, output_machine_state_machines, simulation_context } = run;
    const planned_windows = clock.windows;
    const planned_stable = stability_check.holds;
    const non_deriving_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const planned_run = runAsBuiltCheck(non_deriving_config, planned_windows, duration.ticks, logger, AS_BUILT_START_PHASES,
        (n, total) => options.on_progress_detail?.(`Checking planned windows, clock start ${n}/${total}`), FREE_RUNNING_CHECK_TICKS, undefined, true);
    let planned_check = planned_run.check;
    let clock_only_run = clockOnlyRunOf(planned_run.result);
    if (planned_stable && planned_check.holds) {
        // the check just made covered the unshifted run, every pickup phase start and the long run on these windows
        planned_check = runAsBuiltCheck(non_deriving_config, planned_windows, duration.ticks, logger, FULL_CHECK_START_PHASES,
            (n, total) => options.on_progress_detail?.(`Confirming planned windows, clock start ${n}/${total}`),
            FREE_RUNNING_CHECK_TICKS, { run: planned_run, long_run_ticks: FREE_RUNNING_CHECK_TICKS }, true).check;
    }
    logger.log(`Derived clock windows: planned windows as-built actual=${planned_check.actual_output_items} stable=${planned_check.holds} (${planned_check.start_phases_checked} start phases)`);
    // the windows of the inserters of a loop are part of the planned windows, kept or dropped here as without derivation
    const feedPlanned = () => {
        const fed = planned_stable && planned_check.holds
            ? trialWithLoopWindows(non_deriving_config, planned_windows, duration.ticks, { check: planned_check, stock: planned_run.stock },
                planned_check.start_phases_checked > AS_BUILT_START_PHASES ? FULL_CHECK_START_PHASES : AS_BUILT_START_PHASES, logger, options.on_progress_detail, true)
            : null;
        if (fed !== null) {
            planned_check = fed.check;
            clock_only_run = clockOnlyRunOf(fed.result);
        }
        return fed;
    };
    const exportPlanned = (fed: ReturnType<typeof feedPlanned>, derived_clock_windows: DerivedClockWindowsReport, report?: SearchReport): BlueprintGenerationResult =>
        exportClock(plan, clock, fed?.windows ?? planned_windows, options,
            { clock_only_run, loop_windows: fed?.loop_windows, item_names: fed?.item_names, derived_clock_windows, search: report });
    if (planned_stable && planned_check.holds && mode === "prefer_planned") {
        // planned windows keep the plan's batched swings, which derived windows would break into per-craft swings
        const fed = feedPlanned();
        stability_check.as_built = planned_check;
        return exportPlanned(fed, { succeeded: true, kept_planned_windows: true, end_padding_ticks: null });
    }

    const uneven = mode !== "uneven_output" ? null : deriveUnevenOutputClockWindows(
        config, final_history, output_inserter_ids, clock.belt_pickup_slack, duration.ticks,
        Math.min(...output_machine_state_machines.map(it => it.machine_state.machine.crafting_rate.ticks_per_craft)),
        logger, options.on_progress_detail);
    // without a moved swing that works there is nothing to export; plain observed windows are their own alternative
    const derived: Omit<DerivedWindows, "even_output_windows" | "search"> & { search?: SearchReport } = mode === "uneven_output"
        ? uneven ?? { windows: null, end_padding_ticks: null, verification: null, as_built: null }
        : deriveClockWindows(config, final_history, output_inserter_ids, clock.belt_pickup_slack, duration.ticks, logger, options.on_progress_detail);
    const report: DerivedClockWindowsReport = {
        succeeded: derived.windows !== null,
        kept_planned_windows: false,
        end_padding_ticks: derived.end_padding_ticks,
    };
    stability_check.as_built = derived.as_built ?? undefined;
    // the planning run's windows are not this clock's: it holds when its own windows hold, as even hands do. The swing
    // backoff goes by this: on the express moving underground pickups the run the windows are observed in moves 560
    // of 528 a period at 3 output swings, and the windows hold 528 from every start, and do in the game
    stability_check.holds = derived.windows !== null && (derived.as_built?.holds ?? false);

    if (derived.windows !== null && derived.verification !== null) {
        const full_hand = fullHandTransferWindows(non_deriving_config, derived.windows, derived.verification,
            output_inserter_ids, simulation_context.entity_registry, duration.ticks, logger, options.on_progress_detail);
        const windows = full_hand?.windows ?? derived.windows;
        if (full_hand) {
            stability_check.as_built = full_hand.check;
            stability_check.holds = full_hand.check.holds;
            report.full_hand_inserters = full_hand.inserters;
        }
        // observed windows are what the inserters did, fuel hands included, and the run shown is the trial of them
        return exportClock(plan, clock, windows, options,
            { histories: full_hand?.result ?? derived.verification, fuel_hand_room_ticks: {}, derived_clock_windows: report, search: derived.search });
    }
    logger.log("Derived clock windows: no padding passed the as-built check; falling back to the planned windows.");
    const fed = feedPlanned();
    stability_check.as_built = planned_check;
    stability_check.holds = planned_stable && planned_check.holds;
    return exportPlanned(fed, report, derived.search);
}
