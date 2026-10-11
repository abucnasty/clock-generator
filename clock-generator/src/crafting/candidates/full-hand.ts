import { Config } from "../../config";
import { alwaysEnabledInserters } from "../sequence/unplanned-inserter-clock";
import { OpenRange } from "../../data-types";
import { Entity, EntityId, handSizeFor, ReadableEntityRegistry } from "../../entities";
import { InserterStatus, MachineStatus } from "../../state";
import { Logger } from "../../common/logger";
import { rotateRanges } from "../clock";
import { LCM_STABILITY_TOLERANCE, TrialRun } from "../plan/plan-run";
import { AS_BUILT_START_PHASES, AsBuiltStabilityCheck, FULL_CHECK_START_PHASES, runAsBuiltCheck, runClockOnBuild } from "../trial";


const FULL_HAND_WINDOW_LENGTHS = [4, 6, 8];

const FULL_HAND_OFFSET_STEP = 1;

const FULL_HAND_MAX_CONFIRM_ATTEMPTS = 5;

/** A pickup longer than this waited at the machine for more items */
const FULL_HAND_SLOW_PICKUP_TICKS = 2;

/** Only searched when the planned output windows fill hands in this many extra grabs per hand or more */
const FULL_HAND_MIN_EXTRA_GRABS_PER_HAND = 0.25;

/** Spare output capacity: every n-th window is lengthened so a second grab can drain a surplus */
const FULL_HAND_SPARE_EVERY = [3, 2];

const FULL_HAND_SPARE_TICKS = Array.from({ length: 13 }, (_, i) => i + 4);

/**
 * Warmup periods after which a run started with full output machines must be back at the expected output. On its way
 * back a build can lose a hand of ingredients and with it a period of output: automation science without belt pickup
 * slack does in its second period, and holds the expected output from the third on.
 */
const FULL_HAND_RECOVERY_PERIODS = [3, 4];


type SpareWindows = { every: number; ticks: number };

/**
 * Output windows with one swing each, evenly spaced so each grab finds a full hand already in the machine
 * instead of picking up a few items at a time while the machine crafts. The start offset and window length
 * are searched with clock-only simulations: candidates that keep the expected output are ranked by how long
 * the output machines sit output full (at the input block, a delayed input drop in game starves the machine),
 * then by how many output pickups had to wait for items.
 * One grab per window only keeps up with production, so a surplus left by a disturbance (a slow drop onto a busy
 * belt) never drains and keeps the input drops blocked. The timing must recover from full output machines; if it
 * does not, every n-th window is lengthened for a second grab, preferring the fewest pickups that wait for items.
 * The result is confirmed from several clock start phases. Skipped when the planned windows already fill most hands
 * in one grab (and, with count_waits, when most pickups do not wait at the machine either), unless the build moves
 * more than the expected output under them.
 */
