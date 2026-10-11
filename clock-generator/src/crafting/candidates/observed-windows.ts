import { Config } from "../../config";
import { alwaysEnabledInserters } from "../sequence/unplanned-inserter-clock";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { OpenRange } from "../../data-types";
import { InventoryTransferHistory } from "../sequence/inventory-transfer-history";
import { Logger } from "../../common/logger";
import { CheckedShiftRow } from "../candidates/shifted-swings";
import { withBeltPickupSlack } from "../clock";
import { BlueprintGenerationResult, GenerateClockOptions, TrialRun, alwaysEnabledByConfig, clockOfPlan, clockOnlyRunOf, exportClock, planRun, windowsFromHistory } from "../plan/plan-run";
import { AS_BUILT_START_PHASES, AsBuiltStabilityCheck, FULL_CHECK_START_PHASES, runAsBuiltCheck, runClockOnBuild, trialWithOutputFeeders } from "../trial";
import { fullHandTransferWindows } from "./full-hand";
import { search } from "./search";
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
    /** For uneven output swings: the output swing moved off its planned start and by how many ticks (negative is earlier) */
    moved_output_swing?: { swing: number; shift_ticks: number; shifts_checked: CheckedShiftRow[] };
}

/** End padding candidates tried in order; a candidate is only used when the next one also passes, for margin */
const DERIVED_WINDOW_END_PADDING_CANDIDATES = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16];


/**
 * Derives clock windows by simulating with only the output inserters clocked (their planned windows)
 * and every other inserter free, then turning each inserter's busy time (pickup through return swing)
 * into a decider window. Windows are padded and accepted only if a clock-only simulation stays stable.
 * Drills keep their planned windows.
 */
