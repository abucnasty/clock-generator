// This step makes windows only by moving a window the clock already has, never from observed picks.
import { Entity, EntityId, type Inserter } from "../../entities";
import type { SerializableClockWindows } from "../clock";
import type { UnclockedRun } from "../plan/unclocked-run";
import { costKey } from "../rank";
import { targetItemOf, targetMachinesOf } from "../sequence/cycle/target-ends";
import { recoveryWorse, type InputJointStage, type InputWindowJudge } from "./metered-input-windows";
import type { OutputWindowDecision } from "./metered-output-windows";
import { CIRCUIT_LATENCY_TICKS } from "../../common/rule-constants";
import { MARGIN_SHIFT_TICKS } from "./round-robin-polling";

type Range = { start: number; end: number };

/** Why an arm keeps the window it has, before any proposal is judged */
export type StaggerUnproved = "not_one_belt" | "no_single_metered_taker" | "uneven_turns" | "always_enabled" | "not_bounded"
    | "window_not_periodic" | "not_identical" | "fewer_than_two_arms" | "one_phase"
    | "output_not_bounded" | "no_output_relation" | "relations_disagree";
type Staggered =
    | { kind: "staggered"; role: "input"; reference: string; shift_ticks: number; service_ticks: number }
    | { kind: "staggered"; role: "output"; relation_from: string[]; shift_ticks: number; service_ticks: number };
export type StaggerDecision = Staggered
    | { kind: "retained"; reason: StaggerUnproved }
    | { kind: "retained"; reason: "joint_check_failed"; stage: InputJointStage }
    | { kind: "retained"; reason: "no_fewer_wake_ups" | "recovery_worse" };

/** One reference's windows for the arms of a group, and each arm's decision where the clock takes them */
export interface StaggerProposal {
    reference: string;
    changes: SerializableClockWindows;
    staggered: Record<string, Staggered>;
}

/** The arms of one belt whose shared window can be moved, with one proposal for each distinct turn of a reference arm */
export interface StaggerGroup {
    belt: string;
    proposals: StaggerProposal[];
}

/** A circular run of enabled ticks in one service interval: where it opens (before the wrap where it wraps) and how long */
export interface CircularRun { start: number; length: number }

const mod = (value: number, by: number) => ((value % by) + by) % by;

/** Each tick of the window cycle, enabled or not; null where a range is not whole ticks inside the cycle */
export function enabledTicks(ranges: readonly Range[] | undefined, period: number): boolean[] | null {
    if (ranges === undefined) return null;
    const on = new Array<boolean>(period).fill(false);
    for (const range of ranges) {
        if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end >= period || range.start > range.end) return null;
        for (let tick = range.start; tick <= range.end; tick++) on[tick] = true;
    }
    return on;
}

/** The enabled ticks as ranges in order, merged, none across the end of the window cycle */
export function rangesOf(on: readonly boolean[]): Range[] {
    const ranges: Range[] = [];
    on.forEach((enabled, tick) => {
        if (!enabled) return;
        const last = ranges[ranges.length - 1];
        if (last !== undefined && last.end === tick - 1) last.end = tick;
        else ranges.push({ start: tick, end: tick });
    });
    return ranges;
}

/** The windows moved later by `shift_ticks`, wrapped on the window cycle and merged */
export function shiftedWindows(ranges: readonly Range[], shift_ticks: number, period: number): Range[] {
    const on = enabledTicks(ranges, period)!;
    return rangesOf(on.map((_, tick) => on[mod(tick - shift_ticks, period)]));
}

/** Whether the enabled ticks repeat every `service_ticks` */
export function repeatsEvery(on: readonly boolean[], service_ticks: number): boolean {
    return on.every((enabled, tick) => enabled === on[(tick + service_ticks) % on.length]);
}

