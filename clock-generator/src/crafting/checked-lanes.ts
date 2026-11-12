import type { Config } from "../config/schema";
import { laneLoads } from "../config/lane-capacity-validator";
import { laneFactsOfConfig } from "../entities/traits/build-traits";
import { beltLaneFactsOf, LaneEnd, LaneSharing } from "../entities/traits/lane-facts";
import type { LaneRole } from "../entities/traits/lane-role";
import { fractionOf, Ratio } from "../entities/traits/ratio";
import { buildToNameOf } from "./build-names";
import { capitalized, chestNameInText, inserterNameInText, lanesInSentence, listedInText, textWords, theName, type BuildToName } from "./entity-name";
import { machineNameInText } from "./machine-name";
import { figure } from "./other-clocks";
import type { CopiesTrialVerdict } from "./shared-lane-trial";
import { droppedOntoSharedLanes, isNotChecked, type ClockSharedLaneLoss, type MissedSwingStops, type SharedLaneJudgement, type SharedLaneLoss,
    type SharedLaneLossFacts } from "./shared-lane-verdict";

/**
 * What a result says was checked on each lane the copies of a build share: the lanes of the build (`buildLanesOf`), and for
 * each clock its rows, its line and, for a clock that is not stable on a shared lane, the parts of the cause
 * (`checkedLanesOf`). Every figure comes from the runs a generation makes: the check of the shared lanes
 * (shared-lane-verdict.ts) and, for a clock with a loss, its runs with fewer copies on the lanes. A cause is written only
 * where the run of the copies shows it; a loss is said in swings missed.
 */

/** Where the end of a lane comes from: the lane states it, the config's `backed_up_belts` switch, an export lane, or the lane's role */
export type LaneEndGivenBy = "lane" | "switch" | "export" | "role";

/** One lane of the build, as the result lists it once */
export interface BuildLane {
    belt_id: number;
    lane: 1 | 2;
    /** The lane's item; "" for a lane with no item */
    item: string;
    role: LaneRole | null;
    end: LaneEnd["kind"];
    /** Whether the config states the end (on the lane, by the switch, as an export lane) or the lane's role gives it */
    end_given_by: LaneEndGivenBy;
    sharing: LaneSharing;
    /** Items a second entering the lane at its upstream end */
    supply_rate: number;
    /** Whether the lane states no supply rate, so that its supply rate is its capacity */
    supply_rate_by_default: boolean;
    /** Items a second the lane carries */
    capacity: number;
}

/** What the copies do together on a lane: take or drop, items a second, over the lanes the figure is for */
export interface LaneTogether {
    kind: "take" | "drop";
    items_per_second: number;
    /** The lanes of the belt the figure is over: one lane, or both where a take or drop can use either */
    lanes: number[];
    /** For a drop: items a second those lanes carry */
    carries_per_second?: number;
}

/** A copy and its swings missed of the swings it makes alone (or that its target needs, at a full join) */
export interface CopyMissed {
    copy: number;
    missed: number;
    swings: number;
}

/** The state of a row (a closed list) */
export type CheckedLaneState =
    | { kind: "holds"; not_the_cause: boolean; steady_run_only: boolean; join_waits?: { copy: number; held_hands: number; hands: number }[] }
    | { kind: "short"; copies: CopyMissed[] }
    | { kind: "join_full"; copies: (CopyMissed & { held_hands: number; hands: number })[] }
    | { kind: "takes_less"; copies: (CopyMissed & { without_output_belt?: CopyMissed })[] }
    | { kind: "rate_fits"; drop_per_second: number; carries_per_second: number }
    | { kind: "not_checked"; reason: string }
    | { kind: "not_run"; reason: string };

/** One row of a clock: one lane the copies share. Its item, role, end and supply are the build's (`BuildLane`). */
export interface CheckedLaneRow {
    belt_id: number;
    lane: 1 | 2;
    together: LaneTogether | null;
    state: CheckedLaneState;
    /** The state's short label */
    label: string;
    /** The state's one sentence */
    sentence: string;
}

/** The line of a clock: what was checked, as data and as a sentence */
export interface CheckedLine {
    /** Whether the copies were run together on the lanes they share */
    run_with_copies: boolean;
    copies: number;
    /** Whether every copy gets its items on the lanes they take from; null where they were not run */
    every_copy_gets_items: boolean | null;
    /**
     * At a stated output belt: "none waits" no copy is held back; "waits, none misses" a copy waits for room at its join
     * but misses no swing; "misses" a copy misses swings at its join. Null where no output belt is run.
     */
    output_belt: "none_waits" | "waits_none_misses" | "misses" | null;
    /** Output belts that are plain belts of the config, checked by the sum of the drops */
    plain_output_belts: number;
    /** The chests of each copy the output goes into, by kind and item */
    output_chests: { chest_id: number; kind: string; items: string[] }[];
    sentence: string;
}

/** One part of the cause of a clock that is not stable on a shared lane: its sentence, and its numbers beside it */
export interface CausePart<T = Record<string, never>> {
    text: string;
    data: T;
}

/**
 * Why a clock is not stable on a shared lane, as a code (a closed list): `belt_gaps`, at least one missed swing shows the
 * gap that the copy before leaves on the lane
 */
export type SharedLaneReasonCode = "belt_gaps";

/** The reason beside the status of a clock: its code, and the totals over the copies of the cause part */
export interface SharedLaneReason {
    code: SharedLaneReasonCode;
    data: { missed: number; with_gap: number };
}

