import fs from "fs";
import path from "path";
import {createHash} from "crypto";
import {clockIdentity} from "../../../src/crafting/clock-identity";

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
    /**
     * Set where the pin (`generation.clock_sha256`) moved and the recording was not made again: the commit or PR and why
     * the recording still holds. The game test then runs on the pinned clock, which shows whether it does
     */
    carried?: string;
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
 * A native run's summary under the game tests' protocol, timed in game ticks (helpers/lua/steady.lua, owner 2026-11-03): what the
 * machines that make the target item finish over the trailing minute decides each step. Ticks count from the clock's start.
 */
export interface NativeRunSummary {
    protocol: "trailing-minute";
    generationVerdict: string;
    /** Products a second the build is asked for (its share of the config's target) */
    target: number;
    /** The period of the clock it ran, which ties the summary to its pin; nothing is timed by it */
    period: number;
    /** Ticks in the trailing window, and the products the window has to hold: target x window / 60 */
    window: number;
    expected: number;
    /** The first tick the trailing window held `expected`; null where it never did within the bound */
    steady: number | null;
    baseline: NativeBaseline | null;
    disturbances: NativeDisturbance[];
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
     * The whole clock cycles in it: the products from the steady-state tick to the last tick of the baseline at which the clock
     * stands where it stood then, against the target over those ticks; absent where no cycle fits in the baseline
     */
    measured?: {ticks: number; items: number; expected: number};
    /** The baseline holds (owner, 2026-11-03): its whole clock cycles make the target, 100% or more */
    meets: boolean;
}

/** A disturbance: what it was, when it started, when the output fell below the baseline's lowest window and it was released, when the steady-state test was met again */
export interface NativeDisturbance {
    kind: string;
    start: number;
    drop?: number;
    release?: number;
    recovered?: number;
}

/** A summary under the protocol timed in game ticks, not a legacy one counted in clock periods */
export function isRunSummary(native: NativeClockSummary | NativeRunSummary): native is NativeRunSummary {
    return (native as NativeRunSummary).protocol === "trailing-minute";
}

/** Whether a run summary shows the clock holding its target and recovering from every disturbance it ran */
export function runHolds(native: NativeRunSummary): boolean {
    return native.result === "holds" && native.baseline?.meets === true
        && native.disturbances.every(disturbance => disturbance.recovered !== undefined);
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
    /** The run under the protocol timed in game ticks; a legacy summary counted in clock periods in the history files and the families not moved yet */
    native: N;
    generation?: GenerationPin;
    /**
     * The alternative the generator selected before the entry's pin, and the sha256 of its exported clock: a generation
     * test finds it still made, so the clock the earlier recording was on stays one the generator offers
     */
    previous?: PreviousClock;
    /**
     * Of a container fixture whose two cuts take the same input: the periods the simulator holds the target through the
     * second cut when it runs the probe's protocol on the pinned clock. A clock that brings more than the target's share
     * refills the container between the cuts, and the game holds the target as long as that stock lasts
     */
    second_cut_held_simulated?: number;
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

/** A rate as a fraction of whole numbers (the closest with a denominator of at most a million: 480 x 2/7 is 960/7) */
export function rateFraction(rate: number): [number, number] {
    let [h0, h1, k0, k1, x] = [0, 1, 1, 0, rate];
    for (let i = 0; i < 64; i++) {
        const a = Math.floor(x);
        const [h2, k2] = [a * h1 + h0, a * k1 + k0];
        if (k2 > 1_000_000) break;
        [h0, h1, k0, k1] = [h1, h2, k1, k2];
        if (Math.abs(h1 / k1 - rate) < 1e-12 * Math.max(1, rate) || x === a) break;
        x = 1 / (x - a);
    }
    return [h1, k1];
}

/**
 * The baseline's verdict in whole numbers: its whole clock cycles made the target, items x 60 x d >= n x ticks for the target
 * n/d a second. steady.lua compares in floating point, against the target rounded to a millionth, which can put the exact
 * target (8,064 in 3,528 ticks at 960/7 a second) a hair over what was made
 */
export function exactBaseline(baseline: NativeBaseline, target: number): NativeBaseline {
    const measured = baseline.measured;
    if (!measured) return {...baseline, meets: false};
    const [n, d] = rateFraction(target);
    return {...baseline, meets: measured.items * 60 * d >= n * measured.ticks};
}

/** sha256 of the identity of an exported clock: the hash the pins use */
export function clockHash(clock: Parameters<typeof clockIdentity>[0]): string {
    return createHash("sha256").update(JSON.stringify(clockIdentity(clock))).digest("hex");
}

/**
 * The entries of a family's controls whose recording and pin name different clocks, as lines to read: an entry with a
 * `native` summary has the hash of the clock it was recorded on, and it is the hash of its pin unless `carried` says
 * why not. `untied` names the entries still without a hash (they may only be removed from the list).
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
            if (recorded.carried !== undefined) found.push(`${name}: a hand-made clock has no pin to carry`);
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
        // a run keeps its target to a millionth (34.285714 for 240/7): its output a period is the pin's to a thousandth
        const perPeriod = isRunSummary(control.native) ? Math.round(control.native.target * control.native.period / 60 * 1e3) / 1e3 : control.native.expected;
        const pinned = isRunSummary(control.native) ? Math.round(generation.expected * 1e3) / 1e3 : generation.expected;
        if (perPeriod !== pinned || control.native.period !== generation.period) {
            found.push(`${name}: the native summary (period ${control.native.period}, expected ${perPeriod} a period) and the pin (${generation.period}, ${generation.expected}) are of different clocks`);
        }
        if (recorded.carried !== undefined && recorded.carried.trim() === "") found.push(`${name}: recorded.carried is empty: say where the pin moved and why the recording still holds`);
        if (recorded.clock_sha256 !== generation.clock_sha256 && !recorded.carried?.trim()) {
            found.push(`${name}: the pin names clock ${generation.clock_sha256.slice(0, 12)} and the native summary was recorded on ${recorded.clock_sha256.slice(0, 12)}: record it again in the game (recorded.clock_sha256), or say in recorded.carried why the recording still holds`);
        }
        if (recorded.clock_sha256 === generation.clock_sha256 && recorded.carried !== undefined) found.push(`${name}: recorded.carried is set and the hashes agree: remove it`);
    }
    return found;
}

/**
 * The hash a game test has to find the clock it runs to have, for the entry `name` of the family file `controls`: the
 * recorded one, or the pin's where the recording is carried. Undefined where BELT_CLOCK_EXPECTATIONS names other
 * summaries, or the file has no hash for the entry
 */
export function clockToRun(controls: string, name: string): string | undefined {
    if (process.env.BELT_CLOCK_EXPECTATIONS) return undefined;
    const entry = (JSON.parse(fs.readFileSync(controls, "utf8")) as ClockControls).cases[name];
    if (!entry?.recorded.clock_sha256) return undefined;
    return entry.recorded.carried ? entry.generation?.clock_sha256 : entry.recorded.clock_sha256;
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