/** The circular runs of the first service interval, in the order they open; a run across the wrap opens before it */
export function circularRuns(on: readonly boolean[], service_ticks: number): CircularRun[] {
    const interval = on.slice(0, service_ticks);
    const runs: CircularRun[] = [];
    if (interval.every(Boolean)) return [{ start: 0, length: service_ticks }];
    for (let tick = 0; tick < service_ticks; tick++) {
        if (!interval[tick] || interval[mod(tick - 1, service_ticks)]) continue;
        let length = 0;
        while (interval[(tick + length) % service_ticks]) length++;
        runs.push({ start: tick, length });
    }
    return runs.sort((a, b) => a.start - b.start);
}

/** One circular run repeated every service interval over the window cycle */
export function repeatedRun(run: CircularRun, service_ticks: number, period: number): Range[] {
    const on = new Array<boolean>(period).fill(false);
    for (let base = 0; base < period; base += service_ticks) {
        for (let k = 0; k < run.length; k++) on[(base + run.start + k) % period] = true;
    }
    return rangesOf(on);
}

/** A metered taker's turns, evenly spaced: the service interval and the turn folded on it; null where they are not */
export function turnOf(turns: readonly Range[] | undefined, period: number): { service_ticks: number; turn: number } | null {
    if (turns === undefined || turns.length === 0) return null;
    const service_ticks = period / turns.length;
    if (!Number.isSafeInteger(service_ticks) || !turns.every((turn, i) => turn.start === turns[0].start + i * service_ticks)) return null;
    return { service_ticks, turn: mod(turns[0].start, service_ticks) };
}

/**
 * The relation of the outputs of other target machines to their own taker's turn, read from those whose output step left them
 * with windows (`already_bounded`): each one circular run a service interval, less its taker's turn. The relation where they
 * all agree, else the code.
 */
export function outputRelationOf(
    siblings: readonly { id: string; on: readonly boolean[] | null; taker: { service_ticks: number; turn: number } | null }[], service_ticks: number,
): { relation: CircularRun; from: string[] } | { reason: "no_output_relation" | "relations_disagree" } {
    if (siblings.length === 0) return { reason: "no_output_relation" };
    const relations: CircularRun[] = [];
    for (const sibling of siblings) {
        if (sibling.on === null || sibling.taker === null || sibling.taker.service_ticks !== service_ticks || !repeatsEvery(sibling.on, service_ticks)) {
            return { reason: "no_output_relation" };
        }
        const runs = circularRuns(sibling.on, service_ticks);
        if (runs.length !== 1 || runs[0].length >= service_ticks) return { reason: "no_output_relation" };
        relations.push({ start: mod(runs[0].start - sibling.taker.turn, service_ticks), length: runs[0].length });
    }
    if (relations.some(it => it.start !== relations[0].start || it.length !== relations[0].length)) return { reason: "relations_disagree" };
    return { relation: relations[0], from: siblings.map(it => it.id) };
}

/**
 * An output's drain run from its own machine, for a repeated group of machines planned alone, where no other target machine's
 * output gives the relation: the run ends in the tick its machine's metered taker drops its hand (the taker's turn, the circuit
 * latency, then its pickup, swing and drop), and lasts the hands the plan gives the output a service interval times its own hand's
 * whole cycle, with the margin tick. As a relation to the taker's turn on the service interval; null where it does not fit in one.
 */
export function ownOutputRelation(arm: Inserter, taker: Inserter, plan: UnclockedRun, service_ticks: number): CircularRun | null {
    const transfer = plan.run.swing_counts.get(arm.entity_id);
    if (transfer === undefined || !transfer.stack_size) return null;
    const hands = Math.ceil(transfer.total_transfer_count.toDecimal() * service_ticks / plan.run.duration.ticks);
    if (hands < 1) return null;
    const length = hands * arm.animation.total.ticks + MARGIN_SHIFT_TICKS;
    if (length >= service_ticks) return null;
    const lands = CIRCUIT_LATENCY_TICKS + taker.animation.pickup_to_drop.ticks - 1;
    return { start: mod(lands - length + 1, service_ticks), length };
}

/**
 * What the stagger step adds for a repeated group of machines planned alone (a cut group's generation): an own output the output
 * step left already bounded is eligible where no other target machine's output is its sibling, and takes its relation from its own
 * machine (`ownOutputRelation`); and each reference arm's own cluster (`clusters`: the main cluster the input step observes of an
 * input it left already bounded, with those inputs open) is one more proposal, the window the group shares, moved to each arm's turn
 */
