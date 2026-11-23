import { CIRCUIT_LATENCY_TICKS } from "../../common/rule-constants";
import { OpenRange } from "../../data-types";
import { Entity, EntityId, type Machine } from "../../entities";
import type { SerializableClockWindows } from "../clock";
import type { UnclockedRun } from "../plan/unclocked-run";
import { costKey } from "../rank";
import { targetItemOf, targetMachinesOf } from "../sequence/cycle/target-ends";
import type { AsBuiltRun } from "../trial";
import { outputServiceWindow } from "./metered-output-windows";

type Range = { start: number; end: number };

/** How the observed picks of a belt-fed input become its windows, the same for every input of a proposal */
export type InputWindowForm =
    /** one window each service interval over the cluster of picks with the most items */
    | "main_cluster"
    /** one window each service interval over each cluster of picks */
    | "each_cluster"
    /** one window each service interval over all its picks, as the output step makes it */
    | "all_clusters";
export const INPUT_WINDOW_FORMS: readonly InputWindowForm[] = ["main_cluster", "each_cluster", "all_clusters"];

/** Where a proposal stopped: the check up to the long run (as `notHeldFields` names it), or a part of the whole check */
export type InputJointStage = "not_checked" | "first_window_cycle" | "pickup_phase" | "long_run" | "whole_check" | "margin" | "loss" | "copies";

type Unproved = "unsupported_route" | "always_enabled" | "no_single_metered_taker" | "no_stock_witness" | "service_not_balanced" | "no_idle_gap";
type Refused = "joint_check_failed" | "no_fewer_wake_ups" | "recovery_worse";
export type InputWindowDecision = { kind: "already_bounded" }
    | { kind: "retained"; reason: Unproved }
    | { kind: "retained"; reason: "joint_check_failed"; stage: InputJointStage }
    | { kind: "retained"; reason: Exclude<Refused, "joint_check_failed"> }
    | { kind: "bounded"; form: InputWindowForm; service_ticks: number; observed_ticks: number; items_taken: number };

/** One form's windows for every input that has them */
export interface InputWindowProposal {
    form: InputWindowForm;
    changes: SerializableClockWindows;
}

/** What the step read of one input from the stock, kept for its decision once a proposal is taken */
interface Witness { service_ticks: number; observed_ticks: number; items_taken: number }

/**
 * The picks of a service interval split into clusters: picks less than the arm's return apart (its drop, its return swing and
 * its next pickup test) belong to one hand's run of hands. Circular on the interval. Each cluster as its positions in order.
 */
export function pickClusters(positions: readonly number[], service_ticks: number, return_ticks: number): number[][] {
    const sorted = [...new Set(positions)].sort((a, b) => a - b);
    if (sorted.length === 0) return [];
    // start after the widest gap, so that a cluster across the wrap of the interval stays whole
    let start = 0;
    let widest = -1;
    for (const [i, position] of sorted.entries()) {
        const previous = sorted[(i - 1 + sorted.length) % sorted.length];
        const gap = (position - previous + service_ticks) % service_ticks || service_ticks;
        if (gap > widest) { widest = gap; start = i; }
    }
    const clusters: number[][] = [];
    for (let k = 0; k < sorted.length; k++) {
        const position = sorted[(start + k) % sorted.length];
        const previous = sorted[(start + k - 1 + sorted.length) % sorted.length];
        if (k === 0 || (position - previous + service_ticks) % service_ticks > return_ticks) clusters.push([position]);
        else clusters[clusters.length - 1].push(position);
    }
    return clusters;
}

/**
 * The windows of one input in a form, from the items it picked at each position of the service interval and the positions
 * where its hand was full; padded as the output step pads (`outputServiceWindow`): one tick before the first pick, one after
 * the last, and one more after a full hand. Null where the form leaves no tick of the interval closed.
 */
export function inputServiceWindows(
    picks: ReadonlyMap<number, number>, full: ReadonlySet<number>, service_ticks: number, period: number, return_ticks: number, form: InputWindowForm,
): Range[] | null {
    const clusters = pickClusters([...picks.keys()], service_ticks, return_ticks);
    if (clusters.length === 0) return null;
    const windowOf = (positions: readonly number[]) => outputServiceWindow(new Set(positions), new Set(positions.filter(it => full.has(it))), service_ticks, period);
    if (form === "all_clusters") return windowOf(clusters.flat());
    if (form === "main_cluster") {
        const items = (cluster: readonly number[]) => cluster.reduce((sum, position) => sum + picks.get(position)!, 0);
        // of equal clusters, the first in the interval
        const main = clusters.reduce((best, cluster) => items(cluster) > items(best) || (items(cluster) === items(best) && cluster[0] < best[0]) ? cluster : best);
        return windowOf(main);
    }
    const each = clusters.map(windowOf);
    if (each.some(ranges => ranges === null)) return null;
    const union = OpenRange.reduceRanges(each.flatMap(ranges => ranges!.map(range => OpenRange.from(range.start, range.end))));
    if (union.reduce((sum, range) => sum + range.end_inclusive - range.start_inclusive + 1, 0) >= period) return null;
    return union.map(range => ({ start: range.start_inclusive, end: range.end_inclusive }));
}

