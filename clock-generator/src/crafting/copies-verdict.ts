/**
 * A clock's verdict with the copies that share a lane (docs/stability.md, "Copies that share a lane"): the check of the lanes
 * the copies share, then the disturbance trials on the copies. One function, so that a maker that judges a clock before it is
 * listed and the listing judge it alike, and a clock is judged once in a generation (the run memo keeps both checks).
 */
import { Config } from "../config";
import { Logger } from "../common/logger";
import type { SerializableClockWindows } from "./clock";
import { EntityRouteError } from "./enable-control-router";
import { makerLogOn, timedCheck } from "./maker-log";
import { withTickPurpose } from "./tick-ledger";
import { currentRunMemo } from "./plan/run-memo";
import { SecondaryPlanningInvariantError } from "./round-robin-polling-primitive-policy";
import { copiesCheckKeys, copiesDisturbanceTrial, CopiesTrialVerdict } from "./shared-lane-trial";
import { ClockSharedLaneLoss, judgeSharedLanes, SharedLaneJudgement, sharedLanesNotChecked } from "./shared-lane-verdict";
import { LaneFeeders, laneFeedersOfConfig } from "./shared-lane-model";

/**
 * An error of the generator itself, which fails the generation: not a clock that could not be made, so no maker's fallback
 * passes over it
 */
export const isInternalError = (error: unknown): boolean => error instanceof SecondaryPlanningInvariantError || error instanceof EntityRouteError;

/** The check of a clock's shared lanes: its losses as `sharedLaneLossesOf` gives them, and the judgement where the check ran */
export interface SharedLaneCheck {
    losses: readonly ClockSharedLaneLoss[];
    judgement: SharedLaneJudgement | null;
}

/**
 * The shared-lane losses of one clock as `judge` (the check of the lanes its copies share) finds them, the log line
 * written. Where the check stops with an error, the clock is not taken to hold on those lanes: its one loss says that
 * they could not be checked, and why. An internal error of the generator fails the generation.
 */
export function sharedLaneLossesOf(judge: () => SharedLaneJudgement, label: string, logger: Logger): readonly ClockSharedLaneLoss[] {
    return sharedLaneCheckOf(judge, label, logger).losses;
}

/** `sharedLaneLossesOf` with the judgement kept, for the rows of the result (checked-lanes.ts) */
function sharedLaneCheckOf(judge: () => SharedLaneJudgement, label: string, logger: Logger): SharedLaneCheck {
    let judged: SharedLaneJudgement;
    try {
        judged = judge();
    } catch (error) {
        if (isInternalError(error)) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(`Clock "${label}": the lanes its copies share could not be checked: ${reason}`);
        return { losses: [sharedLanesNotChecked(reason)], judgement: null };
    }
    if (judged.lanes.length > 0) {
        logger.log(`Clock "${label}": the shared lanes ${judged.lanes.join(", ")}: the refill arithmetic says ${judged.fast_check_passes ? "they refill in time" : "they may run short"}; `
            + `with every copy on them, ${judged.losses.length === 0 ? "no copy loses swings" : `${judged.losses.length} takers lose swings`}`);
    }
    return { losses: judged.losses, judgement: judged };
}

/** A clock as its checks with the copies read it */
export interface ClockOnCopies {
    /** The config it is judged on, with its output swings each output cycle (`terminal_swing_count`) */
    config: Config;
    windows: SerializableClockWindows;
    /** The ticks of the window cycle it runs at */
    window_cycle_ticks: number;
    /** Items one copy is expected to move a window cycle */
    expected_output_items: number;
}

/** The checks a verdict with the copies makes: the generator's by default (`judgeSharedLanes`, `copiesDisturbanceTrial`), a test's own */
export interface CopiesChecks {
    /** `for_log`: the maker log asks for the facts of the lanes beside the judgement (`SharedLaneJudgement.for_log`) */
    sharedLanes(config: Config, windows: SerializableClockWindows, window_cycle_ticks: number, logger: Logger, options?: { for_log?: boolean }): SharedLaneJudgement;
    trials(config: Config, windows: SerializableClockWindows, window_cycle_ticks: number, expected_output_items: number, logger: Logger): CopiesTrialVerdict | null;
}

/** The feeders of the lanes of the build the generation that is running was given (`withBuildFeeders`) */
let build_feeders: LaneFeeders | undefined;

/**
 * Runs a generation of `given` with the feeders of its lanes (`laneFeedersOfConfig`) kept for the checks with the copies:
 * the generation clocks the config without its outside supply (outside-supply.ts), and the feeders are that supply, so
 * the copies' lanes take their items from them only through here. A generation inside one that is running keeps the
 * feeders of its own build, and the outer one's come back when it ends.
 */