export interface RegionStaggerOptions {
    clusters: SerializableClockWindows;
}

/** A belt-fed arm of a group, its window folded and its taker's turn */
export interface StaggerArm { id: string; on: readonly boolean[]; service_ticks: number; turn: number }

/**
 * The proposals of one group whose arms share one window: for each distinct turn of a reference arm, every arm takes the shared
 * window moved by its turn less the reference's (on the service interval). The references in order of the reference whose turn
 * is nearest at or before the shared window's start, then by turn; of arms with one turn, the first.
 */
export function staggerProposals(arms: readonly StaggerArm[], period: number, outputs: { changes: SerializableClockWindows; staggered: Record<string, Staggered> } = { changes: {}, staggered: {} }): StaggerProposal[] {
    const service_ticks = arms[0].service_ticks;
    const shared = rangesOf(arms[0].on);
    const start = circularRuns(arms[0].on, service_ticks)[0].start;
    const references = arms.filter((arm, i) => arms.findIndex(it => it.turn === arm.turn) === i)
        .sort((a, b) => mod(start - a.turn, service_ticks) - mod(start - b.turn, service_ticks) || a.turn - b.turn);
    return references.map(reference => {
        const changes: SerializableClockWindows = {};
        const staggered: Record<string, Staggered> = {};
        for (const arm of arms) {
            const shift_ticks = mod(arm.turn - reference.turn, service_ticks);
            changes[arm.id] = shiftedWindows(shared, shift_ticks, period);
            staggered[arm.id] = { kind: "staggered", role: "input", reference: reference.id, shift_ticks, service_ticks };
        }
        return { reference: reference.id, changes: { ...changes, ...outputs.changes }, staggered: { ...staggered, ...outputs.staggered } };
    });
}

/**
 * The groups of belt-fed inputs whose one shared window the step can move to each machine's own turn, and the windows it
 * proposes for them and for those machines' outputs; each other arm it looks at with its code. Null where it looks at none:
 * no metered taker, or none feeds a target machine. Only the choice (`chooseStaggeredWindows`) decides what the clock takes.
 */
