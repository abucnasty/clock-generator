import type { Config } from "../../config";
import { defaultLogger, Logger } from "../../common/logger";
import { OpenRange } from "../../data-types";
import { Entity } from "../../entities";
import type { AlwaysOnReason, AlwaysOnReasons } from "../always-on-reasons";
import type { SerializableClockWindows } from "../clock";
import { sharedItemDeadlockRisks } from "../deadlock-risk";
import { BlueprintGenerationResult, GenerateClockOptions, PlanRun, planRun } from "../plan/plan-run";
import { backpressureLossVerdictOf } from "../trial";
import type { BackpressureLossVerdict } from "../backpressure-loss";
import { finishedClock, holdsWithMargin } from "./grouped-hands";
import { partKey, type PerBranchInput, type PerBranchPart } from "./per-branch-parts";
import type { EnableControl, SourceControl } from "../strategy-catalog";

/**
 * The per-branch clock (DESIGN D7, PR 18): each part of the build gets the windows of the clock that fits it, all on one shared
 * period, the period of today's recommended clock.
 *
 * - **Parts:** every clock the other makers built for the build (`PerBranchPart`): the stable alternatives, every way of the grouped
 *   hands construction (whether its clock holds as a whole or not), and the per-hand shape of every way that guards takers. A part
 *   gives windows where its period divides the shared one (its windows repeated) and its own clock's long run was counted as built;
 *   a part with no count gives none.
 * - **Groups:** the inserters that take from one source entity. A group takes the windows of all its inserters from one part, and
 *   an inserter that part leaves always enabled stays so. No window is made that no part makes.
 * - **The local choice:** from today's recommended clock, the groups in turn from the output upstream, each with every choice it
 *   has and the other groups as they are, ranked by the wakeups of the whole clock as built from the cold start; passes until
 *   nothing changes. The clocks that hold are ranked by fewest wakeups (to a thousandth), the current choice first on a tie, and
 *   the backpressure losses are tried in that order: the first that gets back from every loss is taken (`bestHolding` of
 *   grouped-hands.ts). No product over the groups is searched, and nothing is ranked by a prediction.
 * - **The clock** is then checked as a whole: the one-tick margin here (`holdsWithMargin`), and the checks of every alternative
 *   where it is listed (as built from every start, every loss).
 *
 * Throws PerBranchNotApplicable where there is nothing to compose: no recommended clock among the parts, a period that is not
 * whole, no group with a choice, or a local choice that keeps the recommended clock.
 */
export class PerBranchNotApplicable extends Error { }

/** The most passes over the groups: a pass that changes nothing ends it sooner */
export const PER_BRANCH_MAX_PASSES = 8;

function refuse(reason: string): never {
    throw new PerBranchNotApplicable(reason);
}

const quiet: Logger = { log: () => { }, info: () => { }, warn: () => { }, error: () => { }, debug: () => { } } as unknown as Logger;

/** The windows of a period repeated over a period that is a whole number of times as long */
export function tiledWindows(windows: SerializableClockWindows, period_ticks: number, shared_ticks: number): SerializableClockWindows {
    if (period_ticks === shared_ticks) return windows;
    const times = shared_ticks / period_ticks;
    return Object.fromEntries(Object.entries(windows).map(([id, ranges]) => [id,
        Array.from({ length: times }, (_, k) => ranges.map(range => ({ start: range.start + k * period_ticks, end: range.end + k * period_ticks }))).flat()]));
}

/** One choice of a group: the windows of each of its inserters (null: always enabled), and the parts that give them */
export interface GroupChoice {
    windows: Record<string, { start: number; end: number }[] | null>;
    parts: PerBranchPart[];
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
export function partGroups(inserters: readonly GroupedInserter[], parts: readonly PerBranchPart[], shared_ticks: number): PartGroup[] {
    const groups = upstreamOrder(inserters).map(source => ({ source, inserters: inserters.filter(it => it.source === source).map(it => it.id),
        choices: [] as GroupChoice[], keys: new Map<string, GroupChoice>() }));
    for (const part of parts) {
        const windows = tiledWindows(part.windows, part.period_ticks, shared_ticks);
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
 * `always_on_reasons`). It never refuses: an inserter whose reason is not known, or whose part has no strategy, is left out of its
 * source's entities and named in a debug line of the log.
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
                if (part.strategy === undefined) { logger.debug(`Per-branch clock, ${build}: ${id} left out of the sources, the part ${partName(part)} has no strategy`); continue; }
                const { family, construction } = part.strategy;
                entities[id] = { kind: "strategy", family, ...(construction !== undefined && { construction }) };
                continue;
            }
            const reason = choice.parts.map(it => it.always_on?.[id]).find(it => it !== undefined) ?? always_on_reasons[id];
            if (reason === undefined) { logger.debug(`Per-branch clock, ${build}: ${id} left out of the sources, it is always enabled with no reason known`); continue; }
            entities[id] = { kind: "always_on", reason };
        }
        return { source: group.source, entities };
    });
}