/**
 * Windows for the belt-fed inputs of the target machines one metered taker feeds, in evenly spaced turns, from the service
 * the as-built run observed on the clock they would change: per input its picks, folded on the taker's service interval, in
 * each form of INPUT_WINDOW_FORMS. Only the choice (`chooseInputWindows`) decides whether the clock takes a proposal.
 */
export function meteredInputWindows(plan: UnclockedRun, windows: SerializableClockWindows, takers: ReadonlySet<string>, run: Pick<AsBuiltRun, "stock" | "check">) {
    const decisions: Record<string, InputWindowDecision> = {};
    const witnesses: Record<string, Witness> = {};
    const per_form = new Map<InputWindowForm, SerializableClockWindows>(INPUT_WINDOW_FORMS.map(form => [form, {}]));
    const period = plan.run.duration.ticks;
    const registry = plan.run.simulation_context.entity_registry;
    const arms = registry.getAll().filter(Entity.isInserter);
    const feeds = arms.filter(arm => takers.has(arm.entity_id.id));
    const targets = new Set(targetMachinesOf(targetItemOf(plan.config.setpoint), registry).map(machine => machine.entity_id.id));
    const { stock, check } = run;
    for (const arm of arms) {
        const id = arm.entity_id.id;
        if (!EntityId.isBelt(arm.source.entity_id) || !targets.has(arm.sink.entity_id.id)) continue;
        const retain = (reason: Unproved) => { decisions[id] = { kind: "retained", reason }; };
        if (plan.run.always_enabled_by_config.has(id) || plan.run.inserter_clocks.has(id)) {
            retain("always_enabled");
            continue;
        }
        const feeding = feeds.filter(feed => feed.sink.entity_id.id === arm.sink.entity_id.id);
        if (feeding.length !== 1) {
            retain("no_single_metered_taker");
            continue;
        }
        const sink = registry.getEntityByIdOrThrow(arm.sink.entity_id) as Machine;
        const transfer = plan.run.swing_counts.get(arm.entity_id);
        const ranges = windows[id];
        const rotation = arm.animation.rotation.ticks;
        if (!transfer || transfer.item_transfers.length === 0 || transfer.item_transfers.some(it => !sink.inputs.has(it.item_name))
            || !ranges?.length || !Number.isSafeInteger(rotation) || rotation < 1
            || ranges.some(range => range.start < 0 || range.end >= period || range.start > range.end || !Number.isInteger(range.start) || !Number.isInteger(range.end))) {
            retain("unsupported_route");
            continue;
        }
        const union = OpenRange.reduceRanges(ranges.map(range => OpenRange.from(range.start, range.end)));
        if (union.length !== 1 || union[0].start_inclusive !== 0 || union[0].end_inclusive !== period - 1) {
            decisions[id] = { kind: "already_bounded" };
            continue;
        }
        const turns = windows[feeding[0].entity_id.id] ?? [];
        const service = period / turns.length;
        if (!Number.isSafeInteger(service) || !turns.every((turn, i) => turn.start === turns[0].start + i * service)) {
            retain("unsupported_route");
            continue;
        }
        const held = stock?.inserters.find(series => series.inserter_id === id)?.held;
        const from = check.first_judged_tick, origin = check.clock_tick_at_first_judged, cycles = check.long_run_cycle_window_cycles;
        if (!check.long_run_proven || !held || from === undefined || origin === undefined || !cycles || from + cycles * period > held.length) {
            retain("no_stock_witness");
            continue;
        }
        const end = from + cycles * period;
        const hand = transfer.stack_size;
        const picks = new Map<number, number>(), full = new Set<number>();
        let picked = 0;
        let dropped = 0;
        for (let i = from; i < end; i++) {
            const previous = i === from ? end - 1 : i - 1;
            const change = held[i] - held[previous];
            if (change > 0) {
                // the position on the raw command, as the output step reads its takes
                const position = (origin + i - from + 1 - CIRCUIT_LATENCY_TICKS + service) % service;
                picks.set(position, (picks.get(position) ?? 0) + change);
                if (held[i] === hand) full.add(position);
                picked += change;
            } else dropped -= change;
        }
        // the hands the plan gives it, every one of them taken and put in over the cycles observed
        const quota = transfer.total_transfer_count.multiply(hand * cycles);
        if (quota.getDenominator !== 1 || picked !== quota.getNumerator || dropped !== picked || !full.size) {
            retain("service_not_balanced");
            continue;
        }
        // its drop, its return swing and the next pickup test after a full pickup, as the metered takers count them
        const return_ticks = 2 * rotation + 2;
        let any = false;
        for (const form of INPUT_WINDOW_FORMS) {
            const proposal = inputServiceWindows(picks, full, service, period, return_ticks, form);
            if (proposal === null) continue;
            per_form.get(form)![id] = proposal;
            any = true;
        }
        if (!any) {
            retain("no_idle_gap");
            continue;
        }
        witnesses[id] = { service_ticks: service, observed_ticks: end - from, items_taken: picked };
    }
    // one proposal a form; a form that gives the windows of an earlier one is that one
    const proposals: InputWindowProposal[] = [];
    for (const form of INPUT_WINDOW_FORMS) {
        const changes = per_form.get(form)!;
        if (Object.keys(changes).length === 0 || proposals.some(it => JSON.stringify(it.changes) === JSON.stringify(changes))) continue;
        proposals.push({ form, changes });
    }
    return { proposals, decisions, witnesses };
}

