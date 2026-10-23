import fs from "fs";
import path from "path";
import {createHash} from "crypto";
import {clockIdentity} from "../../../src/crafting/clock-identity";

/**
 * Where a control came from: the PR that recorded it in the game (or pinned it), the commit that added it, and the
 * frozen engine head its clock was generated and recorded on (null where there is no native recording or the run was
 * on an uncommitted tree)
 */
export interface Recorded {
    pr: number;
    commit: string;
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
     * regenerated on the engine of the recording's commit; or `built`: the clock is one the owner built (a build's own clock,
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

/** The selection the generator makes, pinned by a portable generation test, with the sha256 of its exported clock */
export interface GenerationPin {
    period: number;
    expected: number;
    verdict: string;
    selection: {id: string; holds: boolean; rate: number; supply: string | null};
    clock_sha256: string;
    /** The cause the generation gives of why its selection does not meet goal 1 (see whyNotStable); absent where it does */
    why_not_stable?: string;
}

/** One configuration of a family: its current recording and, where a generation test pins it, the selection */
export interface ClockControl {
    recorded: Recorded;
    native: NativeClockSummary;
    generation?: GenerationPin;
}

/** A family's controls file: one current entry per configuration */
export interface ClockControls {
    meaning: string;
    cases: Record<string, ClockControl>;
}

/** A family's history file: the recordings a later PR replaced, per configuration, oldest first */
export interface ClockHistory {
    meaning: string;
    cases: Record<string, {recorded: Recorded; native: NativeClockSummary}[]>;
}

/** Reads a controls file of tests/game/builds/ by its name */
export function readControls<T = ClockControls>(file: string): T {
    return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8")) as T;
}

/**
 * The native summary a capture of `name` is compared with: the current one in the family file `controls` (a path), or
 * the one BELT_CLOCK_EXPECTATIONS names: a family file, or a history file and the PR of the recording, `<file>#<pr>`.
 */
export function expectedNativeSummary(controls: string, name: string): NativeClockSummary | undefined {
    const [file, pr] = (process.env.BELT_CLOCK_EXPECTATIONS ? path.resolve(process.env.BELT_CLOCK_EXPECTATIONS) : controls).split("#");
    const read = JSON.parse(fs.readFileSync(file, "utf8")) as ClockControls | ClockHistory;
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
 * `native` summary has the hash of the clock it was recorded on, and it is the hash of its pin unless `carried` says
 * why not. `untied` names the entries still without a hash (they may only be removed from the list).
 */
export function pinMismatches(cases: Record<string, ClockControl>, untied: readonly string[] = [], built: Record<string, string> = {}): string[] {
    const found: string[] = [];
    const hash = /^[0-9a-f]{64}$/;
    for (const [name, control] of Object.entries(cases)) {
        const {recorded, generation} = control;
        if (name in built) {
            // an owner's built clock is no selection and has no pin: the recording names the clock it ran, and it has to be
            // the clock of the blueprint the test builds
            if (recorded.clock_basis !== "built") found.push(`${name}: is named as a clock the owner built and its recorded.clock_basis is not "built"`);
            if (generation) found.push(`${name}: a clock the owner built is no selection and has no generation pin`);
            if (recorded.carried !== undefined) found.push(`${name}: a clock the owner built has no pin to carry`);
            if (!recorded.clock_sha256 || !hash.test(recorded.clock_sha256)) found.push(`${name}: recorded.clock_sha256 is missing: it is the identity of the clock the owner built`);
            else if (recorded.clock_sha256 !== built[name]) {
                found.push(`${name}: the owner's clock in the blueprint is ${built[name].slice(0, 12)} and the native summary was recorded on ${recorded.clock_sha256.slice(0, 12)}: record it again in the game`);
            }
            continue;
        }
        if (recorded.clock_basis === "built") {
            found.push(`${name}: recorded.clock_basis is "built" and the entry is not named as a clock the owner built`);
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
        if (control.native.expected !== generation.expected || control.native.period !== generation.period) {
            found.push(`${name}: the native summary (period ${control.native.period}, expected ${control.native.expected}) and the pin (${generation.period}, ${generation.expected}) are of different clocks`);
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
