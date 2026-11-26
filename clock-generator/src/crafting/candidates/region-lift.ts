/**
 * A clock of one repeated group of machines, planned alone on its cut config (graph/region-config.ts), lifted onto the whole build:
 *
 * - **The map:** each arm and drill of the solved group gives its windows to its partner in every group through the finder's maps
 *   (`RegionOrbit.maps`), with no shift between the groups.
 * - **The anchor's arms:** an anchor arm that touches the solved group gives its windows to the anchor arm that touches each other
 *   group with the same anchor end and the map's image as its other end; one that touches no group keeps its own windows.
 * - **Open arms:** an arm or drill with no windows in the group's clock stays open in every group, with its reason.
 * - **The shift where a shared machine forces it:** where a lifted clock does not hold as built and the groups take from one anchor
 *   machine, each other group takes the offset the whole build's own recommended clock has between it and the solved group: the
 *   smallest that sends every arm and drill of the solved group onto its image there (`offsetsOf`).
 *
 * Inside the generation of a cut group (`withRegionScope`), the stagger step judges each proposal on the clock lifted onto the whole
 * build (`regionJudgeOf`), with every check the step asks of a clock, and recovery read as the worse of the two readings.
 */
import type { Config } from "../../config";
import { OpenRange } from "../../data-types";
import type { SerializableClockWindows } from "../clock";
import type { Logger } from "../../common/logger";
import type { AlwaysOnReason } from "../enable-control-router";
import type { RegionOrbit } from "../graph/regions";
import { inserterKeysOf } from "../graph/region-config";
import { completedClockCheck, fractionalSwingsOf, unclockedRun, type BlueprintGenerationResult, type UnclockedRun } from "../plan/unclocked-run";
import { disturbanceTrialVerdictOf, type AsBuiltRun } from "../trial";
import type { DisturbanceTrialVerdict } from "../disturbance-trial";
import { finishedClock, marginFailureOf } from "./round-robin-polling";
import { verdictWithCopies, withLaneFeeders, type LaneFeedersScope, type VerdictWithCopies } from "../copies-verdict";
import type { InputJointStage, InputWindowJudge } from "./metered-input-windows";
import { enabledTicks, shiftedWindows } from "./staggered-input-windows";
import type { SourceControl } from "../strategy-catalog";

type Ranges = { start: number; end: number }[];
const entityOf = (node: string): string => node.split("/")[0];
const endKey = (end: { type: string; id: number }): string => `${end.type}:${end.id}`;
const mod = (value: number, by: number) => ((value % by) + by) % by;
const quiet: Logger = { log: () => { }, info: () => { }, warn: () => { }, error: () => { }, debug: () => { } } as unknown as Logger;

/** What a lift did: `lifted`; `no_drill_map` where a drill with windows has no partner; `anchor_unmapped` where an anchor arm has none */
export type LiftCode = "lifted" | "no_drill_map" | "anchor_unmapped";

export interface LiftedWindows {
    windows: SerializableClockWindows;
    left_open: Map<string, AlwaysOnReason>;
    code: LiftCode;
}

/** The lift of one solved group of an orbit onto the whole build */
export interface RegionLift {
    orbit: RegionOrbit;
    /** The group solved, from 0 */
    solved: number;
    /** The image in group k of an arm, drill or source entity of the solved group's cut config; null where it has none */
    imageIn(key: string, k: number): string | null;
    /** The windows and open arms of a clock of the cut, on the whole build, with no shift */
    lift(windows: SerializableClockWindows, left_open?: ReadonlyMap<string, AlwaysOnReason>): LiftedWindows;
    /** The arms and drills of group k that take the solved group's windows (its own and the anchor arms that touch it) */
    takersIn(k: number): string[];
    /** Whether two or more groups take from one anchor machine (an anchor arm from it into each) */
    shared_anchor_machine: boolean;
}

