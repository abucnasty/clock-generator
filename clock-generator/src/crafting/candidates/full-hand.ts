import { Config } from "../../config";
import { alwaysEnabledInserters } from "../sequence/unplanned-inserter-clock";
import { OpenRange } from "../../data-types";
import { Entity, EntityId, handSizeFor, ReadableEntityRegistry } from "../../entities";
import { InserterStatus, MachineStatus } from "../../state";
import { Logger } from "../../common/logger";
import { BlueprintGenerationResult, GenerateClockOptions, LCM_STABILITY_TOLERANCE, TrialRun, checkedClock, clockOfPlan, planRun } from "../plan/plan-run";
import { AS_BUILT_START_PHASES, AsBuiltStabilityCheck, FULL_CHECK_START_PHASES, runAsBuiltCheck, runClockOnBuild } from "../trial";
import { search } from "./search";
import { SpareOutputWindows, withSingleSwingOutput } from "./transforms";


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


/** One timing of the single-swing output windows: where they start and how long they are */
interface Timing {
    offset: number;
    length: number;
}

/** What the quick trial of a timing found: whether it holds, and how its windows are used when it does */
interface TimingTrial {
    holds: boolean;
    /** Ticks the output machines sat output full */
    output_full: number;
    /** Pickups that waited at the machine for more items */
    slow: number;
}

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

    const build = (timing: Timing, spare?: SpareOutputWindows) => withSingleSwingOutput(windows, outputs, swings, period, timing.offset, timing.length, spare);
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

    const recovers = (candidate_windows: Map<string, OpenRange[]>) => FULL_HAND_RECOVERY_PERIODS.every(warmup_periods =>
        runClockOnBuild(config, candidate_windows, period, logger, { keep_output_buffers: true, warmup_periods }).stability_check.holds);
    // shortest spare first: longer windows let more grabs wait for items
    const recoveringTiming = (timing: Timing, label: string) => {
        if (recovers(build(timing))) {
            return { spare: undefined as SpareOutputWindows | undefined };
        }
        for (const every of FULL_HAND_SPARE_EVERY) {
            for (const ticks of FULL_HAND_SPARE_TICKS.filter(t => timing.length + t < spacing)) {
                report?.(`Searching spare output capacity (${label}, every ${every} windows +${ticks} ticks)`);
                const spare = { every, ticks };
                const spare_windows = build(timing, spare);
                const result = runClockOnBuild(config, spare_windows, period, logger);
                if (result.stability_check.holds && recovers(spare_windows)) {
                    return { spare, output_full: outputFullTicks(result), slow: slowPickups(result) };
                }
            }
        }
        return null;
    };
    const confirm = (timing: Timing, trial: TimingTrial) => {
        let label = `offset ${timing.offset}, ${timing.length}-tick windows`;
        report?.(`Checking full-hand output recovery (${label})`);
        const recovery = recoveringTiming(timing, label);
        if (!recovery) {
            logger.log(`Full-hand output: ${label} does not recover from full output machines`);
            return null;
        }
        const { output_full, slow } = recovery.spare ? recovery as Required<typeof recovery> : trial;
        if (recovery.spare) {
            label += `, every ${recovery.spare.every} windows +${recovery.spare.ticks} ticks`;
        }
        const candidate_windows = build(timing, recovery.spare);
        const quick = runAsBuiltCheck(config, candidate_windows, period, logger, AS_BUILT_START_PHASES,
            (n, of) => report?.(`Checking full-hand output (${label}), clock start ${n}/${of}`)).check;
        if (!quick.holds) {
            return null;
        }
        const full = runAsBuiltCheck(config, candidate_windows, period, logger, FULL_CHECK_START_PHASES,
            (n, of) => report?.(`Confirming full-hand output (${label}), clock start ${n}/${of}`));
        logger.log(`Full-hand output: ${label}, ${output_full} output-full ticks, ${slow} slow pickups, stable=${full.check.holds}`);
        return full.check.holds ? { windows: candidate_windows, ...full } : null;
    };

    // shortest windows first, every offset of each length; a timing with no output-full ticks and no slow pickups cannot
    // be beaten, so it is confirmed at once, up to a few per length so failing short windows still leave longer ones a chance
    const timings: Timing[] = FULL_HAND_WINDOW_LENGTHS.filter(length => length < spacing).flatMap(length => {
        const offsets: Timing[] = [];
        for (let offset = 0; offset < spacing; offset += FULL_HAND_OFFSET_STEP) {
            offsets.push({ offset, length });
        }
        return offsets;
    });
    const total = FULL_HAND_WINDOW_LENGTHS.length * Math.ceil(spacing / FULL_HAND_OFFSET_STEP);
    let attempts = 0;
    const length_attempts = new Map<number, number>();
    const { picked } = search<Timing, TimingTrial, { windows: Map<string, OpenRange[]>; result: TrialRun; check: AsBuiltStabilityCheck }>({
        candidates: timings,
        quick: (timing, index) => {
            report?.(`Searching full-hand output timing (${index + 1}/${total})`);
            const result = runClockOnBuild(config, build(timing), period, logger);
            return result.stability_check.holds
                ? { holds: true, output_full: outputFullTicks(result), slow: slowPickups(result) }
                : { holds: false, output_full: 0, slow: 0 };
        },
        picks: (tried, done) => {
            if (!done) {
                const last = tried[tried.length - 1];
                const perfect = last.quick.holds && last.quick.output_full === 0 && last.quick.slow === 0;
                if (!perfect || (length_attempts.get(last.candidate.length) ?? 0) >= FULL_HAND_MAX_CONFIRM_ATTEMPTS) {
                    return [];
                }
                length_attempts.set(last.candidate.length, (length_attempts.get(last.candidate.length) ?? 0) + 1);
                attempts++;
                return [last.index];
            }
            // then the timings that hold but wait somewhere, the least output-full time and the fewest slow pickups first
            return tried.filter(it => it.quick.holds && (it.quick.output_full > 0 || it.quick.slow > 0))
                .sort((a, b) => a.quick.output_full - b.quick.output_full || a.quick.slow - b.quick.slow || a.candidate.length - b.candidate.length)
                .slice(0, Math.max(0, FULL_HAND_MAX_CONFIRM_ATTEMPTS - attempts))
                .map(it => it.index);
        },
        confirm: ({ candidate, quick }) => confirm(candidate, quick),
    });
    if (picked === null) {
        logger.log("Full-hand output: no timing kept the expected output; keeping the planned output windows.");
    }
    return picked;
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

