/**
 * The disturbance trials of a clock on the copies that share a lane (docs/stability.md, "Copies that share a lane").
 *
 * The trials of one copy (disturbance-trial.ts) run on a build whose belts are supplies that are always full: a supply
 * stop withholds the item at the belt, and every hand stops at once. A lane the copies share has no such gate: the
 * copies' takers empty it from its entry downstream, and when the item comes back it refills from the entry. So the
 * trials are made again on the run of the copies that the shared-lane verdict makes (shared-lane-verdict.ts), with the
 * same losses, places and lengths: a supply stop closes the entry of each shared lane that carries the item, and the lane
 * drains as the takers take from it; an output blockage refuses the product where every copy puts it, or, where the config
 * states its output belt, shuts the infinite end of the output belt: the belt lane is blocked from draining to the belt it joins,
 * every lane upstream backs up from there, and a hand is held only when its side belt is full. After each trial
 * every copy has to be back at the expected output of one copy, as the trials judge one copy: exactly in every window
 * cycle once its state, the lanes included, repeats, or in its last window cycles where none repeats. A trial a copy is
 * not back from runs on until the lanes settle (the state repeats), at most MAX_RUN_ON_WINDOW_CYCLES after the item is
 * back, before the copy is called short.
 *
 * They are made for a clock that holds on one copy, gets back from every loss there, and keeps every copy at its target
 * on the shared lanes; on each run of the copies the verdict makes (each reading of a lane of unknown end, each way the
 * items move), in that order, and no further than the first loss after which a copy is not back. A build whose copies
 * share no lane is not run.
 */
import { Config } from "../config";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import { buildToNameOf } from "./build-names";
import { SerializableClockWindows } from "./clock";
import { lanesInSentence, NO_BUILD, type BuildToName } from "./entity-name";
import { DisturbanceTrial, disturbanceTrialsOf, LossOutcome, lossLabel, lossLimitOf, type SkippedTrial, trialCountOf, type TrialCount, withEveryTrialCounted } from "./disturbance-trial";
import { canonicalKey } from "./plan/run-memo";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { LaneFeeders, runOnSharedLanes } from "./shared-lane-model";
import { sharedLaneRunsOf } from "./shared-lane-verdict";
import { SHARED_LANES_JUDGED_BY_RATE } from "./shared-lane-judge-switch";
import { deciderBuildOrderOf } from "./trial";

/** A copy that is not back at the expected output after a trial on the copies */
export interface CopyShortAfterLoss {
    /** The copy, counted from the lanes' entry: 1 is the config's own */
    copy: number;
    /** Items of the target it put down in each window cycle it ended in: the cycle that repeats, or its last ones */
    items_per_window_cycle: number[];
}

/** What the trials on the copies that share a lane found about one clock */
export interface CopiesTrialVerdict {
    /** Every copy got back to the expected output of one copy after every trial */
    survives: boolean;
    /** The lanes the copies share, by "belt/lane" */
    lanes: string[];
    /** Items one copy puts down a window cycle at its expected output */
    expected_output_items: number;
    /** The loss after which a copy is not back, as lossLabel words it; absent where every copy is back */
    broken_by?: string;
    /**
     * The trial of that loss: where in the window cycle it was cut, how long the item was gone, whether the state of the
     * run repeated (the lanes settled, and the copies end so for good), and the window cycles it was run for after the
     * item was back
     */
    trial?: { cut_at: number; loss_ticks: number; until_stopped: boolean; proven: boolean; window_cycles_after: number };
    /** The trials of that loss on the copies, as numbers, in the shape of the trials of one copy (`DisturbanceTrialVerdict.trial_counts`); absent where every copy is back */
    trial_counts?: TrialCount[];
    /** The copies not back after it, from the lanes' entry */
    short?: CopyShortAfterLoss[];
    /** The copies that hold only part of the output inserters (a part copy), whose output is not judged */
    copies_not_judged?: number[];
    /** The most window cycles a copy took to be back over the trials; null where one is not back */
    recovered_after_window_cycles: number | null;
    /** Why the trials were not made on the copies; absent where they were */
    not_tried?: string;
    /** The sentence the result shows, where a copy is not back */
    text?: string;
}

/** "3" or "3 and 4" or "3, 4 and 5" */
const listed = (values: readonly (number | string)[]) => values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;

/**
 * "Accumulator stops arriving at the entry of the accumulator lane, which the 11 copies share, and comes back. Copy 3 from
 * the entry ends at 288, 288 and 304 a window cycle, where one copy makes 352." One fact a sentence. With `infinite_end`,
 * the output blockage of a config that states its output belt: "Automation science pack is not taken away at the infinite
 * end of the output belt: the infinite end is shut, and every lane upstream backs up from there. Then the infinite end
 * opens again. ..." A lane is named by its item (entity-name.ts, `build`: the config's).
 */
