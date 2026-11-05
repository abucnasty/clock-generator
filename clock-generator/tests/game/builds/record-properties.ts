// The property module of the record (#600): what must be true of the result of every blast job, whatever the build, run on every
// alternative of every job. blast.blastrun.ts calls it where the generated results are in hand (a job's alternatives hold the
// simulation's histories, which are far too big to keep) and writes what it finds into the job file as `properties`;
// `blast.sh record check` fails on any problem, naming the job, the property, the alternative and the values.
//
// A property states what a result must satisfy; it never pins a value (the record does that). One that fails on a job is a
// finding about that job's result, not a reason to loosen the property: a job that cannot satisfy it for a named reason goes in
// EXCEPTIONS, with the reason, and the pull request that adds it says so.
import { createHash } from 'crypto';
import fs from 'fs';
import type { Config } from '../../../src/config/schema';
import { OpenRange } from '../../../src/data-types';
import { EntityId } from '../../../src/entities';
import { deciderBuildOrder } from '../../../src/crafting/decider-order';
import type { ClockAlternativesResult } from '../../../src/crafting/generate-blueprint';
import { alwaysOnReasonProblems } from '../../../src/crafting/generate-blueprint-test-helpers';
import { createEntityRegistryFromConfig } from '../../../src/crafting/sequence/simulation-context';

export const PROPERTIES = [
    'always-on-reasons-named',
    'decider-build-order',
    'stable-holds-and-survives-loss',
    'counters-add-up',
    'fuel-never-dry',
] as const;
export type PropertyName = typeof PROPERTIES[number];

export interface PropertyProblem {
    property: PropertyName;
    /** The alternative's id */
    alternative: string;
    /** What was found: the values that break the property */
    message: string;
}

/** What the module found on one job: how many alternatives each property was checked on, and the problems */
export interface PropertyReport {
    /** The hash of this file's text: `record check` refuses a job judged by another version of it */
    module_sha256: string;
    /** For each property, the alternatives it applied to (it does not apply to one that has no fuel, no counters or no schedule) */
    checked: Record<PropertyName, number>;
    problems: PropertyProblem[];
    /** What the job's exceptions (EXCEPTIONS) found: not problems, and shown by `record check` */
    excepted?: { property: PropertyName; alternative: string; reason: string; found: string[] }[];
}

/** An alternative of a job that a property does not hold on, for a reason that is the job's own */
export interface PropertyException {
    alternatives: string[];
    reason: string;
}

/**
 * The alternatives of jobs that a property does not hold on, by job and property: each is a finding the pull request lists, and
 * `record check` shows what it found on them. A property that fails on a job is not loosened for every job to pass.
 */
export const EXCEPTIONS: Record<string, Partial<Record<PropertyName, PropertyException>>> = {
    // found by the module on jobs it never ran on (#600), tracked in #626: on these alternatives an inserter's counters have it swing more often than it grabs, by 0.04% to 0.18%
    'config-ADVANCED_CIRCUIT_230': { 'counters-add-up': { alternatives: ['full-hand-subtick'], reason: '#626: swings a minute exceed grabs a minute on inserter:1 and inserter:2 (209.2315 against 209.0830)' } },
    'config-PRODUCTIVITY_MODULE_80_CHEST_CHAIN': { 'counters-add-up': { alternatives: ['derived'], reason: '#626: swings a minute exceed grabs a minute on inserter:3 (242.4587 against 242.3554)' } },
    'variants-STEEL_PLATE_26_WAGON_CHEST_IRON_ORE_OUT_OF_PERIOD': { 'counters-add-up': { alternatives: ['swings-3-subtick'], reason: '#626: swings a minute exceed grabs a minute on inserter:5 (81.2980 against 81.1494)' } },
    'variants-STEEL_HUB_26_CONTAINER_OUTPUT': { 'counters-add-up': { alternatives: ['planned-belt-slack-subtick'], reason: '#626: swings a minute exceed grabs a minute on inserter:5 (81.2980 against 81.1494)' } },
    'config-STEEL_PLATE_26_WAGON_CHEST': { 'counters-add-up': { alternatives: ['planned-belt-slack-subtick'], reason: '#626: swings a minute exceed grabs a minute on inserter:5 (81.2980 against 81.1494)' } },
};

/** The most problems kept for one property of one job: the first ones say what is wrong, and a build with hundreds is as broken as one with twenty */
const MOST_PROBLEMS = 20;

export const moduleSha256 = () => createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');

type Alternative = ClockAlternativesResult['alternatives'][number];

const close = (a: number, b: number, digits: number) => Math.abs(a - b) < Math.pow(10, -digits) / 2;