export function staggeredInputWindows(
    plan: UnclockedRun, windows: SerializableClockWindows, takers: ReadonlySet<string>, output_decisions: Readonly<Record<string, OutputWindowDecision>>,
    /** Set only inside a cut group's generation (see RegionStaggerOptions) */
    region?: RegionStaggerOptions,
): { groups: StaggerGroup[]; decisions: Record<string, StaggerDecision> } | null {
    const period = plan.run.duration.ticks;
    const registry = plan.run.simulation_context.entity_registry;
    const arms = registry.getAll().filter(Entity.isInserter);
    const feeds = arms.filter(arm => takers.has(arm.entity_id.id));
    const targets = new Set(targetMachinesOf(targetItemOf(plan.config.setpoint), registry).map(machine => machine.entity_id.id));
    const fed = new Set(feeds.map(feed => feed.sink.entity_id.id).filter(id => targets.has(id)));
    if (fed.size === 0) return null;
    const decisions: Record<string, StaggerDecision> = {};
    const retain = (id: string, reason: StaggerUnproved) => { decisions[id] = { kind: "retained", reason }; };
    const takerOf = (machine: string) => {
        const feeding = feeds.filter(feed => feed.sink.entity_id.id === machine);
        return feeding.length === 1 ? turnOf(windows[feeding[0].entity_id.id], period) : null;
    };
    const fedBy = (machine: string) => feeds.filter(feed => feed.sink.entity_id.id === machine).length;
    const clocked = (arm: Inserter) => plan.run.always_enabled_by_config.has(arm.entity_id.id) || plan.run.inserter_clocks.has(arm.entity_id.id);

    // the input arms of the target machines a metered taker feeds, by the entity they take from
    const by_belt = new Map<string, { belt: EntityId; arms: StaggerArm[] }>();
    const sink_of = new Map<string, string>();
    for (const arm of arms) {
        const id = arm.entity_id.id;
        if (takers.has(id) || !fed.has(arm.sink.entity_id.id)) continue;
        if (!EntityId.isBelt(arm.source.entity_id)) { retain(id, "not_one_belt"); continue; }
        if (fedBy(arm.sink.entity_id.id) !== 1) { retain(id, "no_single_metered_taker"); continue; }
        const taker = takerOf(arm.sink.entity_id.id);
        if (taker === null) { retain(id, "uneven_turns"); continue; }
        if (clocked(arm)) { retain(id, "always_enabled"); continue; }
        const on = enabledTicks(windows[id], period);
        if (on === null || on.every(Boolean) || !on.some(Boolean)) { retain(id, "not_bounded"); continue; }
        if (!repeatsEvery(on, taker.service_ticks)) { retain(id, "window_not_periodic"); continue; }
        const belt = arm.source.entity_id;
        const group = by_belt.get(belt.id) ?? { belt, arms: [] };
        group.arms.push({ id, on, ...taker });
        sink_of.set(id, arm.sink.entity_id.id);
        by_belt.set(belt.id, group);
    }

    const groups: StaggerGroup[] = [];
    const ordered = [...by_belt.values()].map(group => ({ ...group, start: circularRuns(group.arms[0].on, group.arms[0].service_ticks)[0]?.start ?? 0 }))
        .sort((a, b) => a.belt.number - b.belt.number || a.start - b.start);
    for (const { belt, arms: members } of ordered) {
        const code = members.some(arm => arm.service_ticks !== members[0].service_ticks) ? "uneven_turns"
            : members.some(arm => arm.on.some((enabled, tick) => enabled !== members[0].on[tick])) ? "not_identical"
                : members.length < 2 ? "fewer_than_two_arms"
                    : members.every(arm => arm.turn === members[0].turn) ? "one_phase" : null;
        if (code !== null) { for (const arm of members) retain(arm.id, code); continue; }
        const service_ticks = members[0].service_ticks;

        // the outputs of the group's machines, at the relation the outputs of the other target machines keep to their own taker
        const sinks = new Set(members.map(member => sink_of.get(member.id)!));
        const outputArm = (arm: Inserter) => plan.run.output_inserter_ids.has(arm.entity_id.id) && EntityId.isMachine(arm.source.entity_id) && EntityId.isBelt(arm.sink.entity_id);
        const own = arms.filter(arm => outputArm(arm) && sinks.has(arm.source.entity_id.id));
        const no_sibling = !arms.some(arm => outputArm(arm) && targets.has(arm.source.entity_id.id) && !sinks.has(arm.source.entity_id.id)
            && output_decisions[arm.entity_id.id]?.kind === "already_bounded");
        const eligible = own.filter(arm => !clocked(arm) && (output_decisions[arm.entity_id.id]?.kind === "bounded"
            || (region !== undefined && no_sibling && output_decisions[arm.entity_id.id]?.kind === "already_bounded")));
        for (const arm of own) if (!eligible.includes(arm)) retain(arm.entity_id.id, "output_not_bounded");
        const outputs = { changes: {} as SerializableClockWindows, staggered: {} as Record<string, Staggered> };
        if (eligible.length > 0) {
            const siblings = arms.filter(arm => outputArm(arm) && targets.has(arm.source.entity_id.id) && !sinks.has(arm.source.entity_id.id)
                && output_decisions[arm.entity_id.id]?.kind === "already_bounded")
                .map(arm => ({ id: arm.entity_id.id, on: enabledTicks(windows[arm.entity_id.id], period), taker: takerOf(arm.source.entity_id.id) }));
            const relation = outputRelationOf(siblings, service_ticks);
            for (const arm of eligible) {
                const id = arm.entity_id.id;
                if ("reason" in relation && region !== undefined && siblings.length === 0) {
                    const taker = feeds.find(feed => feed.sink.entity_id.id === arm.source.entity_id.id);
                    const own_run = taker === undefined ? null : ownOutputRelation(arm, taker, plan, service_ticks);
                    if (own_run !== null) {
                        const shift_ticks = mod(own_run.start + takerOf(arm.source.entity_id.id)!.turn, service_ticks);
                        outputs.changes[id] = repeatedRun({ start: shift_ticks, length: own_run.length }, service_ticks, period);
                        outputs.staggered[id] = { kind: "staggered", role: "output", relation_from: [`own:${arm.source.entity_id.id}`], shift_ticks, service_ticks };
                        continue;
                    }
                }
                if ("reason" in relation) { retain(id, relation.reason); continue; }
                const shift_ticks = mod(relation.relation.start + takerOf(arm.source.entity_id.id)!.turn, service_ticks);
                outputs.changes[id] = repeatedRun({ start: shift_ticks, length: relation.relation.length }, service_ticks, period);
                outputs.staggered[id] = { kind: "staggered", role: "output", relation_from: relation.from, shift_ticks, service_ticks };
            }
        }
        const proposals = staggerProposals(members, period, outputs);
        // a repeated group planned alone: each reference arm's own observed cluster as the window the group shares, after the step's own
        if (region !== undefined) {
            for (const reference of proposals.map(proposal => members.find(arm => arm.id === proposal.reference)!)) {
                const cluster = enabledTicks(region.clusters[reference.id], period);
                if (cluster === null || cluster.every(Boolean) || !cluster.some(Boolean) || !repeatsEvery(cluster, service_ticks)
                    || circularRuns(cluster, service_ticks).length !== 1) continue;
                const shared = rangesOf(cluster);
                const changes: SerializableClockWindows = {};
                const staggered: Record<string, Staggered> = {};
                for (const arm of members) {
                    const shift_ticks = mod(arm.turn - reference.turn, service_ticks);
                    changes[arm.id] = shiftedWindows(shared, shift_ticks, period);
                    staggered[arm.id] = { kind: "staggered", role: "input", reference: `cluster:${reference.id}`, shift_ticks, service_ticks };
                }
                proposals.push({ reference: `cluster:${reference.id}`, changes: { ...changes, ...outputs.changes }, staggered: { ...staggered, ...outputs.staggered } });
            }
        }
        groups.push({ belt: belt.id, proposals });
    }
    return { groups, decisions };
}

