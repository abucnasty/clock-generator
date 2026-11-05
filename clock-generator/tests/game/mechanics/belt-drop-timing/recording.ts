import fs from "fs";
import path from "path";
import zlib from "zlib";

/** What probe.lua writes: the scenarios' facts and, for each, a row a tick */
export interface DropRecording {
    info: {
        scenarios: DropScenarioInfo[];
        status: Record<string, string>;
        force: {inserter_stack_size_bonus: number; bulk_inserter_capacity_bonus: number; belt_stack_size_bonus: number};
        research_unchanged: boolean;
        factorio: string;
        go: number;
        ticks: number;
        slots: number;
    };
    columns: string[];
    runs: Record<string, RawRow[]>;
}

/** [tick, held, status, stacks], each stack [piece * 8 + line, id, position in 1/256 tile, count * 2 + 1 for copper] */
export type RawRow = [number, number, number, number[][]];

export interface DropScenarioInfo {
    name: string;
    approach: string;
    direction: "north" | "east" | "south" | "west";
    inserter: string;
    quality: string;
    flows: boolean;
    pickup: string;
    drop_target: string;
    /** The drop position the game reports once the chest is filled, in the line's frame from the middle of slot 0: u along the travel, v to the right of it */
    drop: {u: number; v: number};
    pieces: {u: number; kind: string; io?: string; lines: number}[];
    allow_custom_vectors: boolean;
}

/**
 * What `recordings/` keeps of a run: only what the offline checks read, made from the full recording by trim-recordings.ts.
 * Per scenario: how many rows the log had, and each hand with the stacks it put down.
 */
export interface TrimmedRecording {
    info: {
        scenarios: TrimmedScenarioInfo[];
        force: {belt_stack_size_bonus: number};
        research_unchanged: boolean;
        factorio: string;
    };
    scenarios: Record<string, {rows: number; hands: TrimmedHand[]}>;
}

export type TrimmedScenarioInfo = Pick<DropScenarioInfo, "name" | "flows" | "pickup" | "drop_target" | "allow_custom_vectors"> & {drop: {u: number}};

/** `drops`: [tick, slot, line, position in 1/256 tile, count, 1 on a belt piece (whose landing has a path along the line)] */
export interface TrimmedHand {
    pickup: number;
    held: number;
    drops: [number, number, number, number, number, number][];
}

export const RECORDINGS_DIR = path.join(__dirname, "recordings");

/** The game writes an empty list of stacks as `{}` */
export function parseRecording(text: string): DropRecording {
    const recording = JSON.parse(text) as DropRecording;
    for (const rows of Object.values(recording.runs)) for (const row of rows) if (!Array.isArray(row[3])) row[3] = [];
    return recording;
}

/** A full recording, as the game wrote it (gzip or not) */
export function loadFullRecording(file: string): DropRecording {
    const bytes = fs.readFileSync(file);
    return parseRecording((file.endsWith(".gz") ? zlib.gunzipSync(bytes) : bytes).toString("utf8"));
}

/** The kept recording of a run */
export function loadRecording(run: string): TrimmedRecording {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RECORDINGS_DIR, `${run}.json.gz`))).toString("utf8")) as TrimmedRecording;
}