export function fullHandOutputWindows(
    config: Config,
    windows: Map<string, OpenRange[]>,
    output_swings: Map<string, number>,
    output_machine_ids: Set<string>,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
    count_waits = false,
): { windows: Map<string, OpenRange[]>; result: TrialRun; check: AsBuiltStabilityCheck } | null {
    const swing_counts = Array.from(new Set(Array.from(output_swings.values(), s => Math.round(s * 1e6) / 1e6)));
    if (swing_counts.length !== 1 || !Number.isInteger(swing_counts[0]) || swing_counts[0] < 1) {
        return null;
    }
    const swings = swing_counts[0];
    const spacing = period / swings;
    const outputs = Array.from(output_swings.keys());

    const build = (offset: number, length: number, spare?: SpareWindows) => {
        const result = new Map(windows);
        // floor keeps every start below the period, so starts stay whole ticks
        const starts = Array.from({ length: swings }, (_, j) => Math.floor(offset + j * spacing));
        const ranges = OpenRange.reduceRanges(starts.flatMap((start, j) => {
            const extra = spare && j % spare.every === 0 ? spare.ticks : 0;
            return rotateRanges([OpenRange.from(0, length - 1 + extra)], start, period);
        }));
        outputs.forEach(key => result.set(key, ranges));
        return result;
    };
    const pickupStats = (result: TrialRun) => {
        let slow = 0;
        let pickups = 0;
        let swings = 0;
        for (const entity of result.serializable_state_transition_history.entities) {
            if (!output_swings.has(entity.entity_id)) {
                continue;
            }
            const transitions = [...entity.transitions].sort((a, b) => a.tick - b.tick);
            transitions.forEach((transition, index) => {
                if (transition.to_status === InserterStatus.DROP_OFF) {
                    swings++;
                }
                if (transition.to_status !== InserterStatus.PICKUP) {
                    return;
                }
                pickups++;
                const next = transitions[index + 1];
                if (next && next.tick - transition.tick > FULL_HAND_SLOW_PICKUP_TICKS) {
                    slow++;
                }
            });
        }
        return { slow, pickups, swings };
    };
    const slowPickups = (result: TrialRun) => pickupStats(result).slow;
    const outputFullTicks = (result: TrialRun) => {
        let ticks = 0;
        for (const entity of result.serializable_state_transition_history.entities) {
            if (!output_machine_ids.has(entity.entity_id)) {
                continue;
            }
            const transitions = [...entity.transitions].sort((a, b) => a.tick - b.tick);
            let status = entity.initial_status;
            let since = 0;
            for (const transition of transitions) {
                if (status === MachineStatus.OUTPUT_FULL) {
                    ticks += transition.tick - since;
                }
                status = transition.to_status;
                since = transition.tick;
            }
            if (status === MachineStatus.OUTPUT_FULL) {
                ticks += Math.ceil(period) - since;
            }
        }
        return ticks;
    };

    const planned_run = runClockOnBuild(config, windows, period, logger);
    const planned = pickupStats(planned_run);
    const extra_grabs = (planned.pickups - planned.swings) / Math.max(1, planned.swings);
    const waits = planned.slow / Math.max(1, planned.swings);
    // a machine with a surplus fills every hand in one grab, which says nothing about its windows: they let the surplus out
    const { actual_output_items, expected_output_items } = planned_run.stability_check;
    const over_produces = actual_output_items > expected_output_items + LCM_STABILITY_TOLERANCE;
    logger.log(`Full-hand output: current windows take ${planned.pickups} grabs for ${planned.swings} hands, ${planned.slow} waited for items`
        + (over_produces ? `, and move ${actual_output_items} of ${expected_output_items} items` : ""));
    if (!over_produces && extra_grabs < FULL_HAND_MIN_EXTRA_GRABS_PER_HAND && !(count_waits && waits >= FULL_HAND_MIN_EXTRA_GRABS_PER_HAND)) {
        return null;
    }

    type Candidate = { offset: number; length: number; output_full: number; slow: number };
    const recovers = (candidate_windows: Map<string, OpenRange[]>) => FULL_HAND_RECOVERY_PERIODS.every(warmup_periods =>
        runClockOnBuild(config, candidate_windows, period, logger, { keep_output_buffers: true, warmup_periods }).stability_check.is_stable);
    // shortest spare first: longer windows let more grabs wait for items
    const recoveringTiming = (candidate: Candidate, label: string) => {
        if (recovers(build(candidate.offset, candidate.length))) {
            return { spare: undefined as SpareWindows | undefined, output_full: candidate.output_full, slow: candidate.slow };
        }
        for (const every of FULL_HAND_SPARE_EVERY) {
            for (const ticks of FULL_HAND_SPARE_TICKS.filter(t => candidate.length + t < spacing)) {
                report?.(`Searching spare output capacity (${label}, every ${every} windows +${ticks} ticks)`);
                const spare = { every, ticks };
                const spare_windows = build(candidate.offset, candidate.length, spare);
                const result = runClockOnBuild(config, spare_windows, period, logger);
                if (result.stability_check.is_stable && recovers(spare_windows)) {
                    return { spare, output_full: outputFullTicks(result), slow: slowPickups(result) };
                }
            }
        }
        return null;
    };
    const confirm = (candidate: Candidate) => {
        let label = `offset ${candidate.offset}, ${candidate.length}-tick windows`;
        report?.(`Checking full-hand output recovery (${label})`);
        const timing = recoveringTiming(candidate, label);
        if (!timing) {
            logger.log(`Full-hand output: ${label} does not recover from full output machines`);
            return null;
        }
        if (timing.spare) {
            label += `, every ${timing.spare.every} windows +${timing.spare.ticks} ticks`;
        }
        const candidate_windows = build(candidate.offset, candidate.length, timing.spare);
        const quick = runAsBuiltCheck(config, candidate_windows, period, logger, AS_BUILT_START_PHASES,
            (n, of) => report?.(`Checking full-hand output (${label}), clock start ${n}/${of}`)).check;
        if (!quick.is_stable) {
            return null;
        }
        const full = runAsBuiltCheck(config, candidate_windows, period, logger, FULL_CHECK_START_PHASES,
            (n, of) => report?.(`Confirming full-hand output (${label}), clock start ${n}/${of}`));
        logger.log(`Full-hand output: ${label}, ${timing.output_full} output-full ticks, ${timing.slow} slow pickups, stable=${full.check.is_stable}`);
        return full.check.is_stable ? { windows: candidate_windows, ...full } : null;
    };

    // shortest windows first; a timing with no output-full ticks and no slow pickups cannot be beaten, so try it at once
    const candidates: Candidate[] = [];
    let attempts = 0;
    let searched = 0;
    const total = FULL_HAND_WINDOW_LENGTHS.length * Math.ceil(spacing / FULL_HAND_OFFSET_STEP);
    for (const length of FULL_HAND_WINDOW_LENGTHS) {
        if (length >= spacing) {
            continue;
        }
        // per length, so failing short windows still leave longer ones a chance
        let length_attempts = 0;
        for (let offset = 0; offset < spacing; offset += FULL_HAND_OFFSET_STEP) {
            report?.(`Searching full-hand output timing (${++searched}/${total})`);
            const result = runClockOnBuild(config, build(offset, length), period, logger);
            if (!result.stability_check.is_stable) {
                continue;
            }
            const candidate = { offset, length, output_full: outputFullTicks(result), slow: slowPickups(result) };
            if (candidate.output_full > 0 || candidate.slow > 0) {
                candidates.push(candidate);
                continue;
            }
            if (length_attempts < FULL_HAND_MAX_CONFIRM_ATTEMPTS) {
                length_attempts++;
                attempts++;
                const confirmed = confirm(candidate);
                if (confirmed) {
                    return confirmed;
                }
            }
        }
    }
    candidates.sort((a, b) => a.output_full - b.output_full || a.slow - b.slow || a.length - b.length);
    for (const candidate of candidates.slice(0, Math.max(0, FULL_HAND_MAX_CONFIRM_ATTEMPTS - attempts))) {
        const confirmed = confirm(candidate);
        if (confirmed) {
            return confirmed;
        }
    }
    logger.log("Full-hand output: no timing kept the expected output; keeping the planned output windows.");
    return null;
}