/**
 * How the stagger step reads recovery: `either` (a whole build's), refused where the proposal recovers slower than the clock on one
 * copy or on the copies; `worse_of_two` (a repeated group's, judged on the whole build), refused where the worse of its two readings
 * is slower than the worse of the clock's, as the copy step reads it
 */
export type StaggerRecoveryGate = "either" | "worse_of_two";

/** What the choice found of one proposal, in the order of the proposals */
export interface StaggerOutcome {
    reference: string;
    /** Its cost (`costKey`) where it holds to the long run, else Infinity */
    cost: number;
    /** null where it was taken, or where no proposal before it in cost order was refused and none taken (not reached) */
    decision: StaggerDecision | null;
    taken: boolean;
    /** The worse of the two recovery readings of the proposal and of the clock, where the gate read them */
    recovery?: { proposal: number | null; clock: number | null };
}

const worseOfTwo = (recovery: { one_copy: number | null; copies: number | null }): number | null =>
    recovery.one_copy === null || recovery.copies === null ? null : Math.max(recovery.one_copy, recovery.copies);

/**
 * The proposal the clock takes, with the gates of the input step's choice: of those that hold to the long run with fewer
 * wake-ups than the clock (`costKey`), in ascending cost (a tie to the earlier proposal), the first that holds its whole check
 * and recovers no slower than the clock (`gate`: on one copy and on the copies, or by the worse of the two). Null where none does.
 * Each arm's decision: staggered in the proposal taken, else the code of its proposal of the lowest cost (Infinity where it does
 * not hold to the long run).
 */
