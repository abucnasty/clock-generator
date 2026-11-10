import type { Config } from "../../config";
import { defaultLogger, Logger } from "../../common/logger";
import { OpenRange } from "../../data-types";
import { Entity } from "../../entities";
import { EntityRouteError, type AlwaysOnReason, type AlwaysOnReasons } from "../enable-control-router";
import type { SerializableClockWindows } from "../clock";
import { sharedItemDeadlockRisks } from "../deadlock-risk";
import { BlueprintGenerationResult, completedClockCheck, GenerateClockOptions, UnclockedRun, unclockedRun } from "../plan/unclocked-run";
import { type AsBuiltRun, disturbanceTrialVerdictOf } from "../trial";
import type { DisturbanceTrialVerdict } from "../disturbance-trial";
import { finishedClock, holdsWithMargin } from "./round-robin-polling";
import { partKey, type CoordinatedSourcesInput, type CoordinatedSourcesPart } from "./coordinated-sources-parts";
import type { EnableControl, SourceControl } from "../strategy-catalog";
import { costKey } from "../rank";

/**
 * The per-branch clock (DESIGN D7, PR 18): each part of the build gets the windows of the clock that fits it, all on one shared
 * window cycle, the window cycle of today's recommended clock.
 *
 * - **Parts:** every clock the other makers built for the build (`CoordinatedSourcesPart`): the stable alternatives, every way of the grouped
 *   hands construction (whether its clock holds as a whole or not), and the per-hand shape of every way that guards takers. A part
 *   gives windows where its window cycle divides the shared one (its windows repeated) and its own clock's long run was counted as built;
 *   a part with no count gives none.
 * - **Groups:** the inserters that take from one source entity. A group takes the windows of all its inserters from one part, and
 *   an inserter that part leaves always enabled stays so. No window is made that no part makes.
 * - **The local choice:** from today's recommended clock, the groups in turn from the output upstream, each with every choice it
 *   has and the other groups as they are, ranked by the wakeups of the whole clock as built from the cold start; passes until
 *   nothing changes. The clocks that hold are ranked by fewest wakeups (to a thousandth), the current choice first on a tie, and
 *   the backpressure losses are tried in that order: the first that gets back from every loss is taken (`bestHolding` of
 *   round-robin-polling.ts). No product over the groups is searched, and nothing is ranked by a prediction.
 * - **The starts:** the local choice also starts from each stable clock among the parts whose wakeups a minute tie the recommended
 *   clock's as the selection compares them (`costKey`), every group on that clock's windows (`localChoiceStarts`). The clock is the
 *   result with the fewest wakeups, of equals the recommended clock's start's (`localChoiceFromStarts`).
 * - **The clock** is then checked as a whole: the one-tick margin here (`holdsWithMargin`), and the checks of every alternative
 *   where it is listed (as built from every start, every loss).
 *
 * Throws CoordinatedSourcesNotApplicable where there is nothing to compose: no recommended clock among the parts, a window cycle that is not
 * whole, no group with a choice, or a local choice that keeps the recommended clock.
 */
export class CoordinatedSourcesNotApplicable extends Error { }

/** The most passes over the groups: a pass that changes nothing ends it sooner */
export const COORDINATED_SOURCES_MAX_PASSES = 8;

function refuse(reason: string): never {
    throw new CoordinatedSourcesNotApplicable(reason);
}

const quiet: Logger = { log: () => { }, info: () => { }, warn: () => { }, error: () => { }, debug: () => { } } as unknown as Logger;

/** The windows of a window cycle repeated over a window cycle that is a whole number of times as long */
export function tiledWindows(windows: SerializableClockWindows, window_cycle_ticks: number, shared_ticks: number): SerializableClockWindows {
    if (window_cycle_ticks === shared_ticks) return windows;
    const times = shared_ticks / window_cycle_ticks;
    return Object.fromEntries(Object.entries(windows).map(([id, ranges]) => [id,
        Array.from({ length: times }, (_, k) => ranges.map(range => ({ start: range.start + k * window_cycle_ticks, end: range.end + k * window_cycle_ticks }))).flat()]));
}

/** One choice of a group: the windows of each of its inserters (null: always enabled), and the parts that give them */
export interface GroupChoice {
    windows: Record<string, { start: number; end: number }[] | null>;
    parts: CoordinatedSourcesPart[];
}