/** The parts of the cause of a clock that is not stable on a shared lane, as the page lays them out */
export interface SharedLaneCause {
    /** "lane": a copy gets too few items; "join": a copy's side belt is full where it joins the output belt */
    kind: "lane" | "join";
    headline: CausePart<{ copies: CopyMissed[] }>;
    /** What the run of the copies shows stopped the missed swings; null where it shows nothing it can name */
    cause: CausePart<{ copies: ({ copy: number } & Partial<MissedSwingStops>)[] }> | null;
    /**
     * The reason beside the status of the clock, as a code and its counts (the page has the words): on a lane loss where at
     * least one missed swing shows the gap that the copy before leaves, `belt_gaps`, with the missed swings of the copies the
     * cause part counts and how many of them show the gap. Absent on any other loss.
     */
    reason?: SharedLaneReason;
    /** The reason from the spacing: only where the run shows the gap that the copy before leaves */
    spacing: CausePart<{ step_tiles: number; travel_ticks: number; window_cycle_ticks: number; take_all: boolean }> | null;
    where: CausePart<{ takers: { copy: number; inserter_id: number; missed: number; swings: number; items: { item: string; missed: number; swings: number }[] }[] }>;
    alone: CausePart<{ makes_all: boolean; missed: number; swings: number }>;
    /** What changes it: fewer copies whose run holds, and another clock of the result that holds with all copies */
    changes: CausePart<{ fewer_copies: number | null; other_clock: { id: string; label: string; window_cycle_ticks: number } | null }> | null;
}

/** What a result says was checked of one clock on the lanes its copies share */
export interface CheckedLanes {
    line: CheckedLine;
    rows: CheckedLaneRow[];
    cause: SharedLaneCause | null;
}

/** What the check of a clock's shared lanes found with fewer copies on the lanes (shared-lane-verdict.ts `fewerCopiesThatHold`) */
export interface FewerCopiesFound {
    /** The largest count of copies on the lanes whose own run holds; null where none does */
    copies: number | null;
    /** Where the run with one copy on the lanes was made and does not hold: that copy's swings missed, by inserter */
    one_copy_short?: { inserter_id: number; missed: number; swings: number }[];
}

/** What a clock's check of its shared lanes gives the rows */
export interface CheckedLanesInput {
    config: Config;
    /** Whether the clock holds its output on one copy: only such a clock is run with the copies */
    holds: boolean;
    /** The check of the shared lanes; null where it was not made; the loss that says it stopped, where it stopped */
    judged: SharedLaneJudgement | { stopped: ClockSharedLaneLoss } | null;
    window_cycle_ticks: number;
    /** The disturbance trials on the copies, where they were made */
    copies_trial: CopiesTrialVerdict | null;
    fewer: FewerCopiesFound | null;
}

/** A rate as data: a decimal to the ninth place, so that a sum of float rates reads as the rate it is */
const rounded = (value: number) => Math.round(value * 1e9) / 1e9;
const ratio = (value: Ratio) => rounded(fractionOf(value).toDecimal());

/** Where the end of lane `index` of `belt` comes from */
function endGivenBy(config: Config, belt: Config["belts"][number], index: number): LaneEndGivenBy {
    const listed: readonly { ingredient: string; lane_end?: unknown; consumption_per_second?: unknown }[] = belt.lanes;
    const stated = listed[index];
    if (stated.lane_end !== undefined) return "lane";
    if (stated.consumption_per_second !== undefined) return "export";
    if (config.overrides?.backed_up_belts !== undefined) return "switch";
    // a lane with no item has the end of the other lane of its belt
    const other = listed[1 - index];
    if (stated.ingredient === "" && other !== undefined && other.ingredient !== "") return other.lane_end !== undefined ? "lane" : other.consumption_per_second !== undefined ? "export" : "role";
    return "role";
}

/** Every lane the belts of a config state, belt by belt and lane 1 first: what the result lists once, whatever the copies */
export function buildLanesOf(config: Config): BuildLane[] {
    const facts = laneFactsOfConfig(config);
    const roles = { of: (belt_id: number, lane: 1 | 2) => facts.of(belt_id, lane).role };
    return beltLaneFactsOf(config, roles).map(lane => {
        const belt = config.belts.find(it => it.id === lane.belt_id)!;
        return { belt_id: lane.belt_id, lane: lane.lane, item: belt.lanes[lane.lane - 1].ingredient, role: lane.role, end: lane.lane_end.kind,
            end_given_by: endGivenBy(config, belt, lane.lane - 1), sharing: lane.sharing, supply_rate: ratio(lane.supply_rate),
            supply_rate_by_default: lane.supply_rate_by_default, capacity: ratio(lane.capacity) };
    });
}

/** The lanes that have a row: those the copies share, with an item and a role */
export function sharedLanesOf(config: Config, lanes: readonly BuildLane[] = buildLanesOf(config)): BuildLane[] {
    if (!(config.setpoint.copies > 1)) return [];
    return lanes.filter(lane => lane.sharing === "shared" && lane.item !== "" && lane.role !== null);
}