export function chooseStaggeredWindows(proposals: readonly StaggerProposal[], judge: InputWindowJudge, gate: StaggerRecoveryGate = "either",
    /** Given what the choice found of each proposal, where a caller logs it */
    found?: (outcomes: StaggerOutcome[]) => void) {
    const decisions: Record<string, StaggerDecision> = {};
    const current_cost = costKey({ wake_ups_per_minute: judge.longRun({}).wake_ups });
    type Outcome = { proposal: StaggerProposal; cost: number; decision: StaggerDecision | null; recovery?: StaggerOutcome["recovery"] };
    const outcomes: Outcome[] = proposals.map(proposal => {
        const run = judge.longRun(proposal.changes);
        if (!run.holds) return { proposal, cost: Infinity, decision: { kind: "retained", reason: "joint_check_failed", stage: run.stage ?? "long_run" } };
        const cost = costKey({ wake_ups_per_minute: run.wake_ups });
        return { proposal, cost, decision: cost < current_cost ? null : { kind: "retained", reason: "no_fewer_wake_ups" } };
    });
    let taken: StaggerProposal | null = null;
    // sort is stable: of equal costs the earlier proposal comes first
    for (const outcome of outcomes.filter(it => it.decision === null).sort((a, b) => a.cost - b.cost)) {
        const stage = judge.wholeCheck(outcome.proposal.changes);
        if (stage !== null) { outcome.decision = { kind: "retained", reason: "joint_check_failed", stage }; continue; }
        const mine = judge.recovery(outcome.proposal.changes), theirs = judge.recovery({});
        if (gate === "worse_of_two") outcome.recovery = { proposal: worseOfTwo(mine), clock: worseOfTwo(theirs) };
        const slower = gate === "worse_of_two" ? recoveryWorse(worseOfTwo(mine), worseOfTwo(theirs))
            : recoveryWorse(mine.one_copy, theirs.one_copy) || recoveryWorse(mine.copies, theirs.copies);
        if (slower) {
            outcome.decision = { kind: "retained", reason: "recovery_worse" };
            continue;
        }
        taken = outcome.proposal;
        break;
    }
    found?.(outcomes.map(it => ({ reference: it.proposal.reference, cost: it.cost, decision: it.decision, taken: it.proposal === taken,
        ...(it.recovery !== undefined && { recovery: it.recovery }) })));
    const ids = [...new Set(proposals.flatMap(proposal => Object.keys(proposal.changes)))];
    for (const id of ids) {
        if (taken !== null && id in taken.changes && taken.staggered[id] !== undefined) {
            decisions[id] = taken.staggered[id];
            continue;
        }
        const mine = outcomes.filter(it => id in it.proposal.changes && it.decision !== null).sort((a, b) => a.cost - b.cost)[0];
        if (mine !== undefined) decisions[id] = mine.decision!;
    }
    return { taken, decisions };
}

/**
 * The groups judged one at a time, in their order, each against the clock the group before leaves (`judgeOn` gives the judge of
 * a clock): the clock at the end, and every arm's decision. Where groups share an arm, the arm's decision is that of the last group
 * that took a proposal holding it, the group whose windows the clock keeps; a group that did not take it never overrides it. An arm
 * no group took keeps the decision of the last group that holds it.
 */
export function chooseStaggeredGroups(groups: readonly StaggerGroup[], clock: SerializableClockWindows, judgeOn: (clock: SerializableClockWindows) => InputWindowJudge,
    gate: StaggerRecoveryGate = "either", found?: (belt: string, outcomes: StaggerOutcome[]) => void) {
    const decisions: Record<string, StaggerDecision> = {};
    const taken_ids = new Set<string>();
    let current = clock;
    for (const group of groups) {
        const choice = chooseStaggeredWindows(group.proposals, judgeOn(current), gate, found === undefined ? undefined : outcomes => found(group.belt, outcomes));
        const mine = new Set(choice.taken === null ? [] : Object.keys(choice.taken.changes).filter(id => choice.taken!.staggered[id] !== undefined));
        for (const [id, decision] of Object.entries(choice.decisions)) {
            if (mine.has(id) || !taken_ids.has(id)) decisions[id] = decision;
        }
        for (const id of mine) taken_ids.add(id);
        if (choice.taken !== null) current = { ...current, ...choice.taken.changes };
    }
    return { clock: current, decisions };
}