/** The inserters that take from one source entity, and the choices the parts give them */
export interface PartGroup {
    source: string;
    inserters: string[];
    choices: GroupChoice[];
}

/** An inserter as the groups read it: its id and the entities it takes from and puts into */
export interface GroupedInserter {
    id: string;
    source: string;
    sink: string;
}

/**
 * The groups in the order the local choice takes them: from the output upstream, by the fewest hops from a group's source to an
 * entity nothing is taken from (the output), then by the source's id
 */
export function upstreamOrder(inserters: readonly GroupedInserter[]): string[] {
    const sinks = new Map<string, string[]>();
    for (const inserter of inserters) sinks.set(inserter.source, [...(sinks.get(inserter.source) ?? []), inserter.sink]);
    const hops = new Map<string, number>();
    const hopsOf = (entity: string, path: readonly string[]): number => {
        const known = hops.get(entity);
        if (known !== undefined) return known;
        const next = sinks.get(entity);
        if (next === undefined || path.includes(entity)) return 0;
        const value = 1 + Math.min(...next.map(sink => hopsOf(sink, [...path, entity])));
        hops.set(entity, value);
        return value;
    };
    return [...sinks.keys()].sort((a, b) => hopsOf(a, []) - hopsOf(b, []) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The groups of the inserters by source, each with the distinct windows the parts give it, in the order of the parts */
export function partGroups(inserters: readonly GroupedInserter[], parts: readonly CoordinatedSourcesPart[], shared_ticks: number): PartGroup[] {
    const groups = upstreamOrder(inserters).map(source => ({ source, inserters: inserters.filter(it => it.source === source).map(it => it.id),
        choices: [] as GroupChoice[], keys: new Map<string, GroupChoice>() }));
    for (const part of parts) {
        const windows = tiledWindows(part.windows, part.window_cycle_ticks, shared_ticks);
        for (const group of groups) {
            const own = Object.fromEntries(group.inserters.map(id => [id, windows[id]?.length ? windows[id] : null]));
            const key = JSON.stringify(own);
            const known = group.keys.get(key);
            if (known !== undefined) { known.parts.push(part); continue; }
            const choice = { windows: own, parts: [part] };
            group.keys.set(key, choice);
            group.choices.push(choice);
        }
    }
    return groups.map(({ source, inserters: ids, choices }) => ({ source, inserters: ids, choices }));
}

/**
 * What the router gave each entity of the groups, source by source in the order the groups were taken: the strategy of the part the
 * group took, or, for an inserter the part leaves without windows, the reason it stays always enabled (the part's own, else the clock's:
 * `always_on_reasons`). An inserter whose reason is not known (a fuel inserter on a clock of its own) is left out of its source's
 * entities and named in a debug line of the log. An inserter given windows by a part with no strategy is an internal error.
 */
export function sourceControlsOf(
    groups: readonly PartGroup[],
    chosen: ReadonlyMap<string, number>,
    always_on_reasons: AlwaysOnReasons,
    logger: Logger,
    build: string,
): SourceControl[] {
    return groups.map(group => {
        const choice = group.choices[chosen.get(group.source)!];
        const part = choice.parts[0];
        const entities: Record<string, EnableControl> = {};
        for (const id of group.inserters) {
            if (choice.windows[id] !== null && choice.windows[id] !== undefined) {
                if (part.strategy === undefined) throw new EntityRouteError(`Internal error: Coordinated Sources, ${build}: ${id} has enable windows from the clock ${partName(part)}, which has no strategy`);
                entities[id] = { kind: "strategy", id: part.strategy.id, tuning_method: part.strategy.tuning_method };
                continue;
            }
            const reason = choice.parts.map(it => it.always_on?.[id]).find(it => it !== undefined) ?? always_on_reasons[id];
            if (reason === undefined) { logger.debug(`Coordinated Sources, ${build}: ${id} left out of the sources, it is always enabled with no reason known`); continue; }
            entities[id] = { kind: "always_on", reason };
        }
        return { source: group.source, entities };
    });
}

/**
 * What a composed clock was found to do: its clock, whether it holds as built, its wakeups a minute. Its check is made up to the
 * long run, which counts the wakeups; the other taker orders and the start phases, which only find that it does not hold, are
 * made where the local choice reads whether it holds (`holdsOf`).
 */
interface Trial {
    /** The windows it was composed of */
    windows: SerializableClockWindows;
    /** The windows as the check ran on them */
    map: Map<string, OpenRange[]>;
    /** The clock, with its check up to the long run; with the whole check once `holdsOf` has made it */
    result: BlueprintGenerationResult;
    /** Whether it holds up to the long run */
    holds_to_long_run: boolean;
    /** The check up to the long run, which `holdsOf` finishes */
    check_to_long_run: AsBuiltRun | undefined;
    /** Whether it holds as built (its whole check); undefined until `holdsOf` asks */
    holds?: boolean;
    wake_ups: number | null;
    loss?: DisturbanceTrialVerdict | null;
    /** Why it does not hold a tick either way (`holdsWithMargin`), or null where it does */
    margin?: string | null;
}

/** How a part is shown in the log */
const partName = (part: CoordinatedSourcesPart): string => part.alternative_id ?? part.name;

/**
 * The plan the composed clocks run on: the config with the recommended clock's output swings, cycles and fractional swings; where its
 * window cycle is not the shared one, planned again with the cycles that make it so
 */
function sharedPlan(config: Config, recommended: CoordinatedSourcesPart): UnclockedRun {
    const plan = recommended.plan ?? {};
    const swings = plan.fractional_swings === true ? { fractional_swings: true as const } : {};
    const planned = (lcm?: number) => unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false,
        ...(plan.terminal_swing_count !== undefined && { terminal_swing_count: plan.terminal_swing_count }),
        ...(lcm !== undefined && { lcm }) } }, { logger: quiet, ...swings });
    let made = planned(plan.lcm);
    const window_cycle_ticks = recommended.window_cycle_ticks;
    if (made.run.duration.ticks !== window_cycle_ticks && config.overrides?.lcm === undefined) {
        const cycles = window_cycle_ticks / (made.run.duration.ticks / made.run.recipe_lcm);
        if (Number.isInteger(cycles) && cycles >= 1) made = planned(cycles);
    }
    if (made.run.duration.ticks !== window_cycle_ticks) refuse(`the build plans on ${made.run.duration.ticks} ticks, not the recommended clock's ${window_cycle_ticks}`);
    return made;
}

