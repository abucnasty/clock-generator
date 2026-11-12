import type { Config } from "../config/schema";
import { laneLoads } from "../config/lane-capacity-validator";
import { laneFactsOfConfig } from "../entities/traits/build-traits";
import { beltLaneFactsOf, LaneEnd, LaneSharing } from "../entities/traits/lane-facts";
import type { LaneRole } from "../entities/traits/lane-role";
import { fractionOf, Ratio } from "../entities/traits/ratio";
import { buildToNameOf } from "./build-names";
import { capitalized, chestNameInText, listedInText, theName, type BuildToName } from "./entity-name";
import type { CopiesTrialVerdict } from "./shared-lane-trial";
import { droppedOntoSharedLanes, isNotChecked, type ClockSharedLaneLoss, type SharedLaneJudgement, type SharedLaneLoss,
    type SharedLaneLossFacts } from "./shared-lane-verdict";

/**
 * What a result says was checked on each lane the copies of a build share: the lanes of the build (`buildLanesOf`), and for
 * each clock its rows and its line (`checkedLanesOf`). Every figure comes from the runs a generation makes: the check of the
 * shared lanes (shared-lane-verdict.ts). A loss is said in swings missed.
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

/** What a result says was checked of one clock on the lanes its copies share */
export interface CheckedLanes {
    line: CheckedLine;
    rows: CheckedLaneRow[];
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
}

/** A rate as data: a decimal to the ninth place, so that a sum of float rates reads as the rate it is */
const rounded = (value: number) => Math.round(value * 1e9) / 1e9;
const ratio = (value: Ratio) => rounded(fractionOf(value).toDecimal());

/** A number as the texts write it: "120", "26.67", "1,234" */
function figure(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    return rounded.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

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
const OUTPUT_BELT_NOT_RUN = "The output belt is run with the copies only together with a lane they take from, and no such lane is run.";

/**
 * The rows and the line of one clock, from its check of the lanes its copies share (see the module's description); null
 * for a build of one copy
 */
export function checkedLanesOf(input: CheckedLanesInput): CheckedLanes | null {
    const { config, holds, judged, copies_trial } = input;
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
    return { line, rows };
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