/** The belts the config's output inserters drop the target's item onto, and the chests they or the machines put it into */
function outputEndsOf(config: Config): { belts: Set<number>; chests: Set<number> } {
    const item = config.setpoint.recipe;
    const belts = new Set<number>(), chests = new Set<number>();
    const makers = new Set(config.machines.filter(machine => machine.recipe === item).map(machine => machine.id));
    for (const inserter of config.inserters) {
        if (inserter.source.type !== "machine" || !makers.has(inserter.source.id)) continue;
        if (inserter.sink.type === "belt" && config.belts.find(belt => belt.id === inserter.sink.id)?.lanes.some(lane => lane.ingredient === item)) belts.add(inserter.sink.id);
        if (inserter.sink.type === "chest") chests.add(inserter.sink.id);
    }
    for (const machine of config.machines) {
        if (makers.has(machine.id) && machine.result_target?.type === "chest") chests.add(machine.result_target.id);
    }
    return { belts, chests };
}

/** The output inserter of the config that drops the target's item onto a belt, by number; undefined where there is not one */
function outputInserterOf(config: Config): number | undefined {
    const item = config.setpoint.recipe;
    const found = config.inserters.flatMap((inserter, index) => inserter.sink.type === "belt"
        && config.belts.find(belt => belt.id === inserter.sink.id)?.lanes.some(lane => lane.ingredient === item) ? [inserter.id ?? index + 1] : []);
    return found.length === 1 ? found[0] : undefined;
}

/**
 * Lanes named by their items in a sentence: "the copper plate lane", "the iron gear wheel and copper plate lanes"; where an
 * item is on more than one lane of the build, as lanesInSentence names them
 */
function lanesNamed(lanes: readonly { belt_id: number; lane: number }[], config: Config, build: BuildToName): string {
    const items = lanes.map(it => config.belts.find(belt => belt.id === it.belt_id)?.lanes[it.lane - 1]?.ingredient ?? "");
    const all = config.belts.flatMap(belt => belt.lanes.map(lane => lane.ingredient));
    const unique = items.every(item => item !== "" && all.filter(it => it === item).length === 1);
    if (!unique || lanes.length === 0) return lanesInSentence(lanes, build);
    return `the ${listedInText(items.map(textWords().item))} ${lanes.length === 1 ? "lane" : "lanes"}`;
}

/** "copy 2", "copies 4 and 8" */
const copiesNamed = (copies: readonly number[]) => copies.length === 1 ? `copy ${copies[0]}` : `copies ${listedInText(copies.map(String))}`;

/** "Copy 2 misses 3 of 65 swings", "Copies 4 and 8 miss 42 of 378 swings each", "Copy 2 misses 9 of 65 swings, and copy 3 misses 4 of 65" */
function missedSentence(copies: readonly CopyMissed[]): string {
    const same = copies.every(it => it.missed === copies[0].missed && it.swings === copies[0].swings);
    if (copies.length === 1) return `Copy ${copies[0].copy} misses ${figure(copies[0].missed)} of ${figure(copies[0].swings)} swings`;
    if (same) return `${capitalized(copiesNamed(copies.map(it => it.copy)))} miss ${figure(copies[0].missed)} of ${figure(copies[0].swings)} swings each`;
    const [first, ...rest] = copies;
    return `Copy ${first.copy} misses ${figure(first.missed)} of ${figure(first.swings)} swings, and `
        + listedInText(rest.map(it => `copy ${it.copy} misses ${figure(it.missed)} of ${figure(it.swings)}`));
}

/** Whether a loss is on lane `lane` of belt `belt_id`: its own lane or one of its other lanes */
const onLane = (loss: SharedLaneLoss, belt_id: number, lane: number) => loss.belt_id === belt_id
    && (loss.lane === lane || (loss.other_lanes ?? []).some(other => other.lane === lane));

/** The copies short on a lane: each copy's swings missed of its swings alone, summed over its takers of the lane */
function copiesShortOn(losses: readonly SharedLaneLoss[]): CopyMissed[] {
    const by_copy = new Map<number, CopyMissed>();
    for (const loss of losses) {
        const known = by_copy.get(loss.copy) ?? { copy: loss.copy, missed: 0, swings: 0 };
        by_copy.set(loss.copy, { copy: loss.copy, missed: known.missed + Math.max(0, loss.alone_swings - loss.swings), swings: known.swings + loss.alone_swings });
    }
    return [...by_copy.values()].sort((a, b) => a.copy - b.copy);
}

/** Each copy at a full join once: its swings missed of those its target needs, and its held hands */
function copiesAtFullJoin(losses: readonly SharedLaneLoss[]): (CopyMissed & { held_hands: number; hands: number })[] {
    const by_copy = new Map<number, CopyMissed & { held_hands: number; hands: number }>();
    for (const loss of losses) {
        const join = loss.join_full!;
        const swings = join.target_swings ?? join.hands;
        by_copy.set(loss.copy, { copy: loss.copy, missed: Math.max(0, swings - join.hands), swings, held_hands: join.held_hands, hands: join.hands });
    }
    return [...by_copy.values()].sort((a, b) => a.copy - b.copy);
}

/** The copies' together on a lane, from the targets' takes and drops of one copy (laneLoads) times the copies */
function togetherOf(config: Config, lane: BuildLane, loads: ReturnType<typeof laneLoads> | null): LaneTogether | null {
    if (loads === null) return null;
    const kind = lane.role === "output" ? "drop" : "take";
    const of_belt = loads.filter(load => load.kind === kind && load.belt_id === lane.belt_id && load.lanes.includes(lane.lane));
    if (of_belt.length === 0) return null;
    const load = of_belt.find(it => it.lanes.length === 1) ?? of_belt.reduce((a, b) => b.lanes.length > a.lanes.length ? b : a);
    const copies = config.setpoint.copies;
    return { kind, items_per_second: rounded(load.items_per_second.toDecimal() * copies), lanes: [...load.lanes],
        ...(kind === "drop" && { carries_per_second: rounded(load.capacity_per_second.toDecimal()) }) };
}