/** Every inserter and drill a clock leaves always on names why (the engine's helper; its string is the problem) */
function alwaysOnReasons(config: Config, alternative: Alternative): string[] {
    return alwaysOnReasonProblems(config, alternative.result, alternative.id);
}

/**
 * The order the check of a clock gives its deciders is the order the exported blueprint builds them in: of two inserters, the one
 * whose decider has the higher entity number stands later; a fuel inserter on a clock of its own has no window of the period and its
 * decider comes after them all (it decides which of two windows that open together the game updates first, #268).
 * Null where the alternative has no schedule of deciders.
 */
function deciderOrder(registry: ReturnType<typeof createEntityRegistryFromConfig>, alternative: Alternative): string[] | null {
    const deciders = alternative.result.schedule?.inserter_combinators;
    if (deciders === undefined) return null;
    const windows = new Map(Object.entries(alternative.result.clock_windows).map(([key, ranges]) =>
        [key, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const derived = deciderBuildOrder(windows, registry);
    const built = new Map<string, number>();
    for (const decider of deciders) {
        decider.inserter_ids.forEach(id => built.set(EntityId.forInserter(id).id, decider.entity_number));
    }
    const problems: string[] = [];
    const window_deciders = Array.from(derived.keys()).filter(key => built.has(key));
    for (const a of window_deciders) {
        for (const b of window_deciders) {
            const want = Math.sign(built.get(a)! - built.get(b)!);
            const got = Math.sign(derived.get(a)! - derived.get(b)!);
            if (got !== want) problems.push(`${a} against ${b}: the check orders them ${got}, the blueprint builds them ${want} (decider numbers ${built.get(a)} and ${built.get(b)}, check positions ${derived.get(a)} and ${derived.get(b)})`);
        }
    }
    const last_window_decider = Math.max(...window_deciders.map(key => built.get(key)!));
    for (const [key, number] of built) {
        if (!derived.has(key) && !(number > last_window_decider)) {
            problems.push(`${key} has no window and its decider is number ${number}, not after the last window decider (${last_window_decider})`);
        }
    }
    return problems;
}

/**
 * What the generator calls stable is a clock that holds its expected output and gets back to it after every loss: its verdict is
 * stable only when it survives, every clock that holds is tried for the loss and no other, and a clock that meets the target rate is
 * a stable one.
 */
function stableMeans(alternative: Alternative): string[] {
    const problems: string[] = [];
    const { verdict, assessment, ranking } = alternative;
    const tried = assessment.backpressure_loss !== null;
    if (tried !== (verdict !== 'unstable')) {
        problems.push(`verdict ${verdict} and backpressure_loss ${tried ? 'tried' : 'not tried'}: a clock is tried for the loss when it is not unstable, and not otherwise`);
    }
    const survives = verdict !== 'unstable' && assessment.backpressure_loss?.survives === true;
    if ((verdict === 'stable') !== survives) {
        problems.push(`verdict ${verdict} against survives ${assessment.backpressure_loss?.survives}: stable only when it is not unstable and survives`);
    }
    if (ranking.meets_target_rate && verdict !== 'stable') {
        problems.push(`meets the target rate with verdict ${verdict}`);
    }
    return problems;
}

/** The per-inserter counters add up: input and output wake-ups to the inserter's wake-ups, switch-ons at rest and moving to its switch-ons, and the clock-level figures agree with the alternative. Null where there are none. */
function countersAddUp(alternative: Alternative, copies: number): string[] | null {
    const as_built = alternative.result.stability_check.as_built;
    const counters = as_built?.counters;
    if (as_built === undefined || counters === undefined) return null;
    const problems: string[] = [];
    const { wake_ups } = as_built;
    if (wake_ups === undefined) {
        problems.push('counters with no wake-ups to add up to');
    } else {
        if (counters.inserters.length !== wake_ups.inserters.length) {
            problems.push(`${counters.inserters.length} inserters counted, ${wake_ups.inserters.length} in the wake-ups`);
        }
        let input = 0;
        let output = 0;
        for (const count of counters.inserters) {
            const wakes = wake_ups.inserters.find(it => it.inserter_id === count.inserter_id);
            if (wakes === undefined) { problems.push(`${count.inserter_id} has counters and no wake-ups`); continue; }
            const sum = count.input_wake_ups_per_minute + count.output_wake_ups_per_minute;
            if (!close(sum, wakes.wake_ups_per_minute, 9)) problems.push(`${count.inserter_id}: input and output wake-ups ${sum} against its wake-ups ${wakes.wake_ups_per_minute}`);
            input += count.input_wake_ups_per_minute;
            output += count.output_wake_ups_per_minute;
        }
        if (!close(input + output, wake_ups.wake_ups_per_minute, 6)) problems.push(`input and output wake-ups ${input + output} against the clock's ${wake_ups.wake_ups_per_minute}`);
    }
    if (counters.deciders !== alternative.deciders) problems.push(`counters say ${counters.deciders} deciders, the alternative ${alternative.deciders}`);
    if (counters.copies !== copies) problems.push(`counters say ${counters.copies} copies, the config ${copies}`);
    if (counters.wired_inserters + counters.unwired_inserters !== counters.inserters.length) {
        problems.push(`${counters.wired_inserters} wired and ${counters.unwired_inserters} unwired inserters, ${counters.inserters.length} counted`);
    }
    const wired = counters.inserters.filter(it => it.network_width !== 0);
    if (wired.length !== counters.wired_inserters) problems.push(`${wired.length} inserters have a network width, ${counters.wired_inserters} are wired`);
    for (const count of counters.inserters) {
        if (count.network_width === null) problems.push(`${count.inserter_id} has no network width`);
        if (!close(count.switch_ons_at_rest_per_minute + count.switch_ons_moving_per_minute, count.switch_ons_per_minute, 9)) {
            problems.push(`${count.inserter_id}: switch-ons at rest and moving ${count.switch_ons_at_rest_per_minute + count.switch_ons_moving_per_minute} against ${count.switch_ons_per_minute}`);
        }
        if (count.swings_per_minute > count.grabs_per_minute + 1e-9) problems.push(`${count.inserter_id}: ${count.swings_per_minute} swings against ${count.grabs_per_minute} grabs a minute`);
        if (count.network_width === 0 && count.switch_ons_per_minute + count.switch_offs_per_minute !== 0) {
            problems.push(`${count.inserter_id} is on no network and switches ${count.switch_ons_per_minute} on, ${count.switch_offs_per_minute} off`);
        }
    }
    return problems;
}

/** No machine that burns fuel runs out of it in the fuel consumption view of the exported clock. Null where the build has no fuel view. */
function fuelNeverDry(alternative: Alternative): string[] | null {
    const view = alternative.result.fuel_consumption_view;
    if (view === undefined || view === null) return null;
    const problems: string[] = [];
    if (view.ran_out_of_fuel) problems.push('the fuel consumption view says a machine ran out of fuel');
    for (const levels of view.fuel_levels) {
        if (levels.empty_ticks !== 0) problems.push(`${levels.machine_id} had no fuel for ${levels.empty_ticks} ticks, from tick ${levels.first_empty_tick}`);
    }
    return problems;
}

/** The properties on every alternative of a job's result */
export function checkProperties(job: string, config: Config, generated: Pick<ClockAlternativesResult, 'alternatives'>): PropertyReport {
    const checked = Object.fromEntries(PROPERTIES.map(name => [name, 0])) as Record<PropertyName, number>;
    const found: PropertyProblem[] = [];
    const registry = createEntityRegistryFromConfig(config);
    const copies = config.target_output.copies ?? 1;
    const note = (property: PropertyName, alternative: Alternative, problems: string[] | null) => {
        if (problems === null) return;
        checked[property]++;
        for (const message of problems) found.push({ property, alternative: alternative.id, message });
    };
    for (const alternative of generated.alternatives) {
        note('always-on-reasons-named', alternative, alwaysOnReasons(config, alternative));
        note('decider-build-order', alternative, deciderOrder(registry, alternative));
        note('stable-holds-and-survives-loss', alternative, stableMeans(alternative));
        note('counters-add-up', alternative, countersAddUp(alternative, copies));
        note('fuel-never-dry', alternative, fuelNeverDry(alternative));
    }
    const excusing = (it: PropertyProblem) => EXCEPTIONS[job]?.[it.property]?.alternatives.includes(it.alternative) === true;
    const excepted = found.filter(excusing).reduce<NonNullable<PropertyReport['excepted']>>((all, it) => {
        const same = all.find(e => e.property === it.property && e.alternative === it.alternative);
        if (same === undefined) all.push({ property: it.property, alternative: it.alternative, reason: EXCEPTIONS[job]![it.property]!.reason, found: [it.message] });
        else same.found.push(it.message);
        return all;
    }, []);
    const kept = found.filter(it => !excusing(it));
    const problems = PROPERTIES.flatMap(name => kept.filter(it => it.property === name).slice(0, MOST_PROBLEMS));
    return { module_sha256: moduleSha256(), checked, problems, ...(excepted.length > 0 && { excepted }) };
}
