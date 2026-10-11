import { Config } from "../../config";
import { alwaysEnabledInserters } from "../sequence/unplanned-inserter-clock";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { OpenRange } from "../../data-types";
import { InserterStatus } from "../../state";
import { InventoryTransferHistory } from "../sequence/inventory-transfer-history";
import { Logger } from "../../common/logger";
import { CheckedShiftRow } from "../candidates/shifted-swings";
import { CIRCUIT_LATENCY_TICKS, rotateRanges, withBeltPickupSlack } from "../clock";
import { TrialRun, alwaysEnabledByConfig, windowsFromHistory } from "../plan/plan-run";
import { AS_BUILT_START_PHASES, AsBuiltStabilityCheck, FULL_CHECK_START_PHASES, runAsBuiltCheck, runClockOnBuild } from "../trial";


export interface DerivedClockWindowsReport {
    /** Whether the blueprint's windows (planned or derived) pass the as-built check */
    succeeded: boolean;
    /** True when the planned windows already passed the as-built check from every start phase, so nothing was derived */
    kept_planned_windows: boolean;
    /** Ticks added to the end of every derived window; null when nothing was derived or derivation failed */
    end_padding_ticks: number | null;
    /** Machine-to-machine inserters whose observed windows were replaced by brief full-hand windows */
    full_hand_inserters?: string[];
    /** With derive_mode "uneven_output": the output swing moved off its planned start and by how many ticks (negative is earlier) */
    moved_output_swing?: { swing: number; shift_ticks: number; shifts_checked: CheckedShiftRow[] };
}

/** End padding candidates tried in order; a candidate is only used when the next one also passes, for margin */
const DERIVED_WINDOW_END_PADDING_CANDIDATES = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16];


const INSERTER_BUSY_STATUSES = new Set<string>([
    InserterStatus.PICKUP,
    InserterStatus.SWING,
    InserterStatus.DROP_OFF,
    InserterStatus.TARGET_FULL,
    InserterStatus.WAITING_FOR_SINK,
]);

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
    const even_output_windows = evenlySpacedOutputWindows(output_windows, derivation, period);
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

    const attempts: { padding: number; result: TrialRun; check: AsBuiltStabilityCheck; windows: Map<string, OpenRange[]> }[] = [];
    for (const padding of DERIVED_WINDOW_END_PADDING_CANDIDATES) {
        const padded = new Map(fixed_windows);
        for (const [key, ranges] of busy_windows) {
            padded.set(key, OpenRange.reduceRanges(ranges.map(r =>
                OpenRange.from(r.start_inclusive, Math.min(r.end_inclusive + padding, period - 1))
            )));
        }
        const windows = withBeltPickupSlack(padded, belt_pickup_slack, period);
        const { result, check } = runAsBuiltCheck(base_config, windows, period, logger, AS_BUILT_START_PHASES,
            (n, total) => report?.(`Trying ${padding} tick${padding === 1 ? "" : "s"} of padding (${label} windows), clock start ${n}/${total}`));
        logger.log(`Derived clock windows (${label}): end padding ${padding} -> actual=${check.actual_output_items} stable=${check.holds} (${check.start_phases_checked} start phases)`);
        attempts.push({ padding, result, check, windows });

        const previous = attempts[attempts.length - 2];
        if (previous?.check.holds && check.holds) {
            if (!confirm) {
                return { windows, end_padding_ticks: padding, verification: result, as_built: check, even_output_windows };
            }
            // failing start phases can be a narrow band the quick check skips over
            const full = runAsBuiltCheck(base_config, windows, period, logger, FULL_CHECK_START_PHASES,
                (n, total) => report?.(`Confirming ${padding} tick${padding === 1 ? "" : "s"} of padding (${label} windows), clock start ${n}/${total}`)).check;
            logger.log(`Derived clock windows (${label}): end padding ${padding} full check -> actual=${full.actual_output_items} stable=${full.holds} (${full.start_phases_checked} start phases)`);
            if (full.holds) {
                return { windows, end_padding_ticks: padding, verification: result, as_built: full, even_output_windows };
            }
            check.holds = false;
            check.actual_output_items = full.actual_output_items;
            check.failed_start_offset = full.failed_start_offset;
            check.repeat_periods = full.repeat_periods;
            check.repeat_output_items = full.repeat_output_items;
        }
    }

    const best = attempts.reduce((a, b) => b.check.actual_output_items > a.check.actual_output_items ? b : a);
    return { windows: null, end_padding_ticks: null, verification: best.result, as_built: best.check, even_output_windows };
}