/** The lift of group `solved` of an orbit of `config` (see the module) */
export function regionLiftOf(config: Config, orbit: RegionOrbit, solved: number): RegionLift {
    const keys = inserterKeysOf(config);
    const ends = new Map(config.inserters.map((inserter, index) => [keys[index], [endKey(inserter.source), endKey(inserter.sink)] as const]));
    const { regions, maps } = orbit;
    const inverse = new Map(Object.entries(maps[solved]).map(([zero, it]) => [it, zero]));
    const image = (node: string, k: number): string | null => maps[k][inverse.get(node) ?? node] ?? null;
    const region_entities = regions.map(region => new Set(region.nodes.map(entityOf)));
    const anchor_arms = orbit.anchor.filter(node => node.startsWith("inserter:"));
    const members = new Set([...regions[solved].arms.filter(arm => arm.startsWith("inserter:")), ...regions[solved].nodes.filter(node => node.startsWith("drill:"))]);
    const touched = (arm: string) => regions.map((_, k) => k).filter(k => ends.get(arm)!.some(end => region_entities[k].has(end)));
    // an entity of the solved group (a belt by any of its lanes) sent to group k
    const entityImage = (entity: string, k: number): string | null => {
        for (const node of regions[solved].nodes) {
            if (entityOf(node) !== entity) continue;
            const it = image(node, k);
            if (it !== null) return entityOf(it);
        }
        return null;
    };
    const partnerIn = (arm: string, k: number): string | null => {
        const [source, sink] = ends.get(arm)!;
        const s = region_entities[solved].has(source) ? entityImage(source, k) : source;
        const t = region_entities[solved].has(sink) ? entityImage(sink, k) : sink;
        const partners = anchor_arms.filter(other => ends.get(other)![0] === s && ends.get(other)![1] === t);
        return partners.length === 1 ? partners[0] : null;
    };
    const imageIn = (key: string, k: number): string | null => {
        if (members.has(key)) return image(key, k);
        if (anchor_arms.includes(key)) {
            const on = touched(key);
            if (on.length === 0) return key;
            return on.length === 1 && on[0] === solved ? partnerIn(key, k) : null;
        }
        if (region_entities[solved].has(key)) return entityImage(key, k);
        // the anchor machine, an unmatched part, a belt no group holds: the same entity in every group
        return regions.some((_, r) => r !== solved && region_entities[r].has(key)) ? null : key;
    };
    const lift = (windows: SerializableClockWindows, left_open: ReadonlyMap<string, AlwaysOnReason> = new Map()): LiftedWindows => {
        const out: SerializableClockWindows = {};
        const open = new Map<string, AlwaysOnReason>();
        let code: LiftCode = "lifted";
        const send = (key: string) => {
            const own = windows[key];
            const reason = left_open.get(key);
            if (own === undefined && reason === undefined) return;
            regions.forEach((_, k) => {
                const to = imageIn(key, k);
                if (to === null) {
                    if (key.startsWith("drill:") && own !== undefined) code = "no_drill_map";
                    else if (anchor_arms.includes(key) && code === "lifted") code = "anchor_unmapped";
                    return;
                }
                if (own !== undefined) out[to] = own.map(range => ({ ...range }));
                if (reason !== undefined) open.set(to, reason);
            });
        };
        const seen = new Set<string>();
        for (const key of [...Object.keys(windows), ...left_open.keys()]) {
            if (seen.has(key)) continue;
            seen.add(key);
            if (members.has(key) || anchor_arms.includes(key)) { send(key); continue; }
            // what no group holds keeps its windows
            if (windows[key] !== undefined) out[key] = windows[key].map(range => ({ ...range }));
            if (left_open.has(key)) open.set(key, left_open.get(key)!);
        }
        return { windows: out, left_open: open, code };
    };
    const takersIn = (k: number): string[] => [...members, ...anchor_arms.filter(arm => {
        const on = touched(arm);
        return on.length === 1 && on[0] === solved;
    })].map(key => imageIn(key, k)).filter((it): it is string => it !== null);
    const anchor_machine = orbit.anchor[0];
    const fed = new Set(anchor_arms.filter(arm => ends.get(arm)![0] === anchor_machine).flatMap(touched));
    return { orbit, solved, imageIn, lift, takersIn, shared_anchor_machine: fed.size >= 2 };
}

/**
 * The offset of each other group against the solved one on the whole build's own clock (`windows`, of `period` ticks): the
 * smallest shift (the negative one on a tie) that sends the windows of every arm and drill of the solved group that takes its
 * windows onto those of its image in that group. Null for a group where no shift does, or where only one of a pair has windows.
 */
export function offsetsOf(lift: RegionLift, windows: SerializableClockWindows, period: number): Map<number, number | null> {
    const out = new Map<number, number | null>();
    const mine = lift.takersIn(lift.solved);
    lift.orbit.regions.forEach((_, k) => {
        if (k === lift.solved) return;
        const theirs = lift.takersIn(k);
        const pairs = mine.map((key, at) => [key, theirs[at]] as const).filter(([a, b]) => b !== undefined && (windows[a] !== undefined || windows[b] !== undefined));
        if (pairs.some(([a, b]) => windows[a] === undefined || windows[b] === undefined || enabledTicks(windows[a], period) === null || enabledTicks(windows[b], period) === null)) {
            out.set(k, null);
            return;
        }
        const same = (a: Ranges, b: Ranges) => JSON.stringify(enabledTicks(a, period)) === JSON.stringify(enabledTicks(b, period));
        let best: number | null = null;
        for (let shift = 0; shift < period; shift++) {
            if (!pairs.every(([a, b]) => same(shiftedWindows(windows[a], shift, period), windows[b]))) continue;
            for (const value of [shift, shift - period]) {
                if (best === null || Math.abs(value) < Math.abs(best) || (Math.abs(value) === Math.abs(best) && value < best)) best = value;
            }
        }
        out.set(k, best);
    });
    return out;
}