/** What the choice asks of the clock with a proposal's windows (or of the clock as it is, with no changes) */
export interface InputWindowJudge {
    /** Whether it holds to the long run, its wake-ups a minute there (`trialOf`), and where it stopped if not */
    longRun(changes: SerializableClockWindows): { holds: boolean; wake_ups: number | null; stage: InputJointStage | null };
    /** The first part of the whole check that fails: as built, the margin, the losses on one copy, the copies; null where all hold */
    wholeCheck(changes: SerializableClockWindows): InputJointStage | null;
    /** Its worst recovery in window cycles, on one copy and on the copy count; null where not counted */
    recovery(changes: SerializableClockWindows): { one_copy: number | null; copies: number | null };
}

/** A recovery part where the proposal's is worse than the clock's: null on the proposal only is worse; null on the clock passes */
function recoveryWorse(proposal: number | null, current: number | null): boolean {
    if (proposal === null) return current !== null;
    return current !== null && proposal > current;
}

/**
 * The proposal the clock takes: of those that hold to the long run with fewer wake-ups than the clock (`costKey`), in ascending
 * cost (a tie to the earlier form), the first that holds its whole check and recovers no slower than the clock on one copy and
 * on the copies. Null where none does. Each input's decision: bounded in the proposal taken, else the code of its proposal of
 * the lowest cost (Infinity where it does not hold to the long run; a tie to the earlier form).
 */
export function chooseInputWindows(proposals: readonly InputWindowProposal[], witnesses: Readonly<Record<string, Witness>>, judge: InputWindowJudge) {
    const decisions: Record<string, InputWindowDecision> = {};
    const current_cost = costKey({ wake_ups_per_minute: judge.longRun({}).wake_ups });
    type Outcome = { proposal: InputWindowProposal; cost: number; decision: InputWindowDecision | null };
    const outcomes: Outcome[] = proposals.map(proposal => {
        const run = judge.longRun(proposal.changes);
        if (!run.holds) return { proposal, cost: Infinity, decision: { kind: "retained", reason: "joint_check_failed", stage: run.stage ?? "long_run" } };
        const cost = costKey({ wake_ups_per_minute: run.wake_ups });
        return { proposal, cost, decision: cost < current_cost ? null : { kind: "retained", reason: "no_fewer_wake_ups" } };
    });
    let taken: InputWindowProposal | null = null;
    // sort is stable: of equal costs the earlier form comes first
    for (const outcome of outcomes.filter(it => it.decision === null).sort((a, b) => a.cost - b.cost)) {
        const stage = judge.wholeCheck(outcome.proposal.changes);
        if (stage !== null) { outcome.decision = { kind: "retained", reason: "joint_check_failed", stage }; continue; }
        const mine = judge.recovery(outcome.proposal.changes), theirs = judge.recovery({});
        if (recoveryWorse(mine.one_copy, theirs.one_copy) || recoveryWorse(mine.copies, theirs.copies)) {
            outcome.decision = { kind: "retained", reason: "recovery_worse" };
            continue;
        }
        taken = outcome.proposal;
        break;
    }
    for (const id of Object.keys(witnesses)) {
        if (taken !== null && id in taken.changes) {
            decisions[id] = { kind: "bounded", form: taken.form, ...witnesses[id] };
            continue;
        }
        const own = outcomes.filter(it => id in it.proposal.changes && it.decision !== null).sort((a, b) => a.cost - b.cost)[0];
        if (own !== undefined) decisions[id] = own.decision!;
    }
    return { taken, decisions };
}