/**
 * The output inserters' swings spread evenly over the period, one swing per window. Windows are the shortest
 * planned window minus the circuit latency, since the game keeps the inserter enabled that much longer and
 * a longer window lets it return and grab a partial stack. Null when that would not change anything or cannot be built.
 */
function evenlySpacedOutputWindows(
    output_windows: Map<string, OpenRange[]>,
    derivation: TrialRun,
    period: number,
): Map<string, OpenRange[]> | null {
    if (!Number.isInteger(period)) {
        return null;
    }
    const swing_counts = new Map<string, number>();
    for (const entity of derivation.serializable_state_transition_history.entities) {
        if (!output_windows.has(entity.entity_id)) {
            continue;
        }
        const sorted = [...entity.transitions].sort((a, b) => a.tick - b.tick);
        let status = entity.initial_status;
        let swings = 0;
        for (const transition of sorted) {
            if (transition.tick >= 1 && transition.tick <= period && transition.to_status === InserterStatus.DROP_OFF && status !== InserterStatus.DROP_OFF) {
                swings++;
            }
            status = transition.to_status;
        }
        swing_counts.set(entity.entity_id, swings);
    }

    const even = new Map<string, OpenRange[]>();
    let changed = false;
    for (const [key, ranges] of output_windows) {
        const swings = swing_counts.get(key) ?? 0;
        if (swings === 0 || ranges.length === 0) {
            return null;
        }
        const length = Math.min(...ranges.map(r => r.end_inclusive - r.start_inclusive + 1)) - CIRCUIT_LATENCY_TICKS;
        if (length < 1 || length >= period / swings) {
            return null;
        }
        const first = ranges[0].start_inclusive;
        const spaced: OpenRange[] = [];
        for (let k = 0; k < swings; k++) {
            spaced.push(...rotateRanges([OpenRange.from(first, first + length - 1)], Math.round(k * period / swings), period));
        }
        const reduced = OpenRange.reduceRanges(spaced);
        changed ||= reduced.length !== ranges.length || reduced.some((r, i) => r.start_inclusive !== ranges[i].start_inclusive || r.end_inclusive !== ranges[i].end_inclusive);
        even.set(key, reduced);
    }
    return changed ? even : null;
}

/** Busy ticks of a simulated inserter as decider windows (shifted back by the circuit latency) */
function busyDeciderRanges(
    initial_status: string,
    transitions: { tick: number; to_status: string }[],
    period: number,
): OpenRange[] {
    // manual lcm overrides can produce fractional periods; the simulation runs whole ticks up to the ceiling
    const ticks = Math.ceil(period);
    const busy = new Array<boolean>(ticks).fill(false);
    const sorted = [...transitions].sort((a, b) => a.tick - b.tick);
    let status = initial_status;
    let next = 0;
    // simulated clock ticks run 1..period, matching the clocked controls
    for (let tick = 1; tick <= ticks; tick++) {
        while (next < sorted.length && sorted[next].tick <= tick) {
            status = sorted[next].to_status;
            next++;
        }
        if (INSERTER_BUSY_STATUSES.has(status)) {
            busy[(((tick - CIRCUIT_LATENCY_TICKS) % ticks) + ticks) % ticks] = true;
        }
    }

    const ranges: OpenRange[] = [];
    let start: number | null = null;
    for (let tick = 0; tick <= ticks; tick++) {
        if (tick < ticks && busy[tick]) {
            start ??= tick;
        } else if (start !== null) {
            ranges.push(OpenRange.from(start, tick - 1));
            start = null;
        }
    }
    return ranges;
}

/**
 * Simulates the factory driven only by the given decider windows, first with the clock as planned and then
 * with the whole clock shifted to other start offsets relative to the machines' initial state.
 * Fractional periods are only checked unshifted.
 */