/** A label and a sentence for each state */
function wordsOf(state: CheckedLaneState, copies: number): { label: string; sentence: string } {
    switch (state.kind) {
        case "holds": {
            const steady = state.steady_run_only ? " in the steady run" : "";
            const label = state.not_the_cause ? "Not the cause" : "Holds";
            if (state.join_waits === undefined) return { label, sentence: `Every copy gets its items${steady}.` };
            const waiting = state.join_waits.filter(it => it.held_hands > 0);
            if (waiting.length === 0) return { label, sentence: `No copy waits at its join${steady}.` };
            const same = waiting.every(it => it.held_hands === waiting[0].held_hands && it.hands === waiting[0].hands);
            const one = waiting.length === 1;
            const counts = same ? `${figure(waiting[0].held_hands)} of ${one ? "its" : "their"} ${figure(waiting[0].hands)} swings`
                : listedInText(waiting.map(it => `${figure(it.held_hands)} of ${figure(it.hands)} swings of copy ${it.copy}`));
            return { label, sentence: `${capitalized(copiesNamed(waiting.map(it => it.copy)))} ${one ? "waits" : "wait"} for room at ${one ? "its" : "their"} join in ${counts}${steady}. No swing is missed.` };
        }
        case "short":
            return { label: `Short on ${copiesNamed(state.copies.map(it => it.copy))}`, sentence: `${missedSentence(state.copies)}.` };
        case "join_full": {
            const same = state.copies.every(it => it.missed === state.copies[0].missed && it.swings === state.copies[0].swings);
            const sentence = state.copies.length === 1 ? `${figure(state.copies[0].missed)} of ${figure(state.copies[0].swings)} swings missed.`
                : same ? `${figure(state.copies[0].missed)} of ${figure(state.copies[0].swings)} swings missed, on each.`
                    : state.copies.map(it => `Copy ${it.copy}: ${figure(it.missed)} of ${figure(it.swings)} swings missed.`).join(" ");
            return { label: `Join full on ${copiesNamed(state.copies.map(it => it.copy))}`, sentence };
        }
        case "takes_less": {
            const one = state.copies.length === 1;
            const still = state.copies.filter(it => it.without_output_belt !== undefined && it.without_output_belt.missed > 0)
                .map(it => ` Without the output belt, copy ${it.copy} still misses ${figure(it.without_output_belt!.missed)} of ${figure(it.without_output_belt!.swings)} swings here.`).join("");
            return { label: `${capitalized(copiesNamed(state.copies.map(it => it.copy)))} ${one ? "takes" : "take"} less`,
                sentence: `${one ? "It waits" : "They wait"} for the output belt.${still}` };
        }
        case "rate_fits":
            return { label: "Rate fits", sentence: `The ${figure(copies)} copies together drop no more than this lane carries. `
                + "Not simulated: a copy that drops onto a belt that already carries the other copies' items." };
        case "not_checked":
            return { label: "Not checked", sentence: state.reason };
        case "not_run":
            return { label: "Not run with the copies", sentence: state.reason };
    }
}

const NOT_RUN = "The clock does not hold its output on one copy, so the copies are not run.";
const DROPPED_ONTO = "The build drops items onto this belt, and the check of a shared lane does not run those drops yet.";
const NO_DROP_RATE = "The build's drop rate onto this lane is not known.";
const NOT_IN_MODEL = "The check of the shared lanes does not run this lane.";
const OUTPUT_BELT_NOT_RUN ="The output belt is run with the copies only together with a lane they take from, and no such lane is run.";

/**
 * The rows, the line and the parts of the cause of one clock, from its check of the lanes its copies share (see the
 * module's description); null for a build of one copy
 */