/**
 * In a build with always-enabled inserters, every other inserter's windows are the plan's (see
 * `windowsOfThePlanWhereInsertersRunFree`): a count of windows and not of hands moved, so there is no hand to read.
 */
export function hasPlannedWindowsNotHands(always_enabled: ReadonlySet<string>, inserter_id: string): boolean {
    return always_enabled.size > 0 && !always_enabled.has(inserter_id);
}

/**
 * Machine-to-machine inserters that move a full hand every swing but wait at the source machine for it get brief,
 * evenly spaced windows instead (one inserter at a time), kept only when the clock-only check passes from every
 * start phase. In game, a long window keeps the inserter rescanning both machines while it waits.
 */
export function fullHandTransferWindows(
    config: Config,
    windows: Map<string, OpenRange[]>,
    verification: TrialRun,
    output_inserter_ids: Set<string>,
    entity_registry: ReadableEntityRegistry,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
): { windows: Map<string, OpenRange[]>; result: TrialRun; check: AsBuiltStabilityCheck; inserters: string[] } | null {
    let current: { windows: Map<string, OpenRange[]>; result: TrialRun; check: AsBuiltStabilityCheck } | null = null;
    const inserters: string[] = [];
    const always_enabled = new Set(alwaysEnabledInserters(entity_registry).map(it => it.entity_id.id));
    for (const [entity_id, transfers] of verification.transfer_history.entries()) {
        const entity = entity_registry.getEntityByIdOrThrow(entity_id);
        if (!Entity.isInserter(entity) || output_inserter_ids.has(entity_id.id)
            || !EntityId.isMachine(entity.source.entity_id) || !EntityId.isMachine(entity.sink.entity_id)) {
            continue;
        }
        // In a build with always-enabled inserters the windows of these are the plan's (see
        // `windowsOfThePlanWhereInsertersRunFree`), a count of windows and not of hands moved: there is no hand to read
        if (hasPlannedWindowsNotHands(always_enabled, entity_id.id)) {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(entity.source.entity_id);
        const stack_size = Entity.isMachine(source) ? handSizeFor(entity, source.output.item_name) : entity.metadata.stack_size;
        if (!Entity.isMachine(source) || stack_size >= source.output.outputBlock.quantity
            || transfers.length === 0 || transfers.some(t => t.amount !== stack_size)) {
            continue;
        }
        const found = fullHandOutputWindows(config, current?.windows ?? windows, new Map([[entity_id.id, transfers.length]]),
            new Set([source.entity_id.id]), period, logger, report, true);
        if (found) {
            current = found;
            inserters.push(entity_id.id);
        }
    }
    return current && { ...current, inserters };
}
