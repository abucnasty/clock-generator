import fs from "fs";
import path from "path";
import zlib from "zlib";

/** What probe.lua writes: per cell, its columns and a row a tick */
export interface LatencyRecording {
    info: {
        scenarios: {name: string; kind: string; columns: string[]; units: number[]}[];
        status: Record<string, string>;
    };
    runs: Record<string, number[][]>;
}

export const RECORDINGS_DIR = path.join(__dirname, "recordings");

export function parseRecording(text: string): LatencyRecording {
    return JSON.parse(text) as LatencyRecording;
}

export function loadRecording(name = "control-latency"): LatencyRecording {
    return parseRecording(zlib.gunzipSync(fs.readFileSync(path.join(RECORDINGS_DIR, `${name}.json.gz`))).toString("utf8"));
}

/** The rows of a cell as records keyed by column name */
export function rowsOf(recording: LatencyRecording, cell: string): Record<string, number>[] {
    const columns = recording.info.scenarios.find(scenario => scenario.name === cell)!.columns;
    return recording.runs[cell].map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

export function statusName(recording: LatencyRecording, code: number): string {
    return recording.info.status[String(code)] ?? String(code);
}