export function checkedLanesOf(input: CheckedLanesInput): CheckedLanes | null {
    const { config, holds, judged, window_cycle_ticks, copies_trial, fewer } = input;
    const copies = config.setpoint.copies;
    if (!(copies > 1)) return null;
    const build = buildToNameOf(config);
    const lanes = sharedLanesOf(config);
    let loads: ReturnType<typeof laneLoads> | null;
    try {
        loads = laneLoads(config);
    } catch {
        loads = null;
    }
    const dropped = new Set(droppedOntoSharedLanes(config).map(it => `${it.belt_id}/${it.lane}`));
    const ends = outputEndsOf(config);
    const stated_output_belt = config.output_belt !== undefined && ends.belts.size === 1 ? [...ends.belts][0] : undefined;
    const judgement = judged !== null && !("stopped" in judged) ? judged : null;
    const stopped = judged !== null && "stopped" in judged ? judged.stopped : null;
    const run = holds && judgement !== null && judgement.simulated;
    const ran_lanes = new Set(judgement?.lanes ?? []);
    const losses = (judgement?.losses ?? []).filter(loss => !isNotChecked(loss));
    const facts = judgement?.loss_facts ?? [];
    const lane_losses = losses.filter(loss => loss.join_full === undefined);
    const join_losses = losses.filter(loss => loss.join_full !== undefined);
    const unstable_on_lanes = losses.length > 0;
    const trial_failed = copies_trial !== null && !copies_trial.survives && copies_trial.not_tried === undefined;

    const rows: CheckedLaneRow[] = lanes.map(lane => {
        const key = `${lane.belt_id}/${lane.lane}`;
        const together = togetherOf(config, lane, loads);
        const plain_output = lane.role === "output" && lane.belt_id !== stated_output_belt;
        const state = ((): CheckedLaneState => {
            if (!holds) return { kind: "not_run", reason: NOT_RUN };
            if (plain_output) {
                if (together === null || together.carries_per_second === undefined) return { kind: "not_checked", reason: NO_DROP_RATE };
                return together.items_per_second <= together.carries_per_second + 1e-9
                    ? { kind: "rate_fits", drop_per_second: together.items_per_second, carries_per_second: together.carries_per_second }
                    : { kind: "not_checked", reason: `The ${figure(copies)} copies together drop more than this lane carries.` };
            }
            if (dropped.has(key)) return { kind: "not_checked", reason: DROPPED_ONTO };
            if (stopped !== null) return { kind: "not_checked", reason: stopped.text };
            if (!run) return { kind: "not_checked", reason: lane.role === "output" ? OUTPUT_BELT_NOT_RUN : NOT_IN_MODEL };
            if (lane.role === "output") {
                const at_join = copiesAtFullJoin(join_losses);
                if (at_join.length > 0) return { kind: "join_full", copies: at_join };
                return { kind: "holds", not_the_cause: unstable_on_lanes, steady_run_only: trial_failed && !unstable_on_lanes, join_waits: judgement!.join_waits ?? [] };
            }
            if (!ran_lanes.has(key)) return { kind: "not_checked", reason: NOT_IN_MODEL };
            const short = lane_losses.filter(loss => onLane(loss, lane.belt_id, lane.lane));
            if (short.length > 0) return { kind: "short", copies: copiesShortOn(short) };
            const waiting = join_losses.filter(loss => onLane(loss, lane.belt_id, lane.lane));
            if (waiting.length > 0) {
                const by_copy = copiesShortOn(waiting);
                return { kind: "takes_less", copies: by_copy.map(it => {
                    const without = waiting.filter(loss => loss.copy === it.copy).map(loss => facts[losses.indexOf(loss)]?.without_output_belt)
                        .filter((there): there is NonNullable<SharedLaneLossFacts["without_output_belt"]> => there !== undefined);
                    return without.length === 0 ? it : { ...it, without_output_belt: { copy: it.copy,
                        missed: without.reduce((sum, there) => sum + Math.max(0, there.alone_swings - there.swings), 0),
                        swings: without.reduce((sum, there) => sum + there.alone_swings, 0) } };
                }) };
            }
            return { kind: "holds", not_the_cause: unstable_on_lanes, steady_run_only: trial_failed && !unstable_on_lanes };
        })();
        return { belt_id: lane.belt_id, lane: lane.lane, together, state, ...wordsOf(state, copies) };
    });
    // the lanes that are short or full first, then by belt and lane
    const first = (row: CheckedLaneRow) => row.state.kind === "short" || row.state.kind === "join_full" ? 0 : 1;
    rows.sort((a, b) => first(a) - first(b) || a.belt_id - b.belt_id || a.lane - b.lane);

    const line = lineOf({ config, build, rows, run, holds, lane_losses, join_losses, judgement, trial_failed, copies_trial, ends, stated_output_belt });
    const cause = run && losses.length > 0 ? causeOf({ config, build, losses, facts, window_cycle_ticks, fewer, loads, lanes: [...ran_lanes] }) : null;
    return { line, rows, cause };
}

function lineOf(input: { config: Config; build: BuildToName; rows: readonly CheckedLaneRow[]; run: boolean; holds: boolean; lane_losses: readonly SharedLaneLoss[];
    join_losses: readonly SharedLaneLoss[]; judgement: SharedLaneJudgement | null; trial_failed: boolean; copies_trial: CopiesTrialVerdict | null;
    ends: { belts: Set<number>; chests: Set<number> }; stated_output_belt: number | undefined }): CheckedLine {
    const { config, build, rows, run, holds, lane_losses, join_losses, judgement, trial_failed, copies_trial, ends, stated_output_belt } = input;
    const copies = config.setpoint.copies;
    const plain_output_belts = new Set(rows.filter(row => row.state.kind === "rate_fits").map(row => row.belt_id)).size;
    const output_chests = [...ends.chests].map(id => {
        const chest = build.chests.find(it => it.id === id);
        return { chest_id: id, kind: chest?.kind ?? "", items: [...chest?.holds ?? []] };
    });
    const plain = plain_output_belts === 0 ? "" : plain_output_belts === 1 ? " On the output belt, only the sum of the drops is checked."
        : ` On the ${plain_output_belts} output belts, only the sum of the drops is checked.`;
    const chests = output_chests.length === 0 ? "" : ` The output goes into a chest of each copy: ${listedInText(output_chests.map(it => theName(chestNameInText(it.chest_id, build))))}.`;
    const base = { copies, plain_output_belts, output_chests };
    if (!holds) {
        return { ...base, run_with_copies: false, every_copy_gets_items: null, output_belt: null,
            sentence: `Not run with the copies: the clock does not hold its output on one copy.${plain}${chests}` };
    }
    if (!run) {
        return { ...base, run_with_copies: false, every_copy_gets_items: null, output_belt: null,
            sentence: `Checked on one copy. No lane the copies take from is run with every copy on it.${plain}${chests}` };
    }
    const short_copies = [...new Set(lane_losses.map(loss => loss.copy))].sort((a, b) => a - b);
    const join_copies = [...new Set(join_losses.map(loss => loss.copy))].sort((a, b) => a - b);
    const waits = (judgement?.join_waits ?? []).some(it => it.held_hands > 0);
    const output_belt = stated_output_belt === undefined ? null : join_copies.length > 0 ? "misses" as const
        : judgement?.join_waits === undefined ? null : waits ? "waits_none_misses" as const : "none_waits" as const;
    const steady = trial_failed && short_copies.length === 0 && join_copies.length === 0 ? " in the steady run" : "";
    const items = short_copies.length === 0 ? `Every copy gets its items${steady}` : `${capitalized(copiesNamed(short_copies))} ${short_copies.length === 1 ? "does" : "do"} not get all ${short_copies.length === 1 ? "its" : "their"} items`;
    const at_belt = output_belt === null ? "" : output_belt === "misses" ? `, and ${copiesNamed(join_copies)} ${join_copies.length === 1 ? "misses" : "miss"} swings at the output belt`
        : output_belt === "waits_none_misses" ? ", and no copy misses a swing at the output belt" : ", and no copy is held back at the output belt";
    const trial = trial_failed && copies_trial?.text !== undefined ? ` ${copies_trial.text}` : "";
    return { ...base, run_with_copies: true, every_copy_gets_items: short_copies.length === 0, output_belt,
        sentence: `Checked with all ${figure(copies)} copies on the lanes they share. ${items}${at_belt}.${plain}${chests}${trial}` };
}

