import fs from "fs";
import path from "path";
import {createHash} from "crypto";
import {clockIdentity} from "../../../src/crafting/clock-identity";
import {runHolds as judgedRunHolds} from "../helpers/run-judgement";

/**
 * Where a control came from: the PR that recorded it in the game (or pinned it), the commit that added it, and the
 * frozen engine head its clock was generated and recorded on (null where there is no single committed recording head).
 * Retained captures may instead name their separate control and harness sources below.
 */
interface RecordingIdentity {
    frozen_head: string | null;
    /** What changed in the entry after the recording, such as a verdict a later PR corrected */
    note?: string;
    /**
     * The sha256 of the identity (`clockIdentity`) of the clock the game ran for the entry's `native` summary. A game test
     * refuses to run on another clock, and `pinMismatches` finds a pin that moved without a new recording
     */
    clock_sha256?: string;
    /**
     * How the hash is known: a retained capture whose summary equals `native`, the history of the pin, or the clock
     * regenerated on the engine of the recording's commit; or `built`: the clock is hand-made (a build's own clock,
     * named to the harness), so there is no pin, and the hash is that of `builtClockIdentity`, which the tests recompute
     * from the blueprint
     */
    clock_basis?: "capture" | "history" | "regenerated" | "built";
}

/**
 * A retained capture can predate the commit that publishes its pin. Its validation PR, generated control and harness
 * heads identify the actual recording, without claiming a future pin commit or publication PR.
 */
export type Recorded = RecordingIdentity & (
    {pr: number; commit: string; capture?: never}
    | {pr?: never; commit?: never; capture: {validation_pr: number; control_head: string; harness_head: string; game_version: string}}
);

/** A native capture's summary, as pickup-clock-capture.ts writes and compares it */
export interface NativeClockSummary {
    generationVerdict: string;
    target: number;
    period: number;
    expected: number;
    baseline: number[];
    recovery: {cut: number; during: number[]; recovered: number[]; not_assessed?: string}[];
    interventions?: [number, number, number][];
}

/**
 * A native run's summary under the game tests' protocol, timed in game ticks (owner 2026-11-03): helpers/lua/steady.lua records
 * the run (what the machines that make the target item finish over the trailing minute steers each step; their products and
 * output stock are recorded for the whole run) and helpers/run-judgement.js judges the record, host-side. Ticks count from the
 * clock's start.
 */
export interface NativeRunSummary {
    protocol: "trailing-minute";
    generationVerdict: string;
    /** Products a second the build is asked for (its share of the config's target) */
    target: number;
    /** The window cycle of the clock it ran, which ties the summary to its pin; nothing is timed by it */
    period: number;
    /** Ticks in the trailing window, and the products the window has to hold: target x window / 60 */
    window: number;
    expected: number;
    /** The first tick the trailing window held `expected`; null where it never did within the bound */
    steady: number | null;
    baseline: NativeBaseline | null;
    disturbances: NativeDisturbance[];
    /** The output stock guard; null for a build judged by a count (no final machines' output) or with no whole baseline cycle */
    stock: NativeStockGuard | null;
    /** "holds", or the step that failed */
    result: string;
    /** The tick the run ended in */
    ended: number;
}

/** The baseline after steady state: its total against the target over it, the trailing window's range, and how it is judged */
export interface NativeBaseline {
    ticks: number;
    total: number;
    expected: number;
    min: number;
    max: number;
    /** The trailing window never fell below `expected` in it (not the verdict: a minute holds a burst more or less by where it starts) */
    held: boolean;
    /**
     * The whole clock cycles in it: from the steady-state tick to the last tick of the baseline at which the clock stands where
     * it stood then, the final machines' products (`items`), their output stock at both ends and the net output (products less
     * the stock gained: what left them), against the target over those ticks; absent where no cycle fits in the baseline. A
     * build judged by a count has no stock, and its net output is the count
     */
    measured?: {ticks: number; items: number; expected: number; stock_start?: number; stock_end?: number; net: number};
    /** The baseline holds (owner, 2026-11-03): the net output of its whole clock cycles makes the target, 100% or more */
    meets: boolean;
}

/**
 * The output stock guard (owner, 2026-11-03): the final machines' output stock at the end of the run (after the last recovery)
 * is no lower than the lowest it was at any tick of the baseline's whole cycles, so a slowly draining stock (underproduction
 * the output inserters would hide) fails the run
 */