/**
 * The full-hand output candidate: the clock of the plan with the output inserters' windows replaced by one swing each,
 * timed so the machine already holds a full hand (`fullHandOutputWindows`), checked and exported as a planned clock is.
 * Not searched where a full hand would wait past the output block, which would refuse input drops every cycle; the
 * planned windows are exported then, and when no timing keeps the expected output.
 */
export function fullHandClock(config: Config, options: GenerateClockOptions = {}): BlueprintGenerationResult {
    const plan = planRun(config, options);
    const clock = clockOfPlan(plan, options);
    const { output_inserters, output_machine_state_machines, swing_counts, output_inserter_ids, recipe_lcm, duration } = plan.run;
    // waiting for a full hand past the output block would refuse input drops every cycle
    const full_hand_fits = output_inserters.every((os, index) =>
        handSizeFor(os.inserter, output_machine_state_machines[index].machine_state.machine.output.item_name)
            < output_machine_state_machines[index].machine_state.machine.output.outputBlock.quantity);
    const output_swings = new Map<string, number>();
    for (const [entity_id, etc] of swing_counts.entries()) {
        if (output_inserter_ids.has(entity_id.id)) {
            output_swings.set(entity_id.id, etc.total_transfer_count.toDecimal() * recipe_lcm);
        }
    }
    const full_hand = !full_hand_fits ? null : fullHandOutputWindows(
        { ...config, overrides: { ...config.overrides, derive_clock_windows: false } },
        clock.windows, output_swings,
        new Set(output_inserters.map(os => os.inserter.source.entity_id.id)),
        duration.ticks, plan.logger, options.on_progress_detail,
    );
    return checkedClock(plan, clock, full_hand?.windows ?? clock.windows, options);
}