/** "the inserter of copy 2 that takes iron gear wheel and copper plate": the name of an inserter with its copy */
function inserterOfCopy(inserter_id: number, copy: number, build: BuildToName): string {
    const name = inserterNameInText(inserter_id, build);
    const of_copy = /^inserter( \(inserter \d+\))?/.test(name) ? name.replace(/^inserter( \(inserter \d+\))?/, match => `${match} of copy ${copy}`) : `${name} of copy ${copy}`;
    return theName(of_copy);
}

/** The machine an inserter of the config puts into, named; undefined where it puts into no machine */
function sinkMachineOf(config: Config, inserter_id: number): string | undefined {
    const inserter = config.inserters.find((it, index) => (it.id ?? index + 1) === inserter_id);
    if (inserter?.sink.type !== "machine") return undefined;
    const sink_id = inserter.sink.id;
    const machine = config.machines.find(it => it.id === sink_id);
    return machine === undefined ? undefined : machineNameInText(machine, config.machines);
}

function causeOf(input: { config: Config; build: BuildToName; losses: readonly SharedLaneLoss[]; facts: readonly SharedLaneLossFacts[]; window_cycle_ticks: number;
    fewer: FewerCopiesFound | null; loads: ReturnType<typeof laneLoads> | null; lanes: string[] }): SharedLaneCause {
    const { config, build, losses, facts, window_cycle_ticks, fewer, loads } = input;
    const words = textWords();
    const factsOf = (loss: SharedLaneLoss) => facts[losses.indexOf(loss)];
    const lane_losses = losses.filter(loss => loss.join_full === undefined);
    const kind = lane_losses.length > 0 ? "lane" as const : "join" as const;
    const ran = input.lanes.map(key => { const [belt_id, lane] = key.split("/").map(Number); return { belt_id, lane }; });
    const changes = (other: string | null): SharedLaneCause["changes"] => {
        // at a full join the copies are fewer on the output belt as well as on the lanes they take from: the lanes are not named
        const fewer_text = fewer?.copies === null || fewer?.copies === undefined ? null
            : `With ${figure(fewer.copies)} ${fewer.copies === 1 ? "copy" : "copies"}${kind === "join" ? "" : ` on ${lanesNamed(ran, config, build)}`}, every copy makes every swing.`;
        return fewer_text === null && other === null ? null : { text: [fewer_text, other].filter(it => it !== null).join(" "),
            data: { fewer_copies: fewer?.copies ?? null, other_clock: null } };
    };
    if (kind === "join") {
        const at_join = copiesAtFullJoin(losses);
        const named = at_join.map(it => it.copy);
        const output_item = words.item(config.setpoint.recipe);
        const one = named.length === 1;
        const output_inserter = outputInserterOf(config);
        const swinger = (copy: number) => output_inserter === undefined ? `the output inserter of copy ${copy}` : inserterOfCopy(output_inserter, copy, build);
        const same = at_join.every(it => it.missed === at_join[0].missed && it.swings === at_join[0].swings && it.held_hands === at_join[0].held_hands && it.hands === at_join[0].hands);
        const where = same
            ? `${capitalized(swinger(at_join[0].copy))} misses ${figure(at_join[0].missed)} of its ${figure(at_join[0].swings)} swings in ${losses[0].window_cycles} window cycles`
                + (one ? "." : `, and so ${at_join.length === 2 ? "does that" : "do those"} of ${copiesNamed(named.slice(1))}.`)
                + ` ${figure(at_join[0].held_hands)} of the ${figure(at_join[0].hands)} swings ${one ? "it makes wait" : "each one makes wait"} for room.`
            : at_join.map(it => `${capitalized(swinger(it.copy))} misses ${figure(it.missed)} of its ${figure(it.swings)} swings in ${losses[0].window_cycles} window cycles. `
                + `${figure(it.held_hands)} of the ${figure(it.hands)} swings it makes wait for room.`).join(" ");
        const alone_swings = losses.map(factsOf).find(it => it?.alone_output_swings !== undefined)?.alone_output_swings;
        const needed = at_join[0].swings;
        const makes_all = alone_swings !== undefined && alone_swings >= needed;
        return {
            kind,
            headline: { text: missedSentence(at_join), data: { copies: at_join.map(({ copy, missed, swings }) => ({ copy, missed, swings })) } },
            cause: { text: `The side ${one ? "belt" : "belts"} of ${copiesNamed(named)} ${one ? "is" : "are"} full where ${one ? "it joins" : "they join"} the ${output_item} output belt.`,
                data: { copies: named.map(copy => ({ copy })) } },
            spacing: null,
            where: { text: where, data: { takers: at_join.map(it => ({ copy: it.copy, inserter_id: output_inserter ?? 0, missed: it.missed, swings: it.swings,
                items: [{ item: config.setpoint.recipe, missed: it.missed, swings: it.swings }] })) } },
            alone: { text: alone_swings === undefined ? "The run of one copy alone does not record the output inserter."
                : makes_all ? `The same inserter makes all ${figure(needed)} swings. The clock is right for one copy.`
                    : `Alone, the same inserter makes ${figure(alone_swings)} of the ${figure(needed)} swings its target needs.`,
            data: { makes_all, missed: alone_swings === undefined ? 0 : Math.max(0, needed - alone_swings), swings: needed } },
            changes: changes(null),
        };
    }
    // a lane loss: each copy short, each of its takers with its items, and what stopped its missed swings
    const short = copiesShortOn(lane_losses);
    const takers = new Map<string, { copy: number; inserter_id: number; items: { item: string; missed: number; swings: number; short_swings: number; hand: number }[];
        stops?: MissedSwingStops; window_cycles: number }>();
    for (const loss of lane_losses) {
        const key = `${loss.copy}|${loss.inserter_id}`;
        const taker = takers.get(key) ?? { copy: loss.copy, inserter_id: loss.inserter_id, items: [], window_cycles: loss.window_cycles };
        taker.items.push({ item: loss.item, missed: Math.max(0, loss.alone_swings - loss.swings), swings: loss.alone_swings, short_swings: loss.short_swings, hand: factsOf(loss)?.hand ?? 0 });
        taker.stops ??= factsOf(loss)?.stops;
        takers.set(key, taker);
    }
    const of_takers = [...takers.values()].sort((a, b) => a.copy - b.copy || a.inserter_id - b.inserter_id);
    const where = of_takers.map(taker => {
        const missed = taker.items.reduce((sum, it) => sum + it.missed, 0), swings = taker.items.reduce((sum, it) => sum + it.swings, 0);
        const by_item = taker.items.length < 2 ? "" : `: ${listedInText(taker.items.map(it => `${figure(it.missed)} with ${words.item(it.item)}`))}`;
        const hands = new Set(taker.items.map(it => it.hand));
        const fewer_items = taker.items.reduce((sum, it) => sum + it.short_swings, 0);
        const hand = fewer_items > 0 ? ` ${figure(fewer_items)} of the swings it makes carry fewer items.` : hands.size === 1 ? ` Each swing is a hand of ${figure([...hands][0])}.` : "";
        return `${capitalized(inserterOfCopy(taker.inserter_id, taker.copy, build))} misses ${figure(missed)} of its ${figure(swings)} swings in ${taker.window_cycles} window cycles${by_item}.${hand}`;
    }).join(" ");
    // the cause, copy by copy, only where its missed swings by window cycle add up to its swings missed
    const cause_parts: ({ copy: number } & Partial<MissedSwingStops>)[] = [];
    const cause_texts: string[] = [];
    const spacing_items = new Set<string>();
    let spacing_facts: SharedLaneLossFacts | undefined;
    for (const copy of short) {
        const own = of_takers.filter(it => it.copy === copy.copy);
        const stops = own.map(it => it.stops);
        if (stops.some(it => it === undefined)) continue;
        const sum = (key: "missed" | "lane_empty" | "gap_from_copy_before" | "machine_full" | "both" | "neither") => stops.reduce((total, it) => total + it![key], 0);
        const total = sum("missed");
        if (total !== copy.missed || total === 0) continue;
        const found = { missed: total, lane_empty: sum("lane_empty"), gap_from_copy_before: sum("gap_from_copy_before"), machine_full: sum("machine_full"),
            both: sum("both"), neither: sum("neither"), lane_items: [...new Set(stops.flatMap(it => it!.lane_items))], gap_items: [...new Set(stops.flatMap(it => it!.gap_items))] };
        cause_parts.push({ copy: copy.copy, ...found });
        const of_total = (count: number) => count === total ? "" : `In ${figure(count)} of the ${figure(total)} missed swings, `;
        const lanesOfItems = (items: readonly string[]) => lanesNamed(ran.filter(it => items.includes(config.belts.find(belt => belt.id === it.belt_id)?.lanes[it.lane - 1]?.ingredient ?? "")), config, build);
        const sentences: string[] = [];
        if (found.gap_from_copy_before > 0) {
            const prefix = of_total(found.gap_from_copy_before);
            sentences.push(`${prefix}${prefix === "" ? "The" : "the"} gap that copy ${copy.copy - 1} leaves on ${lanesOfItems(found.gap_items)} reaches copy ${copy.copy} when its inserter must pick up.`);
            found.gap_items.forEach(it => spacing_items.add(it));
            spacing_facts ??= lane_losses.filter(loss => loss.copy === copy.copy).map(factsOf).find(it => it !== undefined);
        }
        const empty_other = found.lane_empty - found.gap_from_copy_before;
        if (empty_other > 0) {
            const prefix = of_total(empty_other);
            sentences.push(`${prefix}${prefix === "" ? "C" : "c"}opy ${copy.copy} finds ${lanesOfItems(found.lane_items)} empty in the reach of its inserter while its hand fills.`);
        }
        if (found.machine_full > 0) {
            const machines = [...new Set(own.map(it => sinkMachineOf(config, it.inserter_id)))];
            // "the assembling machine 3 of copy 2 that makes automation science pack"
            const machine = machines.length === 1 && machines[0] !== undefined
                ? `the ${/ that makes /.test(machines[0]) ? machines[0].replace(/ that makes /, ` of copy ${copy.copy} that makes `) : `${machines[0]} of copy ${copy.copy}`}`
                : `the machine of copy ${copy.copy}`;
            const prefix = of_total(found.machine_full);
            sentences.push(`${prefix}${prefix === "" ? capitalized(machine) : machine} has its output full and takes no more items.`
                + (found.both === 0 ? "" : found.both === total ? " Each of them shows both." : ` ${figure(found.both)} of the ${figure(total)} show both.`));
        }
        if (found.neither > 0) sentences.push(`${of_total(found.neither) === "" ? "In each" : `In ${figure(found.neither)} of the ${figure(total)}`}, the run shows neither an empty reach nor a full output.`);
        cause_texts.push(sentences.join(" "));
    }
    // the reason from the spacing: only where the run shows the copy before's gap
    let spacing: SharedLaneCause["spacing"] = null;
    if (spacing_facts !== undefined && spacing_items.size > 0) {
        const gap_lanes = ran.filter(it => spacing_items.has(config.belts.find(belt => belt.id === it.belt_id)?.lanes[it.lane - 1]?.ingredient ?? ""));
        const lane_facts = laneFactsOfConfig(config);
        const take_all = loads !== null && gap_lanes.every(it => {
            const load = loads.find(one => one.kind === "take" && one.belt_id === it.belt_id && one.lanes.length === 1 && one.lanes[0] === it.lane);
            return load !== undefined && load.items_per_second.toDecimal() * config.setpoint.copies >= ratio(lane_facts.of(it.belt_id, it.lane as 1 | 2).supply_rate) - 1e-9;
        });
        const items = listedInText([...spacing_items].map(words.item));
        spacing = {
            text: `The copies stand ${figure(spacing_facts.step_tiles)} tiles apart. It takes ${figure(spacing_facts.travel_ticks)} ticks for items to travel between copies, `
                + `and the window cycle is ${figure(window_cycle_ticks)} ticks.`
                + (take_all ? ` The ${figure(config.setpoint.copies)} copies take every ${items} the ${gap_lanes.length === 1 ? "lane brings" : `${gap_lanes.length === 2 ? "two " : ""}lanes bring`}, so the gap does not close on the way.` : ""),
            data: { step_tiles: spacing_facts.step_tiles, travel_ticks: spacing_facts.travel_ticks, window_cycle_ticks, take_all },
        };
    }
    // the reason beside the status: only where at least one missed swing shows the copy before's gap
    const with_gap = cause_parts.reduce((sum, it) => sum + (it.gap_from_copy_before ?? 0), 0);
    const reason: SharedLaneCause["reason"] = with_gap > 0
        ? { code: "belt_gaps", data: { missed: cause_parts.reduce((sum, it) => sum + (it.missed ?? 0), 0), with_gap } }
        : undefined;
    // one copy alone: the copy that misses the most
    const worst = [...short].sort((a, b) => b.missed - a.missed || a.copy - b.copy)[0];
    const worst_takers = of_takers.filter(it => it.copy === worst.copy).map(it => it.inserter_id);
    const one_copy = (fewer?.one_copy_short ?? []).filter(it => worst_takers.includes(it.inserter_id));
    const plural = worst_takers.length > 1;
    const alone = one_copy.length > 0
        ? { text: `With one copy alone on the lanes, the same ${plural ? "inserters miss" : "inserter misses"} ${figure(one_copy.reduce((s, it) => s + it.missed, 0))} of `
            + `${figure(one_copy.reduce((s, it) => s + it.swings, 0))} swings.`, data: { makes_all: false, missed: one_copy.reduce((s, it) => s + it.missed, 0), swings: one_copy.reduce((s, it) => s + it.swings, 0) } }
        : { text: `The same ${plural ? "inserters make" : "inserter makes"} all ${figure(worst.swings)} swings. The clock is right for one copy.`, data: { makes_all: true, missed: 0, swings: worst.swings } };
    return {
        kind,
        headline: { text: missedSentence(short), data: { copies: short } },
        cause: cause_texts.length === 0 ? null : { text: cause_texts.join(" "), data: { copies: cause_parts } },
        ...(reason !== undefined && { reason }),
        spacing,
        where: { text: where, data: { takers: of_takers.map(it => ({ copy: it.copy, inserter_id: it.inserter_id, missed: it.items.reduce((s, x) => s + x.missed, 0),
            swings: it.items.reduce((s, x) => s + x.swings, 0), items: it.items.map(({ item, missed, swings }) => ({ item, missed, swings })) })) } },
        alone,
        changes: changes(null),
    };
}

/** Each clock's "what changes it" with another clock of the same result (other-clocks.ts) */
export { withOtherClocks } from "./other-clocks";