/** The per-branch clock of a build from its parts (see CoordinatedSourcesNotApplicable above) */
export function coordinatedSourcesClock(config: Config, input: CoordinatedSourcesInput, options: GenerateClockOptions = {}): BlueprintGenerationResult {
    const logger = options.logger ?? defaultLogger;
    const recommended = input.parts.find(part => part.alternative_id === input.recommended_id);
    if (recommended === undefined) refuse(`the recommended clock ${input.recommended_id} is not among the clocks made for the build`);
    const shared_ticks = recommended.window_cycle_ticks;
    if (!Number.isInteger(shared_ticks)) refuse(`the window cycle time of the recommended clock, ${shared_ticks} ticks, is not a whole number of ticks`);
    const made = sharedPlan(config, recommended);
    const registry = made.run.simulation_context.entity_registry;
    const inserters: GroupedInserter[] = registry.getAll().filter(Entity.isInserter)
        .map(it => ({ id: it.entity_id.id, source: it.source.entity_id.id, sink: it.sink.entity_id.id }));
    const lean: GenerateClockOptions = { logger: quiet, verify_as_built: true, loop_windows: false, modulo_blueprint: false, fuel_consumption_view: false };

    const trials = new Map<string, Trial>();
    const trialOf = (windows: SerializableClockWindows, left_open: ReadonlyMap<string, AlwaysOnReason>): Trial => {
        const key = partKey({ window_cycle_ticks: shared_ticks, windows });
        const known = trials.get(key);
        if (known !== undefined) return known;
        const map = new Map(Object.entries(windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
        let check_to_long_run: AsBuiltRun | undefined;
        const result = finishedClock(made, map, [], lean, left_open, undefined, { through: "long-run", on_as_built: run => { check_to_long_run = run; } });
        const as_built = result.stability_check.as_built;
        const trial: Trial = { windows, map, result, holds_to_long_run: as_built?.holds === true, check_to_long_run,
            wake_ups: as_built?.wake_ups?.wake_ups_per_minute ?? null };
        trials.set(key, trial);
        return trial;
    };
    // the whole check of a composed clock, made once: the check run through gives the same (completedClockCheck)
    const holdsOf = (trial: Trial): boolean => {
        if (trial.holds === undefined) {
            if (!trial.holds_to_long_run || trial.check_to_long_run === undefined) trial.holds = trial.holds_to_long_run;
            else {
                const check = completedClockCheck(made, trial.map, trial.check_to_long_run).check;
                trial.result = { ...trial.result, stability_check: { ...trial.result.stability_check, holds: check.holds, as_built: check } };
                trial.holds = check.holds;
            }
        }
        return trial.holds;
    };
    const fits = (part: CoordinatedSourcesPart) => Number.isInteger(part.window_cycle_ticks) && Number.isInteger(shared_ticks / part.window_cycle_ticks)
        && (part === recommended || part.alternative_id === undefined || part.verdict === "stable");
    const candidates = input.parts.filter(part => part !== recommended && fits(part) && part.counted !== false);
    // a part gives windows where its own clock on the shared window cycle was counted as built: one of that window cycle counted already (its own
    // check), any other counted here, once, where it gives a group a choice the parts before it do not
    const given = new Set(partGroups(inserters, [recommended], shared_ticks).map(group => `${group.source}|${JSON.stringify(group.choices[0].windows)}`));
    let counted_here = 0;
    const admitted = candidates.filter(part => {
        const own = partGroups(inserters, [part], shared_ticks).map(group => `${group.source}|${JSON.stringify(group.choices[0].windows)}`);
        if (own.every(key => given.has(key))) return false;
        let counted = part.counted === true && part.window_cycle_ticks === shared_ticks;
        if (!counted) {
            counted_here++;
            const windows = tiledWindows(part.windows, part.window_cycle_ticks, shared_ticks);
            counted = trialOf(windows, leftOpenOf(part, inserters, windows)).result.stability_check.as_built?.wake_ups !== undefined;
        }
        if (counted) own.forEach(key => given.add(key));
        return counted;
    });
    const groups = partGroups(inserters, [recommended, ...admitted], shared_ticks);
    const choosing = groups.filter(group => group.choices.length > 1);
    logger.log(`Coordinated Sources: the clocks ${[recommended, ...admitted].map(part => `${partName(part)} (${part.window_cycle_ticks} ticks)`).join(", ")}`);
    logger.log(`Coordinated Sources: ${admitted.length + 1} clocks on ${shared_ticks} ticks (${counted_here} counted here), ${groups.length} groups of inserters, `
        + `${choosing.length} with a choice: ${choosing.map(group => `${group.source} ${group.choices.length}`).join(", ") || "none"}`);
    if (choosing.length === 0) refuse("no source has another choice than the recommended clock's");

    // the windows the clock has beside its inserters' (drills), from the recommended clock
    const fixed = Object.fromEntries(Object.entries(tiledWindows(recommended.windows, recommended.window_cycle_ticks, shared_ticks))
        .filter(([id]) => !inserters.some(it => it.id === id)));
    const compose = (choice: ReadonlyMap<string, number>): { windows: SerializableClockWindows; left_open: Map<string, AlwaysOnReason> } => {
        const windows: SerializableClockWindows = { ...fixed };
        const left_open = new Map<string, AlwaysOnReason>();
        for (const group of groups) {
            const chosen = group.choices[choice.get(group.source)!];
            for (const [id, ranges] of Object.entries(chosen.windows)) {
                if (ranges !== null) { windows[id] = ranges; continue; }
                const reason = chosen.parts.map(part => part.always_on?.[id]).find(it => it !== undefined);
                if (reason !== undefined) left_open.set(id, reason);
            }
        }
        return { windows, left_open };
    };
    const trialOfChoice = (choice: ReadonlyMap<string, number>): Trial => {
        const { windows, left_open } = compose(choice);
        return trialOf(windows, left_open);
    };
    const deadlock_risk = sharedItemDeadlockRisks(registry).length > 0;
    const lossOf = (trial: Trial): DisturbanceTrialVerdict | null => {
        if (trial.loss === undefined) trial.loss = disturbanceTrialVerdictOf(made.config, trial.result, quiet).disturbance_trial;
        return trial.loss;
    };
    const marginOf = (trial: Trial): string | null => {
        if (trial.margin === undefined) {
            trial.margin = holdsWithMargin(made, new Map(Object.entries(trial.windows).map(([id, ranges]) =>
                [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const)), shared_ticks);
        }
        return trial.margin;
    };

    const recommended_key = partKey({ window_cycle_ticks: shared_ticks, windows: tiledWindows(recommended.windows, recommended.window_cycle_ticks, shared_ticks) });
    const judge: LocalChoiceJudge = {
        wakeUpsOf: choice => {
            const trial = trialOfChoice(choice);
            return trial.holds_to_long_run ? trial.wake_ups : null;
        },
        // the current choice where it holds as a whole; another where it also holds a tick either way and gets back from every loss (on a
        // build with a deadlock risk the losses do not decide), else where its losses could not be tried
        takes: (choice, current) => {
            const trial = trialOfChoice(choice);
            if (!holdsOf(trial)) return "passed";
            if (current) return "taken";
            if (marginOf(trial) !== null) return "passed";
            const loss = deadlock_risk ? undefined : lossOf(trial);
            if (deadlock_risk || loss?.survives === true) return "taken";
            return loss === null ? "untried" : "passed";
        },
        refusal: choice => {
            const { windows, left_open } = compose(choice);
            if (partKey({ window_cycle_ticks: shared_ticks, windows }) === recommended_key) return "the local choice keeps the recommended clock";
            const margin = marginOf(trialOf(windows, left_open));
            return margin === null ? null : `the composed clock: ${margin}`;
        },
    };
    const starts = localChoiceStarts(inserters, groups, recommended, candidates, shared_ticks);
    const { start, choice: current } = localChoiceFromStarts(groups, starts, judge, logger);
    const { windows, left_open } = compose(current);
    const map = new Map(Object.entries(windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    logger.log(`Coordinated Sources: ${starts.length > 1 ? `from ${partName(start.part)}, ` : ""}`
        + `${groups.map(group => `${group.source} from ${partName(group.choices[current.get(group.source)!].parts[0])}`).join(", ")}; `
        + `${trials.size} clocks simulated`);
    const result = finishedClock(made, map, [], { ...options, loop_windows: false }, left_open);
    return { ...result, coordinated_sources: { parts: Object.fromEntries(groups.map(group => [group.source, partName(group.choices[current.get(group.source)!].parts[0])])),
        sources: sourceControlsOf(groups, current, result.always_on_reasons ?? {}, logger, config.setpoint.recipe) } };
}

/** A start of the local choice: the clock it starts from, and the choice of each group that has that clock's windows */
export interface LocalChoiceStart {
    part: CoordinatedSourcesPart;
    choice: ReadonlyMap<string, number>;
}

/** What the local choice reads of a composed clock, by the choice of each group */
export interface LocalChoiceJudge {
    /** Its wakeups a minute where it holds up to the long run (the check that counts them), else null */
    wakeUpsOf(choice: ReadonlyMap<string, number>): number | null;
    /**
     * Where its turn comes in the ranking, whether a group's choice is taken: "untried" where it would be taken but its losses could
     * not be tried (taken where no other is), "passed" where it is not taken
     */
    takes(choice: ReadonlyMap<string, number>, current: boolean): "taken" | "untried" | "passed";
    /** Why the clock a start ends on is not the per-branch clock (it is the recommended clock, or fails the margin), else null */
    refusal(choice: ReadonlyMap<string, number>): string | null;
}

/**
 * The starts of the local choice: the recommended clock (every group at its first choice), then each stable part whose wakeups a
 * minute tie the recommended clock's as the selection compares them (`costKey`), in the order of the parts, where every group has
 * its windows and it is another start than those before it
 */
export function localChoiceStarts(
    inserters: readonly GroupedInserter[],
    groups: readonly PartGroup[],
    recommended: CoordinatedSourcesPart,
    parts: readonly CoordinatedSourcesPart[],
    shared_ticks: number,
): LocalChoiceStart[] {
    const starts: LocalChoiceStart[] = [{ part: recommended, choice: new Map(groups.map(group => [group.source, 0])) }];
    const wake_ups = recommended.wake_ups_per_minute;
    if (wake_ups === undefined || wake_ups === null) return starts;
    const keys = new Set([JSON.stringify([...starts[0].choice])]);
    for (const part of parts) {
        const own_wake_ups = part.wake_ups_per_minute;
        if (part === recommended || part.alternative_id === undefined || part.verdict !== "stable" || own_wake_ups === undefined
            || own_wake_ups === null || costKey({ wake_ups_per_minute: own_wake_ups }) !== costKey({ wake_ups_per_minute: wake_ups })) continue;
        const own = partGroups(inserters, [part], shared_ticks);
        const choice = new Map(groups.map((group, index) => [group.source,
            group.choices.findIndex(it => JSON.stringify(it.windows) === JSON.stringify(own[index].choices[0].windows))]));
        const key = JSON.stringify([...choice]);
        if ([...choice.values()].includes(-1) || keys.has(key)) continue;
        keys.add(key);
        starts.push({ part, choice });
    }
    return starts;
}

/**
 * The local choice from one start: the groups in turn, each with every choice it has and the other groups as they are, ranked by
 * the wakeups of the whole clock (to a thousandth), the current choice first on a tie; passes until nothing changes
 */
function localChoice(choosing: readonly PartGroup[], start: LocalChoiceStart, judge: LocalChoiceJudge, logger: Logger, from: string): Map<string, number> {
    const current = new Map(start.choice);
    for (let pass = 0; pass < COORDINATED_SOURCES_MAX_PASSES; pass++) {
        let changed = false;
        for (const group of choosing) {
            const at = current.get(group.source)!;
            const choiceOf = (index: number) => new Map(current).set(group.source, index);
            const tried = group.choices.map((_, index) => ({ index, wake_ups: judge.wakeUpsOf(choiceOf(index)) }));
            // ranked by the check up to the long run; one that does not hold its whole check is passed over where its turn comes,
            // so the clocks read are those that hold, in the same order, and no clock ranked after the one taken is checked further
            const ranked = tried.filter(it => it.wake_ups !== null)
                .sort((a, b) => Math.round(a.wake_ups! * 1000) - Math.round(b.wake_ups! * 1000)
                    || (a.index === at ? -1 : b.index === at ? 1 : 0) || a.index - b.index);
            // the current choice stays where it ranks first
            let taken: number | undefined;
            let untried: number | undefined;
            for (const it of ranked) {
                const verdict = judge.takes(choiceOf(it.index), it.index === at);
                if (verdict === "taken") { taken = it.index; break; }
                if (verdict === "untried") untried ??= it.index;
            }
            taken ??= untried;
            if (taken !== undefined && taken !== at) {
                current.set(group.source, taken);
                changed = true;
                logger.log(`Coordinated Sources${from}, pass ${pass + 1}: ${group.source} takes ${partName(group.choices[taken].parts[0])} `
                    + `(${tried[taken].wake_ups} wakeups a minute)`);
            }
        }
        if (!changed) break;
    }
    return current;
}

/**
 * The local choice from every start (`localChoiceStarts`): the clock is the result with the fewest wakeups a minute (`costKey`),
 * of equals the one of the start listed first (the recommended clock's). A start other than the recommended clock's gives no result
 * where it takes no move; a result the judge refuses gives none. Throws CoordinatedSourcesNotApplicable where no start gives one,
 * with the recommended clock's start's reason.
 */
export function localChoiceFromStarts(
    groups: readonly PartGroup[],
    starts: readonly LocalChoiceStart[],
    judge: LocalChoiceJudge,
    logger: Logger,
): { start: LocalChoiceStart; choice: Map<string, number> } {
    const choosing = groups.filter(group => group.choices.length > 1);
    let best: { start: LocalChoiceStart; choice: Map<string, number>; cost: number } | undefined;
    let reason: string | undefined;
    for (const start of starts) {
        if (start !== starts[0]) {
            logger.log(`Coordinated Sources: also from ${partName(start.part)}, whose wakeups a minute tie the recommended clock's (${start.part.wake_ups_per_minute})`);
        }
        const choice = localChoice(choosing, start, judge, logger, starts.length > 1 ? `, from ${partName(start.part)}` : "");
        if (start !== starts[0] && [...choice].every(([source, index]) => start.choice.get(source) === index)) continue;
        const refusal = judge.refusal(choice);
        if (refusal !== null) { reason ??= refusal; continue; }
        const cost = costKey({ wake_ups_per_minute: judge.wakeUpsOf(choice) });
        if (best === undefined || cost < best.cost) best = { start, choice, cost };
    }
    if (best === undefined) refuse(reason ?? "the local choice keeps the recommended clock");
    return { start: best.start, choice: best.choice };
}

/** The inserters a part leaves always enabled, with its reasons */
function leftOpenOf(part: CoordinatedSourcesPart, inserters: readonly GroupedInserter[], windows: SerializableClockWindows): Map<string, AlwaysOnReason> {
    return new Map(inserters.flatMap(it => {
        const reason = windows[it.id]?.length ? undefined : part.always_on?.[it.id];
        return reason === undefined ? [] : [[it.id, reason] as const];
    }));
}