export interface NativeStockGuard {
    lowest: number;
    end: number | null;
    holds: boolean;
}

/** A disturbance: what it was, when it started, when the output fell below the baseline's lowest window and it was released, when the steady-state test was met again */
export interface NativeDisturbance {
    kind: string;
    start: number;
    drop?: number;
    release?: number;
    recovered?: number;
}

/** A summary under the protocol timed in game ticks, not a legacy one counted in window cycles */
export function isRunSummary(native: NativeClockSummary | NativeRunSummary): native is NativeRunSummary {
    return (native as NativeRunSummary).protocol === "trailing-minute";
}

/**
 * Whether a run summary shows the clock holding its target (net output over the baseline's whole cycles), recovering from every
 * disturbance it ran, and ending with its output stock no lower than in the baseline (helpers/run-judgement.js)
 */
export function runHolds(native: NativeRunSummary, known?: KnownDifferences): boolean {
    return judgedRunHolds(known?.stock_guard ? {...native, stock: null} : native);
}

/** The selection the generator makes, pinned by a portable generation test, with the sha256 of its exported clock */
export interface GenerationPin {
    period: number;
    expected: number;
    verdict: string;
    selection: {id: string; holds: boolean; rate: number; supply: string | null};
    clock_sha256: string;
    /** Where the pin also holds the model's own evidence of the selection (its `stability_check.as_built`), apart from the native recording: the fields a generation test finds in it */
    as_built?: Record<string, unknown>;
    /** The cause the generation gives of why its selection does not meet goal 1 (see whyNotStable); absent where it does */
    why_not_stable?: string;
}

/** One configuration of a family: its current recording and, where a generation test pins it, the selection */
/** Either kind of native summary */
export type AnyNativeSummary = NativeRunSummary | NativeClockSummary;

export interface ClockControl<N extends AnyNativeSummary = AnyNativeSummary> {
    recorded: Recorded;
    /** The run under the protocol timed in game ticks; a legacy summary counted in window cycles in the history files and the families not moved yet */
    native: N;
    generation?: GenerationPin;
    /**
     * The alternative the generator selected before the entry's pin, and the sha256 of its exported clock: a generation
     * test finds it still made, so the clock the earlier recording was on stays one the generator offers
     */
    previous?: PreviousClock;
    /**
     * Of a container fixture whose two cuts take the same input: the window cycles the simulator holds the target through the
     * second cut when it runs the probe's protocol on the pinned clock. A clock that brings more than the target's share
     * refills the container between the cuts, and the game holds the target as long as that stock lasts
     */
    second_cut_held_simulated?: number;
    /** Rules of the run that this entry is known to fail, each with its reason and issue; every other rule is still asserted */
    known_differences?: KnownDifferences;
}

/** A known difference of a run: a rule it fails, with the reason and the issue that tracks it */
export interface KnownDifferences {
    /** The output stock guard: the run ends with the final machines' output stock below the baseline's lowest */
    stock_guard?: string;
}

/** An alternative that is no longer selected and is still made: its id and the sha256 of its exported clock */
export interface PreviousClock {
    id: string;
    clock_sha256: string;
}

/** A family's controls file: one current entry per configuration */
export interface ClockControls<N extends AnyNativeSummary = NativeClockSummary> {
    meaning: string;
    cases: Record<string, ClockControl<N>>;
}

/** A family's controls file whose entries are runs under the protocol timed in game ticks */
export type RunControls = ClockControls<NativeRunSummary>;

/** A family's history file: the recordings a later PR replaced, per configuration, oldest first */
export interface ClockHistory {
    meaning: string;
    cases: Record<string, {recorded: Recorded; native: AnyNativeSummary; generation?: GenerationPin}[]>;
}

/** Reads a controls file of tests/game/builds/ by its name */
export function readControls<T = ClockControls>(file: string): T {
    return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8")) as T;
}

/**
 * The native summary a capture of `name` is compared with: the current one in the family file `controls` (a path), or
 * the one BELT_CLOCK_EXPECTATIONS names: a family file, or a history file and the PR of the recording, `<file>#<pr>`.
 */