export function describeCopiesShort(loss: DisturbanceTrial, lanes: readonly string[], copies: number, short: readonly CopyShortAfterLoss[], expected: number,
    infinite_end = false, build: BuildToName = NO_BUILD): string {
    const label = lossLabel(loss);
    const each = short.map(it => `Copy ${it.copy} from the entry ends at ${listed(it.items_per_window_cycle.map(items => items.toLocaleString("en-US")))} a window cycle`);
    const ends = `${each.join(". ")}, where one copy makes ${expected.toLocaleString("en-US")}.`;
    if (infinite_end) {
        return `${label[0].toUpperCase()}${label.slice(1)} at the infinite end of the output belt: the infinite end is shut, and every lane `
            + `upstream backs up from there. Then the infinite end opens again. ${ends}`;
    }
    const where = loss.kind === "supply"
        ? ` at the entry of ${lanesInSentence(lanes.map(key => { const [belt_id, lane] = key.split("/").map(Number); return { belt_id, lane }; }), build)}, `
            + (copies > 1 ? `which the ${copies} copies share` : "which several inserters of the build take from")
        : copies > 1 ? ` from the ${copies} copies` : " from the build";
    const back = loss.kind === "supply" ? "comes back" : "is taken away again";
    return `${label[0].toUpperCase()}${label.slice(1)}${where}, and ${back}. ${ends}`;
}

/**
 * The trials of a clock on the copies that share a lane (see the module's description); null where the copies share no
 * lane, which makes no run. `config` is the config the shared-lane verdict judges the clock on, with its output swings.
 * Made every time it is asked: the verdict with the copies (copies-verdict.ts) keeps it for a generation.
 */
export function copiesDisturbanceTrial(config: Config, clock_windows: SerializableClockWindows, window_cycle_ticks: number,
    expected_output_items: number, logger: Logger, feeders?: LaneFeeders): CopiesTrialVerdict | null {
    const { lanes, readings } = sharedLaneRunsOf(config, undefined, feeders);
    if (!lanes.some(lane => lane.shared)) return null;
    return triedOnCopies(config, lanes, readings, clock_windows, window_cycle_ticks, expected_output_items, logger);
}

/**
 * What the trials of a clock on the copies that share a lane are a function of: which trials they are (those on the copies, with the
 * lanes they share, apart from those of one copy: `disturbanceTrialKey`), the config, the order the window deciders are built in on
 * each reading of the lanes it runs (in a tick in which two windows open together, it decides which inserter goes first), the windows,
 * the window cycle and the items one copy is expected to move a window cycle. Null where one of them cannot be written as a key
 * (`canonicalKey`) or the order cannot be worked out: the trials are then made without the memo.
 */
export function copiesTrialKey(config: Config, clock_windows: SerializableClockWindows, window_cycle_ticks: number, expected_output_items: number): string | null {
    return copiesCheckKeys(config, clock_windows, window_cycle_ticks, expected_output_items).trials;
}

/**
 * The keys of the two checks of a clock with the copies, from one reading of the config: of the check of the lanes the copies share
 * (`shared_lanes`: which check it is, the lanes, the config, the order of the window deciders on each reading of the lanes, the windows
 * and the window cycle; null where the build has no lane the check runs) and of the trials on the copies (`trials`: `copiesTrialKey`;
 * null where the copies share no lane). Either is null too where it cannot be made, whatever stops it: that check is then made
 * without the memo, and an error of the config or the windows is met there, where the check's own handling gives it.
 */
export function copiesCheckKeys(config: Config, clock_windows: SerializableClockWindows, window_cycle_ticks: number,
    expected_output_items: number, feeders?: LaneFeeders): { shared_lanes: string | null; trials: string | null } {
    try {
        return checkKeysOf(config, clock_windows, window_cycle_ticks, expected_output_items, feeders);
    } catch {
        return { shared_lanes: null, trials: null };
    }
}