/** A lifted clock with each other group's windows moved by its offset (`offsetsOf`); null where a group has none */
export function shiftedLift(lift: RegionLift, lifted: SerializableClockWindows, offsets: ReadonlyMap<number, number | null>, period: number): SerializableClockWindows | null {
    if ([...offsets.values()].some(it => it === null)) return null;
    const out = { ...lifted };
    for (const [k, shift] of offsets) {
        if (shift === null || shift === 0) continue;
        for (const key of lift.takersIn(k)) {
            if (out[key] !== undefined && enabledTicks(out[key], period) !== null) out[key] = shiftedWindows(out[key], mod(shift, period), period);
        }
    }
    return out;
}

/** The sources of a Coordinated Sources clock of the cut, on the whole build: each source in every group, its entities by their images */
export function liftedSources(lift: RegionLift, sources: readonly SourceControl[]): SourceControl[] {
    const out = new Map<string, SourceControl>();
    for (const source of sources) {
        lift.orbit.regions.forEach((_, k) => {
            const to = lift.imageIn(source.source, k);
            if (to === null) return;
            const entry = out.get(to) ?? { source: to, entities: {} };
            for (const [entity, control] of Object.entries(source.entities)) {
                const it = lift.imageIn(entity, k);
                if (it !== null) entry.entities[it] = control;
            }
            out.set(to, entry);
        });
    }
    return [...out.values()];
}

/**
 * The whole build planned on a clock's window cycle, with the output swings and cycles the cut's plan has (as the shared plan of
 * Coordinated Sources: planned again with the cycles that make the window cycle where the first plan's is another); null where
 * the build plans on another window cycle
 */
export function wholePlanOn(whole: Config, cut_plan_overrides: { terminal_swing_count?: number; lcm?: number }, window_cycle_ticks: number,
    swings: { fractional_swings?: true } = {}): UnclockedRun | null {
    const planned = (lcm?: number) => unclockedRun({ ...whole, overrides: { ...whole.overrides, derive_clock_windows: false,
        ...(cut_plan_overrides.terminal_swing_count !== undefined && { terminal_swing_count: cut_plan_overrides.terminal_swing_count }),
        ...(lcm !== undefined && { lcm }) } }, { logger: quiet, ...swings });
    try {
        let plan = planned(cut_plan_overrides.lcm);
        if (plan.run.duration.ticks !== window_cycle_ticks && whole.overrides?.lcm === undefined) {
            const cycles = window_cycle_ticks / (plan.run.duration.ticks / plan.run.recipe_lcm);
            if (Number.isInteger(cycles) && cycles >= 1) plan = planned(cycles);
        }
        return plan.run.duration.ticks === window_cycle_ticks ? plan : null;
    } catch {
        return null;
    }
}

/** What the stagger step of a cut group's generation reads of the whole build (`withRegionScope`) */
export interface RegionScope {
    /** The whole build, without its outside supply */
    whole: Config;
    /** The feeders of the whole build's lanes, which its checks with the copies read */
    feeders: LaneFeedersScope;
    lift: RegionLift;
    /** Every proposal of the group's stagger step with its outcome, for the maker log */
    stagger_log: RegionStaggerEntry[];
}

/** One proposal of a cut group's stagger step, judged on the whole build */
export interface RegionStaggerEntry {
    window_cycle_ticks: number;
    belt: string;
    reference: string;
    /** On the lifted whole build: its wakeups a minute where it holds to the long run, else null */
    wake_ups: number | null;
    outcome: "taken" | "retained" | "not_reached";
    reason: string | null;
    stage?: InputJointStage;
    /** The worse of the two recovery readings, of the proposal and of the clock it would change, where the gate read them */
    recovery?: { proposal: number | null; clock: number | null };
}

let scope: RegionScope | undefined;

/** Runs a cut group's generation with what its stagger step reads of the whole build */
export function withRegionScope<T>(region: RegionScope, generate: () => T): T {
    const outer = scope;
    scope = region;
    try {
        return generate();
    } finally {
        scope = outer;
    }
}

/** The region the generation running is of, where it is a cut group's; undefined for a whole build */
export function currentRegionScope(): RegionScope | undefined {
    return scope;
}

/**
 * The judge of a clock of the cut group lifted onto the whole build, for the stagger step: the clock `base` of the cut with a
 * proposal's windows, lifted (no shift), checked on the whole build planned on the same window cycle, as `judgeOn` checks a clock
 * of the cut (to the long run; the whole check, the margin, the losses on one copy, the copies; recovery on one copy and on the
 * copies), inside the whole build's lane feeders. Null where the whole build plans on another window cycle.
 */