export function expectedNativeSummary(controls: string, name: string): AnyNativeSummary | undefined {
    const [file, pr] = (process.env.BELT_CLOCK_EXPECTATIONS ? path.resolve(process.env.BELT_CLOCK_EXPECTATIONS) : controls).split("#");
    const read = JSON.parse(fs.readFileSync(file, "utf8")) as ClockControls<AnyNativeSummary> | ClockHistory;
    const entry = read.cases[name];
    if (pr === undefined) {
        return Array.isArray(entry) ? undefined : entry?.native;
    }
    return (Array.isArray(entry) ? entry : [entry]).find(it => it?.recorded.pr === Number(pr))?.native;
}

/** sha256 of the identity of an exported clock: the hash the pins use */
export function clockHash(clock: Parameters<typeof clockIdentity>[0]): string {
    return createHash("sha256").update(JSON.stringify(clockIdentity(clock))).digest("hex");
}

/**
 * The entries of a family's controls whose recording and pin name different clocks, as lines to read: an entry with a
 * `native` summary has the hash of the clock it was recorded on, and it is the hash of its pin: a pin that moved is
 * recorded again in the game. `untied` names the entries still without a hash (they may only be removed from the list).
 */
export function pinMismatches(cases: Record<string, ClockControl>, untied: readonly string[] = [], built: Record<string, string> = {}): string[] {
    const found: string[] = [];
    const hash = /^[0-9a-f]{64}$/;
    for (const [name, control] of Object.entries(cases)) {
        const {recorded, generation} = control;
        if (recorded.capture !== undefined) {
            const capture = recorded.capture;
            if (recorded.pr !== undefined || recorded.commit !== undefined) found.push(`${name}: capture provenance must not claim pin publication identifiers`);
            if (!Number.isSafeInteger(capture.validation_pr) || capture.validation_pr <= 0) found.push(`${name}: capture.validation_pr must name the validation PR`);
            if (!/^[0-9a-f]{40}$/.test(capture.control_head) || !/^[0-9a-f]{40}$/.test(capture.harness_head)) found.push(`${name}: capture requires full control and harness commit identities`);
            if (!capture.game_version.trim()) found.push(`${name}: capture.game_version is missing`);
            if (recorded.clock_basis !== "capture") found.push(`${name}: capture provenance requires the capture clock basis`);
        }
        if (name in built) {
            // a hand-made clock is no selection and has no pin: the recording names the clock it ran, and it has to be
            // the clock of the blueprint the test builds
            if (recorded.clock_basis !== "built") found.push(`${name}: is named as a hand-made clock and its recorded.clock_basis is not "built"`);
            if (generation) found.push(`${name}: a hand-made clock is no selection and has no generation pin`);
            if (!recorded.clock_sha256 || !hash.test(recorded.clock_sha256)) found.push(`${name}: recorded.clock_sha256 is missing: it is the identity of the hand-made clock`);
            else if (recorded.clock_sha256 !== built[name]) {
                found.push(`${name}: the hand-made clock in the blueprint is ${built[name].slice(0, 12)} and the native summary was recorded on ${recorded.clock_sha256.slice(0, 12)}: record it again in the game`);
            }
            continue;
        }
        if (recorded.clock_basis === "built") {
            found.push(`${name}: recorded.clock_basis is "built" and the entry is not named as a hand-made clock`);
            continue;
        }
        if (untied.includes(name)) {
            if (recorded.clock_sha256 !== undefined) found.push(`${name}: has a recorded clock and is still listed as not tied`);
            continue;
        }
        if (!recorded.clock_sha256 || !hash.test(recorded.clock_sha256)) {
            found.push(`${name}: recorded.clock_sha256 is missing: it is the clock the native summary was recorded on`);
            continue;
        }
        if (!recorded.clock_basis) found.push(`${name}: recorded.clock_basis is missing`);
        if (!generation) {
            found.push(`${name}: has a native summary and no generation pin`);
            continue;
        }
        // a run keeps its target to a millionth (34.285714 for 240/7): its output a window cycle is the pin's to a thousandth
        const perWindowCycle = isRunSummary(control.native) ? Math.round(control.native.target * control.native.period / 60 * 1e3) / 1e3 : control.native.expected;
        const pinned = isRunSummary(control.native) ? Math.round(generation.expected * 1e3) / 1e3 : generation.expected;
        if (perWindowCycle !== pinned || control.native.period !== generation.period) {
            found.push(`${name}: the native summary (period ${control.native.period}, expected ${perWindowCycle} a period) and the pin (${generation.period}, ${generation.expected}) are of different clocks`);
        }
        if (recorded.clock_sha256 !== generation.clock_sha256) {
            found.push(`${name}: the pin names clock ${generation.clock_sha256.slice(0, 12)} and the native summary was recorded on ${recorded.clock_sha256.slice(0, 12)}: record it again in the game (recorded.clock_sha256)`);
        }
    }
    return found;
}

