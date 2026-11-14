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
import { canonicalKey, currentRunMemo } from "./plan/run-memo";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { runOnSharedLanes } from "./shared-lane-model";
import { sharedLaneRunsOf } from "./shared-lane-verdict";

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
 */
export function copiesDisturbanceTrial(config: Config, clock_windows: SerializableClockWindows, window_cycle_ticks: number,
    expected_output_items: number, logger: Logger): CopiesTrialVerdict | null {
    const { lanes, readings } = sharedLaneRunsOf(config);
    if (!lanes.some(lane => lane.shared)) return null;
    const memo = currentRunMemo();
    const key = memo === undefined ? null : canonicalKey([config, clock_windows, window_cycle_ticks, expected_output_items]);
    const tried = () => triedOnCopies(config, lanes, readings, clock_windows, window_cycle_ticks, expected_output_items, logger);
    return memo === undefined || key === null ? tried() : memo.copiesTrial(key, tried);
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