function checkKeysOf(config: Config, clock_windows: SerializableClockWindows, window_cycle_ticks: number,
    expected_output_items: number, feeders?: LaneFeeders): { shared_lanes: string | null; trials: string | null } {
    const runs = sharedLaneRunsOf(config, undefined, feeders);
    // the feeders of the lanes, where the build has any, are part of both keys: the runs of the copies take their items from them
    const fed = feeders === undefined || feeders.size === 0 ? {} : { feeders: [...feeders].sort(([a], [b]) => a.localeCompare(b)) };
    const lanes = runs.lanes.filter(lane => lane.shared).map(lane => `${lane.belt_id}/${lane.lane}`);
    if (runs.lanes.length === 0) return { shared_lanes: null, trials: null };
    const windows = new Map(Object.entries(clock_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    // as the runs of the copies build each reading (runOnSharedLanes)
    const decider_orders = runs.readings.map(({ under }) => deciderBuildOrderOf({ ...under, overrides: { ...under.overrides, derive_clock_windows: false } }, windows, window_cycle_ticks));
    const modelled = runs.lanes.map(lane => `${lane.belt_id}/${lane.lane}`);
    return {
        // the judge of the lanes is part of the key only where it is switched on, so that the key stays as it was with it off
        shared_lanes: canonicalKey([{ check: "shared_lanes", lanes: modelled, ...(SHARED_LANES_JUDGED_BY_RATE && { by_rate: true }), ...fed }, config, decider_orders, clock_windows, window_cycle_ticks]),
        trials: lanes.length === 0 ? null : canonicalKey([{ trial: "copies", lanes, ...fed }, config, decider_orders, clock_windows, window_cycle_ticks, expected_output_items]),
    };
}

function triedOnCopies(config: Config, lanes: ReturnType<typeof sharedLaneRunsOf>["lanes"], readings: ReturnType<typeof sharedLaneRunsOf>["readings"],
    clock_windows: SerializableClockWindows, window_cycle_ticks: number, expected_output_items: number, logger: Logger): CopiesTrialVerdict {
    const windows = new Map(Object.entries(clock_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const shared_keys = lanes.filter(lane => lane.shared).map(lane => `${lane.belt_id}/${lane.lane}`);
    const registry = createEntityRegistryFromConfig(config);
    const losses = disturbanceTrialsOf(registry, config.setpoint.recipe);
    const loss_limit = lossLimitOf(registry);
    const base: CopiesTrialVerdict = { survives: true, lanes: shared_keys, expected_output_items, recovered_after_window_cycles: 0 };
    const not_judged = new Set<number>();
    let recovered = 0;
    for (const { under, layouts } of readings) {
        for (const layout of layouts) {
            const runOf = (loss: DisturbanceTrial, skipped?: readonly SkippedTrial[]): LossOutcome => runOnSharedLanes(under, windows, window_cycle_ticks, layout, 1, logger, undefined,
                { loss, window_cycle_ticks, expected_output_items, loss_limit_ticks: loss_limit?.ticks, ...(skipped !== undefined && { skipped_trials: skipped }) }).disturbance_trial!;
            // a loss a copy is not back from has every trial of its plan counted (withEveryTrialCounted)
            const outcomeOf = (loss: DisturbanceTrial): LossOutcome => withEveryTrialCounted(runOf(loss), skipped => runOf(loss, skipped));
            // the run with nothing cut, judged as the others: copies that are not at the expected output in every window
            // cycle without a loss cannot be judged after one
            const undisturbed = outcomeOf({ kind: "none" });
            undisturbed.trials.forEach(trial => trial.copies_not_judged?.forEach(copy => not_judged.add(copy)));
            if (!undisturbed.recovers) {
                const short = (undisturbed.trials[0]?.copies ?? []).filter(it => !it.recovers).map(it => it.copy);
                return { ...base, recovered_after_window_cycles: null,
                    not_tried: `with nothing cut, copy ${listed(short)} from the entry is not at the expected output in every window cycle` };
            }
            for (const loss of losses) {
                const outcome = outcomeOf(loss);
                outcome.trials.forEach(trial => trial.copies_not_judged?.forEach(copy => not_judged.add(copy)));
                if (!outcome.recovers) {
                    const trial = outcome.trials[outcome.trials.length - 1];
                    const count = trialCountOf(outcome);
                    const short = (trial.copies ?? []).filter(it => !it.recovers).map(it => ({ copy: it.copy, items_per_window_cycle: it.ends_in }));
                    const loss_lanes = loss.kind === "supply"
                        ? lanes.filter(lane => lane.shared && under.belts.find(belt => belt.id === lane.belt_id)?.lanes[lane.lane - 1]?.ingredient === loss.item).map(lane => `${lane.belt_id}/${lane.lane}`)
                        : shared_keys;
                    const copies = under.setpoint.copies;
                    logger.log(`On the ${copies} copies, ${lossLabel(loss)}: copy ${listed(short.map(it => it.copy))} not back`);
                    return { ...base, survives: false, broken_by: lossLabel(loss), recovered_after_window_cycles: null,
                        trial: { cut_at: trial.cut_at, loss_ticks: trial.loss_ticks, until_stopped: trial.until_stopped, proven: trial.proven,
                            window_cycles_after: trial.output_per_bin.length * outcome.window_cycles_per_bin }, short,
                        ...(count !== null && { trial_counts: [count] }),
                        ...(not_judged.size > 0 && { copies_not_judged: [...not_judged].sort((a, b) => a - b) }),
                        text: describeCopiesShort(loss, loss_lanes.length > 0 ? loss_lanes : shared_keys, copies, short, expected_output_items,
                            loss.kind === "output" && under.output_belt !== undefined && loss.item === under.setpoint.recipe, buildToNameOf(config)) };
                }
                recovered = Math.max(recovered, (outcome.recovered_after_bins ?? 0) * outcome.window_cycles_per_bin);
            }
        }
    }
    return { ...base, recovered_after_window_cycles: recovered, ...(not_judged.size > 0 && { copies_not_judged: [...not_judged].sort((a, b) => a - b) }) };
}