/**
 * The hash a game test has to find the clock it runs to have, for the entry `name` of the family file `controls`: the
 * recorded one. Undefined where BELT_CLOCK_EXPECTATIONS names other summaries, or the file has no hash for the entry
 */
export function clockToRun(controls: string, name: string): string | undefined {
    if (process.env.BELT_CLOCK_EXPECTATIONS) return undefined;
    const entry = (JSON.parse(fs.readFileSync(controls, "utf8")) as ClockControls).cases[name];
    if (!entry?.recorded.clock_sha256) return undefined;
    return entry.recorded.clock_sha256;
}

/** Checks both active and superseded cold trajectories, retaining missing-clock and unused-clock detection. */
export function coldClockReferenceMismatches(clocks: Record<string, unknown>, runs: Record<string, {clock: string}>, historical: Record<string, {clock: string}> = {}): string[] {
    const used = new Set([...Object.values(runs), ...Object.values(historical)].map(run => run.clock));
    return [
        ...[...used].filter(key => !Object.prototype.hasOwnProperty.call(clocks, key)).map(key => `${key}: run names a missing clock`),
        ...Object.keys(clocks).filter(key => !used.has(key)).map(key => `${key}: clock has no current or historical run`),
    ];
}

/** A known historical capture keeps its identity, distinct from the current pin and consistent with its old summary. */
export function historicalPinMismatches(history: ClockHistory["cases"], current: ClockControls<AnyNativeSummary>["cases"]): string[] {
    const found: string[] = [];
    for (const [name, entries] of Object.entries(history)) for (const [index, entry] of entries.entries()) {
        if (entry.recorded.clock_sha256 === undefined) continue; // No identity was recovered for these older recordings.
        const label = `${name}[${index}]`;
        found.push(...pinMismatches({[label]: entry}));
        if (!current[name]) found.push(`${label}: no current case for the historical recording`);
        else if (current[name].generation?.clock_sha256 === entry.recorded.clock_sha256) found.push(`${label}: historical capture still names the active pin`);
    }
    return found;
}

/** An alternative of a record job (`record/<job>.json`, format clock-record-1): the fields a control's pin is checked against */
export interface RecordAlternative {
    id: string;
    verdict: string;
    holds: boolean;
    rate: number;
    supply: string | null;
    period: number;
    clock_sha256: string;
}

/** A job of the record: the id of the selected alternative and every alternative the generator made */
export interface RecordJob {
    job: string;
    selected: string;
    alternatives: RecordAlternative[];
}

/** The record's job `job`, or undefined where it has no file or its config failed to generate */
export function readRecordJob(job: string): RecordJob | undefined {
    const file = path.join(__dirname, "../../../record", `${job}.json`);
    if (!fs.existsSync(file)) return undefined;
    const read = JSON.parse(fs.readFileSync(file, "utf8")) as RecordJob & {error?: string};
    return read.error === undefined ? read : undefined;
}

/** How a family's entries meet the record: the job of an entry, which of them are alternatives the generator offers and does not select, and the supply a run was made under */
export interface RecordLink {
    /** The record job of the entry `name`, or undefined for a pin that has no job (the list of those is kept by the test) */
    jobOf(name: string): string | undefined;
    /** Entries whose pin is of an alternative the generator makes and does not select (the others are the selection) */
    offered?: readonly string[];
    /** The supply the game run of the entry `name` was made under: only then does the run speak to the generator's `holds` verdict; undefined where it always does */
    runSupply?(name: string): "moving" | "backed_up";
}

/**
 * The entries of a family's controls whose generation pin is of another alternative than the one the game test's fixture
 * says it records (`named`, by entry name), or that have a pin and no fixture alternative. Lines to read.
 */
