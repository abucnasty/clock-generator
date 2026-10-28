import fs from "fs";
import path from "path";
import zlib from "zlib";

/** What probe.lua writes: the scenarios' facts and a row a tick for each */
export interface LaneRecording {
    info: {
        scenarios: LaneScenarioInfo[];
        status: Record<string, string>;
        force: {inserter_stack_size_bonus: number; bulk_inserter_capacity_bonus: number; belt_stack_size_bonus: number};
    };
    columns: string[];
    runs: Record<string, number[][]>;
}

export interface LaneScenarioInfo {
    name: string;
    direction: "north" | "east" | "south" | "west";
    side: "left" | "right" | "back" | "front";
    inserter: string;
    item: string;
    pickup: string;
    drop_target: string;
    /** The drop position the game reports a few ticks in, in the belt's frame from the middle of tile 0: u along the travel, v to the right of it */
    drop: {u: number; v: number};
    /** The prototype's allow_custom_vectors: false for both inserters, so a drop position cannot be named */
    allow_custom_vectors: boolean;
}

export interface LaneRow {
    t: number;
    /** Items on the left lane of the six belt tiles (in the direction of travel) */
    left: number;
    /** Items on the right lane */
    right: number;
    hand: number;
    inserter_status: number;
}

export const RECORDINGS_DIR = path.join(__dirname, "recordings");

export function parseRecording(text: string): LaneRecording {
    return JSON.parse(text) as LaneRecording;
}

export function loadRecording(run: string): LaneRecording {
    return parseRecording(zlib.gunzipSync(fs.readFileSync(path.join(RECORDINGS_DIR, `${run}.json.gz`))).toString("utf8"));
}

export function rowsOf(recording: LaneRecording, name: string): LaneRow[] {
    return recording.runs[name].map(values => Object.fromEntries(recording.columns.map((column, index) => [column, values[index]])) as unknown as LaneRow);
}