/** What a composed clock was found to do: its clock, whether it holds as built, its wakeups a minute */
interface Trial {
    /** The windows it was composed of */
    windows: SerializableClockWindows;
    result: BlueprintGenerationResult;
    holds: boolean;
    wake_ups: number | null;
    loss?: BackpressureLossVerdict | null;
    /** Why it does not hold a tick either way (`holdsWithMargin`), or null where it does */
    margin?: string | null;
}

/** How a part is shown in the log */
const partName = (part: PerBranchPart): string => part.alternative_id ?? part.name;

/**
 * The plan the composed clocks run on: the config with the recommended clock's output swings, cycles and fractional swings; where its
 * period is not the shared one, planned again with the cycles that make it so
 */
function sharedPlan(config: Config, recommended: PerBranchPart): PlanRun {
    const plan = recommended.plan ?? {};
    const swings = plan.fractional_swings === true ? { fractional_swings: true as const } : {};
    const planned = (lcm?: number) => planRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false,
        ...(plan.terminal_swing_count !== undefined && { terminal_swing_count: plan.terminal_swing_count }),
        ...(lcm !== undefined && { lcm }) } }, { logger: quiet, ...swings });
    let made = planned(plan.lcm);
    const period = recommended.period_ticks;
    if (made.run.duration.ticks !== period && config.overrides?.lcm === undefined) {
        const cycles = period / (made.run.duration.ticks / made.run.recipe_lcm);
        if (Number.isInteger(cycles) && cycles >= 1) made = planned(cycles);
    }
    if (made.run.duration.ticks !== period) refuse(`the build plans on ${made.run.duration.ticks} ticks, not the recommended clock's ${period}`);
    return made;
}

