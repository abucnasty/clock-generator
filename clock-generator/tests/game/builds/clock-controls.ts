import fs from "fs";
import path from "path";

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