export function withBuildFeeders<T>(given: Config, generate: () => T): T {
    const outer = build_feeders;
    build_feeders = laneFeedersOfConfig(given);
    try {
        return generate();
    } finally {
        build_feeders = outer;
    }
}

/** The feeders of the lanes of the build being generated, where it states any (`withBuildFeeders`) */
export function buildFeeders(): LaneFeeders | undefined {
    return build_feeders === undefined || build_feeders.size === 0 ? undefined : build_feeders;
}

const GENERATOR_CHECKS: CopiesChecks = {
    sharedLanes: (config, windows, window_cycle_ticks, logger, options) => judgeSharedLanes(config, windows, window_cycle_ticks, logger,
        { for_log: options?.for_log === true, feeders: buildFeeders() }),
    trials: (config, windows, window_cycle_ticks, expected_output_items, logger) =>
        copiesDisturbanceTrial(config, windows, window_cycle_ticks, expected_output_items, logger, buildFeeders()),
};

/** A clock's verdict with the copies (`verdictWithCopies`) */
export interface VerdictWithCopies {
    /** The check of the lanes the copies share: the takers that lose swings there (one loss that says so where the check stopped with an error) */
    lane_check: SharedLaneCheck;
    /**
     * The disturbance trials on the copies: null where they are not made (a swing is lost on a shared lane, the trials of one copy
     * do not pass, the config switches them off, or the copies share no lane). Trials that stop with an error pass, with the
     * reason in `not_tried`: the clock keeps the verdict of one copy.
     */
    copies_trial: CopiesTrialVerdict | null;
    /** No swing lost on a shared lane, and every copy back after every trial on the copies that was made */
    holds: boolean;
}

/**
 * A clock's verdict with the copies, as the listing judges a clock that holds on one copy: the check of the lanes the copies share
 * first; then, only where no taker loses swings there and the disturbance trials of one copy pass (`one_copy_survives`, asked
 * only then), the trials on the copies, unless `trials_on_copies` is false. Each check is kept in the run memo under its key
 * (`copiesCheckKeys`: which check, the lanes, the config, the order of the window deciders, the windows, the window cycle and, for
 * the trials, the expected items), so the second judgement of the same clock in a generation makes no run. A check that stops with
 * an error keeps nothing; an internal error of the generator fails the generation. The log lines of the check of the lanes are
 * written for each judgement, with `label`.
 */
export function verdictWithCopies(
    clock: ClockOnCopies,
    one_copy_survives: () => boolean,
    trials_on_copies: boolean,
    label: string,
    logger: Logger,
    checks: CopiesChecks = GENERATOR_CHECKS,
): VerdictWithCopies {
    const { config, windows, window_cycle_ticks, expected_output_items } = clock;
    const memo = currentRunMemo();
    const keys = memo === undefined ? { shared_lanes: null, trials: null } : copiesCheckKeys(config, windows, window_cycle_ticks, expected_output_items, buildFeeders());
    // the facts of the lanes for the maker log are kept only where a generation asked for a log
    const judge = () => timedCheck("shared_lane_check", () => withTickPurpose("shared_lane_check", () =>
        checks.sharedLanes(config, windows, window_cycle_ticks, logger, { for_log: makerLogOn() }), { claim: true }));
    const lane_check = sharedLaneCheckOf(memo === undefined || keys.shared_lanes === null ? judge : () => memo.sharedLaneCheck(keys.shared_lanes!, judge), label, logger);
    if (!trials_on_copies || lane_check.losses.length > 0 || !one_copy_survives()) {
        return { lane_check, copies_trial: null, holds: lane_check.losses.length === 0 };
    }
    const tried = () => timedCheck("copies_trial", () => withTickPurpose("trial_copies", () =>
        checks.trials(config, windows, window_cycle_ticks, expected_output_items, logger), { claim: true }));
    let copies_trial: CopiesTrialVerdict | null;
    try {
        copies_trial = memo === undefined || keys.trials === null ? tried() : memo.copiesTrial(keys.trials, tried);
    } catch (error) {
        if (isInternalError(error)) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(`Clock "${label}": the disturbance trials on the copies that share a lane could not be made: ${reason}`);
        // the clock keeps the verdict of one copy, and the result says why the copies were not tried
        copies_trial = { survives: true, lanes: [], expected_output_items, recovered_after_window_cycles: null, not_tried: reason };
    }
    return { lane_check, copies_trial, holds: copies_trial === null || copies_trial.survives };
}