export function deriveClockWindows(
    config: Config,
    planned_history: InventoryTransferHistory,
    output_inserter_ids: Set<string>,
    belt_pickup_slack: Map<string, number>,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
): {
    windows: Map<string, OpenRange[]> | null;
    end_padding_ticks: number | null;
    verification: TrialRun | null;
    as_built: AsBuiltStabilityCheck | null;
} {
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const planned_windows = windowsFromHistory(planned_history, createEntityRegistryFromConfig(config), alwaysEnabledByConfig(config));
    const output_windows = new Map(Array.from(planned_windows).filter(([key]) => output_inserter_ids.has(key)));
    // drills only report WORKING/DISABLED, so their activity gives no useful window to derive
    const drill_windows = new Map(Array.from(planned_windows).filter(([key]) => key.startsWith("drill:")));

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

/** One padding tried: the windows at that padding and the quick clock-only check of them */
interface PaddingAttempt {
    windows: Map<string, OpenRange[]>;
    result: TrialRun;
    check: AsBuiltStabilityCheck;
}

/**
 * The build run free under the output windows given, each other inserter's busy ticks read off the run as its windows,
 * and the padding of their ends searched: the paddings are tried in order with the quick clock-only check, and a
 * padding is used as soon as it and the one before it pass, for margin. With `confirm` the pick is confirmed from
 * many more start phases, and when that fails the search goes on to the next paddings. When no padding passes, the
 * one that moved the most is reported.
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
    /** Confirm the accepted padding from many more start phases; a caller comparing several results confirms its pick itself */
    confirm: boolean = true,
): {
    windows: Map<string, OpenRange[]> | null;
    end_padding_ticks: number | null;
    verification: TrialRun | null;
    as_built: AsBuiltStabilityCheck | null;
    even_output_windows: Map<string, OpenRange[]> | null;
} {
    const fixed_windows = new Map([...output_windows, ...drill_windows]);
    report?.(`Simulating with only the output inserters clocked (${label} windows)`);
    const derivation = runClockOnBuild(base_config, fixed_windows, period, logger);
    logger.log(`Derived clock windows (${label}): output-only run actual=${derivation.stability_check.actual_output_items} expected=${derivation.stability_check.expected_output_items}`);
    const even_output_windows = evenlySpacedOutputWindows(output_windows, outputSwingCountsOf(derivation, new Set(output_windows.keys()), period), period);
    if (!derivation.stability_check.holds) {
        return { windows: null, end_padding_ticks: null, verification: derivation, as_built: null, even_output_windows };
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
    const ticks = (padding: number) => `${padding} tick${padding === 1 ? "" : "s"}`;

    const { picked, tried } = search<number, PaddingAttempt, Omit<ReturnType<typeof deriveWithOutputWindows>, "even_output_windows">>({
        candidates: DERIVED_WINDOW_END_PADDING_CANDIDATES,
        quick: padding => {
            const windows = withBeltPickupSlack(paddedWindows(unpadded, busy_windows.keys(), padding, period), belt_pickup_slack, period);
            const { result, check } = runAsBuiltCheck(base_config, windows, period, logger, AS_BUILT_START_PHASES,
                (n, total) => report?.(`Trying ${ticks(padding)} of padding (${label} windows), clock start ${n}/${total}`));
            logger.log(`Derived clock windows (${label}): end padding ${padding} -> actual=${check.actual_output_items} stable=${check.holds} (${check.start_phases_checked} start phases)`);
            return { windows, result, check };
        },
        // a padding is used when it and the one before pass; a padding whose confirmation failed counts as failed
        picks: (attempts, done) => {
            const [previous, last] = [attempts[attempts.length - 2], attempts[attempts.length - 1]];
            return !done && previous?.quick.check.holds && last.quick.check.holds ? [last.index] : [];
        },
        confirm: ({ candidate: padding, quick: { windows, result, check } }) => {
            if (!confirm) {
                return { windows, end_padding_ticks: padding, verification: result, as_built: check };
            }
            // failing start phases can be a narrow band the quick check skips over
            const full = runAsBuiltCheck(base_config, windows, period, logger, FULL_CHECK_START_PHASES,
                (n, total) => report?.(`Confirming ${ticks(padding)} of padding (${label} windows), clock start ${n}/${total}`)).check;
            logger.log(`Derived clock windows (${label}): end padding ${padding} full check -> actual=${full.actual_output_items} stable=${full.holds} (${full.start_phases_checked} start phases)`);
            if (full.holds) {
                return { windows, end_padding_ticks: padding, verification: result, as_built: full };
            }
            check.holds = false;
            check.actual_output_items = full.actual_output_items;
            check.failed_start_offset = full.failed_start_offset;
            check.repeat_periods = full.repeat_periods;
            check.repeat_output_items = full.repeat_output_items;
            return null;
        },
    });
    if (picked !== null) {
        return { ...picked, even_output_windows };
    }
    const best = tried.map(it => it.quick).reduce((a, b) => b.check.actual_output_items > a.check.actual_output_items ? b : a);
    return { windows: null, end_padding_ticks: null, verification: best.result, as_built: best.check, even_output_windows };
}

/**
 * The observed windows candidate: the clock of the plan with the windows of every inserter but the output inserters
 * made anew from what it does in a run of the build under the output windows alone (see `deriveClockWindows`), and
 * for machine-to-machine inserters that wait at their source for a full hand, brief windows that find one
 * (`fullHandTransferWindows`). With `mode` "prefer_planned" the planned windows stay where they pass the clock-only
 * check from every start phase, which is what the config override `derive_clock_windows` asks for; "always" derives
 * anyway; "uneven_output" derives with one output swing moved off its planned start (`deriveUnevenOutputClockWindows`).
 * The feeders of the output machine are kept or dropped as for a planned clock. When nothing derived passes, the
 * planned windows are exported with the report of what was tried.
 */
export function observedWindowsClock(
    config: Config,
    options: GenerateClockOptions = {},
    mode: "prefer_planned" | "always" | "uneven_output" = "prefer_planned",
): BlueprintGenerationResult {
    const plan = planRun(config, options);
    const clock = clockOfPlan(plan, options);
    const { logger, run } = plan;
    const { stability_check, duration, final_history, output_inserter_ids, output_machine_state_machines, all_output_inserters, simulation_context } = run;
    const planned_windows = clock.windows;
    const output_machine_ids = new Set(all_output_inserters.map(os => os.inserter.source.entity_id.id));
    const planned_stable = stability_check.holds;
    const non_deriving_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const planned_run = runAsBuiltCheck(non_deriving_config, planned_windows, duration.ticks, logger, AS_BUILT_START_PHASES,
        (n, total) => options.on_progress_detail?.(`Checking planned windows, clock start ${n}/${total}`));
    let planned_check = planned_run.check;
    let clock_only_run = clockOnlyRunOf(planned_run.result);
    if (planned_stable && planned_check.holds) {
        planned_check = runAsBuiltCheck(non_deriving_config, planned_windows, duration.ticks, logger, FULL_CHECK_START_PHASES,
            (n, total) => options.on_progress_detail?.(`Confirming planned windows, clock start ${n}/${total}`)).check;
    }
    logger.log(`Derived clock windows: planned windows as-built actual=${planned_check.actual_output_items} stable=${planned_check.holds} (${planned_check.start_phases_checked} start phases)`);
    // the feeders of the output machine are part of the planned windows, kept or dropped here as without derivation
    const feedPlanned = () => {
        const fed = planned_stable && planned_check.holds
            ? trialWithOutputFeeders(non_deriving_config, planned_windows, duration.ticks, output_machine_ids, { check: planned_check, stock: planned_run.stock },
                planned_check.start_phases_checked > AS_BUILT_START_PHASES ? FULL_CHECK_START_PHASES : AS_BUILT_START_PHASES, logger, options.on_progress_detail)
            : null;
        if (fed !== null) {
            planned_check = fed.check;
            clock_only_run = clockOnlyRunOf(fed.result);
        }
        return fed;
    };
    const exportPlanned = (fed: ReturnType<typeof feedPlanned>, derived_clock_windows: DerivedClockWindowsReport): BlueprintGenerationResult =>
        exportClock(plan, clock, fed?.windows ?? planned_windows, options,
            { clock_only_run, output_feeders: fed?.output_feeders, item_names: fed?.item_names, derived_clock_windows });
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
    const derived = mode === "uneven_output"
        ? uneven ?? { windows: null, end_padding_ticks: null, verification: null, as_built: null }
        : deriveClockWindows(config, final_history, output_inserter_ids, clock.belt_pickup_slack, duration.ticks, logger, options.on_progress_detail);
    const report: DerivedClockWindowsReport = {
        succeeded: derived.windows !== null,
        kept_planned_windows: false,
        end_padding_ticks: derived.end_padding_ticks,
        moved_output_swing: uneven?.moved_output_swing ?? undefined,
    };
    stability_check.as_built = derived.as_built ?? undefined;
    stability_check.holds = stability_check.holds && derived.windows !== null;

    if (derived.windows !== null && derived.verification !== null) {
        const full_hand = fullHandTransferWindows(non_deriving_config, derived.windows, derived.verification,
            output_inserter_ids, simulation_context.entity_registry, duration.ticks, logger, options.on_progress_detail);
        const windows = full_hand?.windows ?? derived.windows;
        if (full_hand) {
            stability_check.as_built = full_hand.check;
            report.full_hand_inserters = full_hand.inserters;
        }
        // observed windows are what the inserters did, fuel hands included, and the run shown is the trial of them
        return exportClock(plan, clock, windows, options,
            { histories: full_hand?.result ?? derived.verification, fuel_hand_room_ticks: {}, derived_clock_windows: report });
    }
    logger.log("Derived clock windows: no padding passed the as-built check; falling back to the planned windows.");
    const fed = feedPlanned();
    stability_check.as_built = planned_check;
    stability_check.holds = planned_stable && planned_check.holds;
    return exportPlanned(fed, report);
}