/** The per-branch clock of a build from its parts (see PerBranchNotApplicable above) */
export function perBranchClock(config: Config, input: PerBranchInput, options: GenerateClockOptions = {}): BlueprintGenerationResult {
    const logger = options.logger ?? defaultLogger;
    const recommended = input.parts.find(part => part.alternative_id === input.recommended_id);
    if (recommended === undefined) refuse(`the recommended clock ${input.recommended_id} is not among the parts`);
    const shared_ticks = recommended.period_ticks;
    if (!Number.isInteger(shared_ticks)) refuse(`the recommended clock's period of ${shared_ticks} ticks is not whole`);
    const made = sharedPlan(config, recommended);
    const registry = made.run.simulation_context.entity_registry;
    const inserters: GroupedInserter[] = registry.getAll().filter(Entity.isInserter)
        .map(it => ({ id: it.entity_id.id, source: it.source.entity_id.id, sink: it.sink.entity_id.id }));
    const lean: GenerateClockOptions = { logger: quiet, verify_as_built: true, loop_windows: false, modulo_blueprint: false, fuel_consumption_view: false };

    const trials = new Map<string, Trial>();
    const trialOf = (windows: SerializableClockWindows, left_open: ReadonlyMap<string, AlwaysOnReason>): Trial => {
        const key = partKey({ period_ticks: shared_ticks, windows });
        const known = trials.get(key);
        if (known !== undefined) return known;
        const map = new Map(Object.entries(windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
        const result = finishedClock(made, map, [], lean, left_open);
        const as_built = result.stability_check.as_built;
        const trial: Trial = { windows, result, holds: as_built?.holds === true, wake_ups: as_built?.wake_ups?.wake_ups_per_minute ?? null };
        trials.set(key, trial);
        return trial;
    };
    const fits = (part: PerBranchPart) => Number.isInteger(part.period_ticks) && Number.isInteger(shared_ticks / part.period_ticks)
        && (part === recommended || part.alternative_id === undefined || part.verdict === "stable");
    const candidates = input.parts.filter(part => part !== recommended && fits(part) && part.counted !== false);
    // a part gives windows where its own clock on the shared period was counted as built: one of that period counted already (its own
    // check), any other counted here, once, where it gives a group a choice the parts before it do not
    const given = new Set(partGroups(inserters, [recommended], shared_ticks).map(group => `${group.source}|${JSON.stringify(group.choices[0].windows)}`));
    let counted_here = 0;
    const admitted = candidates.filter(part => {
        const own = partGroups(inserters, [part], shared_ticks).map(group => `${group.source}|${JSON.stringify(group.choices[0].windows)}`);
        if (own.every(key => given.has(key))) return false;
        let counted = part.counted === true && part.period_ticks === shared_ticks;
        if (!counted) {
            counted_here++;
            const windows = tiledWindows(part.windows, part.period_ticks, shared_ticks);
            counted = trialOf(windows, leftOpenOf(part, inserters, windows)).result.stability_check.as_built?.wake_ups !== undefined;
        }
        if (counted) own.forEach(key => given.add(key));
        return counted;
    });
    const groups = partGroups(inserters, [recommended, ...admitted], shared_ticks);
    const choosing = groups.filter(group => group.choices.length > 1);
    logger.log(`Per-branch clock: the parts ${[recommended, ...admitted].map(part => `${partName(part)} (${part.period_ticks} ticks)`).join(", ")}`);
    logger.log(`Per-branch clock: ${admitted.length + 1} parts on ${shared_ticks} ticks (${counted_here} counted here), ${groups.length} groups, `
        + `${choosing.length} with a choice: ${choosing.map(group => `${group.source} ${group.choices.length}`).join(", ") || "none"}`);
    if (choosing.length === 0) refuse("no group of inserters has another choice than the recommended clock's");

    // the windows the clock has beside its inserters' (drills), from the recommended clock
    const fixed = Object.fromEntries(Object.entries(tiledWindows(recommended.windows, recommended.period_ticks, shared_ticks))
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
    const lossOf = (trial: Trial): BackpressureLossVerdict | null => {
        if (trial.loss === undefined) trial.loss = backpressureLossVerdictOf(made.config, trial.result, quiet).backpressure_loss;
        return trial.loss;
    };
    const marginOf = (trial: Trial): string | null => {
        if (trial.margin === undefined) {
            trial.margin = holdsWithMargin(made, new Map(Object.entries(trial.windows).map(([id, ranges]) =>
                [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const)), shared_ticks);
        }
        return trial.margin;
    };

    // from the recommended clock: every group at the choice its windows are
    const current = new Map<string, number>(groups.map(group => [group.source, 0]));
    for (let pass = 0; pass < PER_BRANCH_MAX_PASSES; pass++) {
        let changed = false;
        for (const group of choosing) {
            const at = current.get(group.source)!;
            const tried = group.choices.map((_, index) => ({ index, trial: trialOfChoice(new Map(current).set(group.source, index)) }));
            const ranked = tried.filter(it => it.trial.holds && it.trial.wake_ups !== null)
                .sort((a, b) => Math.round(a.trial.wake_ups! * 1000) - Math.round(b.trial.wake_ups! * 1000)
                    || (a.index === at ? -1 : b.index === at ? 1 : 0) || a.index - b.index);
            // the current choice stays where it ranks first; another is taken when it holds a tick either way and gets back from every
            // loss (on a build with a deadlock risk the losses do not decide), else one whose losses could not be tried
            let taken: number | undefined;
            let untried: number | undefined;
            for (const it of ranked) {
                if (it.index === at) { taken = at; break; }
                if (marginOf(it.trial) !== null) continue;
                const loss = deadlock_risk ? undefined : lossOf(it.trial);
                if (deadlock_risk || loss?.survives === true) { taken = it.index; break; }
                if (loss === null) untried ??= it.index;
            }
            taken ??= untried;
            if (taken !== undefined && taken !== at) {
                current.set(group.source, taken);
                changed = true;
                logger.log(`Per-branch clock, pass ${pass + 1}: ${group.source} takes ${partName(group.choices[taken].parts[0])} `
                    + `(${tried[taken].trial.wake_ups} wakeups a minute)`);
            }
        }
        if (!changed) break;
    }
    const { windows, left_open } = compose(current);
    if (partKey({ period_ticks: shared_ticks, windows }) === partKey({ period_ticks: shared_ticks, windows: tiledWindows(recommended.windows, recommended.period_ticks, shared_ticks) })) {
        refuse("the local choice keeps the recommended clock");
    }
    const margin = marginOf(trialOf(windows, left_open));
    if (margin !== null) refuse(`the composed clock: ${margin}`);
    const map = new Map(Object.entries(windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    logger.log(`Per-branch clock: ${groups.map(group => `${group.source} from ${partName(group.choices[current.get(group.source)!].parts[0])}`).join(", ")}; `
        + `${trials.size} clocks simulated`);
    const result = finishedClock(made, map, [], { ...options, loop_windows: false }, left_open);
    return { ...result, per_branch: { parts: Object.fromEntries(groups.map(group => [group.source, partName(group.choices[current.get(group.source)!].parts[0])])),
        sources: sourceControlsOf(groups, current, result.always_on_reasons ?? {}, logger, config.target_output.recipe) } };
}

/** The inserters a part leaves always enabled, with its reasons */
function leftOpenOf(part: PerBranchPart, inserters: readonly GroupedInserter[], windows: SerializableClockWindows): Map<string, AlwaysOnReason> {
    return new Map(inserters.flatMap(it => {
        const reason = windows[it.id]?.length ? undefined : part.always_on?.[it.id];
        return reason === undefined ? [] : [[it.id, reason] as const];
    }));
}