export function fixtureAlternativeMismatches(cases: Record<string, ClockControl>, named: Record<string, string>): string[] {
    return Object.entries(cases).filter(([, control]) => control.generation).flatMap(([name, control]) =>
        named[name] === undefined ? [`${name}: has a generation pin and its fixture names no alternative`]
            : named[name] === control.generation!.selection.id ? []
                : [`${name}: the fixture records ${named[name]} and the pin is of ${control.generation!.selection.id}`]);
}

/**
 * The entries of a family's controls whose generation pin differs from the record: the pin is of the record job's alternative
 * with the pin's `selection.id` (its clock hash, window cycle, verdict, holds, rate and supply), the selection where the entry is not
 * listed as `offered`, and its `previous` clock is an alternative of the job with that hash. Where the game's run is judged
 * (`runs`), a stable alternative holds in the game and a run that misses its target over the baseline is one the generator
 * sees, as `expectRunAgreesWithSelection` asked of the generation. Lines to read; an entry with no job is not looked at.
 */
export function recordMismatches(cases: Record<string, ClockControl>, link: RecordLink, record: (job: string) => RecordJob | undefined = readRecordJob, runs = false): string[] {
    const found: string[] = [];
    for (const [name, control] of Object.entries(cases)) {
        const pin = control.generation;
        const job = link.jobOf(name);
        if (pin === undefined || job === undefined) continue;
        const made = record(job);
        if (made === undefined) {
            found.push(`${name}: record job ${job} has no result in the record`);
            continue;
        }
        const alternative = made.alternatives.find(it => it.id === pin.selection.id);
        if (alternative === undefined) {
            found.push(`${name}: record job ${job} has no alternative ${pin.selection.id}`);
            continue;
        }
        const where = `record job ${job}, alternative ${alternative.id}`;
        if (alternative.clock_sha256 !== pin.clock_sha256) {
            found.push(`${name}: the pin names clock ${pin.clock_sha256.slice(0, 12)} and ${where} makes ${alternative.clock_sha256.slice(0, 12)}: the generation moved, so the game recording is of another clock`);
        }
        const shape = (window_cycle_ticks: number, verdict: string, selection: GenerationPin["selection"]) =>
            ({period: window_cycle_ticks, verdict, selection: {id: selection.id, holds: selection.holds, rate: selection.rate, supply: selection.supply}});
        const asPinned = shape(alternative.period, alternative.verdict, alternative);
        const pinned = shape(pin.period, pin.verdict, pin.selection);
        if (JSON.stringify(asPinned) !== JSON.stringify(pinned)) found.push(`${name}: the pin (${JSON.stringify(pinned)}) and ${where} (${JSON.stringify(asPinned)}) differ`);
        const offered = link.offered?.includes(name) ?? false;
        if (!offered && made.selected !== pin.selection.id) {
            found.push(`${name}: the pin is of ${pin.selection.id} and ${job} selects ${made.selected}: record the selection in the game, or list the entry as an alternative the generator makes and does not select`);
        }
        if (offered && made.selected === pin.selection.id) found.push(`${name}: is listed as not selected and ${job} selects ${pin.selection.id}: take it off the list`);
        if (control.previous) {
            const earlier = made.alternatives.find(it => it.id === control.previous!.id);
            if (earlier === undefined) found.push(`${name}: the earlier clock ${control.previous.id} is no longer made by record job ${job}`);
            else if (earlier.clock_sha256 !== control.previous.clock_sha256) found.push(`${name}: the earlier clock ${control.previous.id} is ${control.previous.clock_sha256.slice(0, 12)} and record job ${job} makes ${earlier.clock_sha256.slice(0, 12)}`);
        }
        if (runs && isRunSummary(control.native)) {
            const native = control.native;
            if (native.generationVerdict !== alternative.verdict) found.push(`${name}: the game run was recorded on a ${native.generationVerdict} clock and ${where} is ${alternative.verdict}`);
            if (alternative.verdict === "stable" && !runHolds(native, control.known_differences)) found.push(`${name}: ${where} is stable and the game run does not hold and recover (${native.result})`);
            const ownSupply = link.runSupply === undefined || link.runSupply(name) === alternative.supply;
            if (ownSupply && native.baseline?.meets !== true && alternative.holds) found.push(`${name}: the run misses the target over its baseline and ${where} says it holds: the generator has to see that itself`);
        }
    }
    return found;
}
