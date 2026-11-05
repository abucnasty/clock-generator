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

export const RECORDINGS_DIR = path.join(__dirname, "recordings");

/** The game writes an empty list of stacks as `{}` */
export function parseRecording(text: string): DropRecording {
    const recording = JSON.parse(text) as DropRecording;
    for (const rows of Object.values(recording.runs)) for (const row of rows) if (!Array.isArray(row[3])) row[3] = [];
    return recording;
}

export function loadRecording(run: string): DropRecording {
    return parseRecording(zlib.gunzipSync(fs.readFileSync(path.join(RECORDINGS_DIR, `${run}.json.gz`))).toString("utf8"));
}