export function regionJudgeOf(region: RegionScope, cut_plan: UnclockedRun, left_open: ReadonlyMap<string, AlwaysOnReason>):
    ((base: SerializableClockWindows) => InputWindowJudge) | null {
    const period = cut_plan.run.duration.ticks;
    const overrides = cut_plan.config.overrides ?? {};
    const swings = fractionalSwingsOf(cut_plan.run.output_cycle_plan).fractional_swings === true ? { fractional_swings: true as const } : {};
    const made = withLaneFeeders(region.feeders, () => wholePlanOn(region.whole, { terminal_swing_count: overrides.terminal_swing_count, lcm: overrides.lcm }, period, swings));
    if (made === null) return null;
    const lean = { logger: quiet, verify_as_built: true, loop_windows: false as const, modulo_blueprint: false, fuel_consumption_view: false };
    type Trial = { map: Map<string, OpenRange[]>; result: BlueprintGenerationResult; long_run: boolean; wake_ups: number | null;
        check?: Pick<AsBuiltRun, "result" | "check">; holds?: boolean; loss?: DisturbanceTrialVerdict | null; margin?: boolean; copies?: VerdictWithCopies | null };
    const trials = new Map<string, Trial>();
    const trialOf = (cut_windows: SerializableClockWindows): Trial => {
        const lifted = region.lift.lift(cut_windows, left_open);
        const key = JSON.stringify(Object.entries(lifted.windows).sort(([a], [b]) => (a < b ? -1 : 1)));
        const known = trials.get(key);
        if (known !== undefined) return known;
        const map = new Map(Object.entries(lifted.windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
        let check: Trial["check"];
        const result = withLaneFeeders(region.feeders, () => finishedClock(made, map, [], lean, lifted.left_open, undefined,
            { through: "long-run", on_as_built: run => { check = { result: run.result, check: run.check }; } }));
        const as_built = result.stability_check.as_built;
        const trial: Trial = { map, result, long_run: as_built?.holds === true, wake_ups: as_built?.wake_ups?.wake_ups_per_minute ?? null, check };
        trials.set(key, trial);
        return trial;
    };
    const holdsOf = (trial: Trial): boolean => {
        if (trial.holds === undefined) {
            if (!trial.long_run || trial.check === undefined) trial.holds = trial.long_run;
            else {
                const done = withLaneFeeders(region.feeders, () => completedClockCheck(made, trial.map, trial.check! as AsBuiltRun).check);
                trial.result = { ...trial.result, stability_check: { ...trial.result.stability_check, holds: done.holds, as_built: done } };
                trial.holds = done.holds;
            }
        }
        return trial.holds;
    };
    const lossOf = (trial: Trial) => {
        if (trial.loss === undefined) trial.loss = withLaneFeeders(region.feeders, () => disturbanceTrialVerdictOf(region.whole, trial.result, quiet).disturbance_trial);
        return trial.loss;
    };
    const marginHolds = (trial: Trial) => {
        if (trial.margin === undefined) trial.margin = withLaneFeeders(region.feeders, () => marginFailureOf(made, trial.map, period)) === null;
        return trial.margin;
    };
    const copiesOf = (trial: Trial) => {
        if (trial.copies === undefined) {
            trial.copies = !holdsOf(trial) ? null : withLaneFeeders(region.feeders, () => verdictWithCopies({
                config: { ...region.whole, overrides: { ...region.whole.overrides, terminal_swing_count: trial.result.used_terminal_swing_count } },
                windows: trial.result.clock_windows, window_cycle_ticks: period, expected_output_items: trial.result.stability_check.expected_output_items,
            }, () => lossOf(trial)?.survives === true, region.whole.overrides?.disturbance_trials_on_copies !== false, "Repeated groups", quiet));
        }
        return trial.copies;
    };
    return base => {
        const trialWith = (changes: SerializableClockWindows) => trialOf({ ...base, ...changes });
        return {
            longRun: changes => {
                const trial = trialWith(changes);
                return { holds: trial.long_run, wake_ups: trial.wake_ups, stage: trial.long_run ? null : "long_run" };
            },
            wholeCheck: changes => {
                const trial = trialWith(changes);
                if (!holdsOf(trial)) return "whole_check";
                if (!marginHolds(trial)) return "margin";
                if (lossOf(trial)?.survives !== true) return "loss";
                return copiesOf(trial)?.holds === true ? null : "copies";
            },
            recovery: changes => {
                const trial = trialWith(changes);
                return { one_copy: lossOf(trial)?.recovered_after_window_cycles ?? null,
                    copies: copiesOf(trial)?.copies_trial?.recovered_after_window_cycles ?? null };
            },
        };
    };
}
