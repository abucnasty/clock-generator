import fs from "fs";
import path from "path";
import zlib from "zlib";

/** What probe.lua writes: the drills' facts and a row a tick for each */
export interface DrillRecording {
    info: {
        scenarios: DrillScenarioInfo[];
        status: Record<string, string>;
    };
    columns: string[];
    runs: Record<string, number[][]>;
}

export interface DrillScenarioInfo {
    name: string;
    entity: string;
    mode: string;
    mining_speed: number;
    /** The sink's prototype: a steel chest, or the furnace of the machine mode */
    sink: string;
    chest_slots?: number;
    /** circuit mode: whether the wire could be connected to the drill */
    wired?: boolean;
}

export interface DrillRow {
    t: number;
    status: number;
    /** The mining bar, 0 to 1 */
    progress: number;
    /** Ore in the chest, or in the furnace */
    out: number;
    /** Whether the probe's window leaves the drill switched on this tick */
    enabled: number;
}

export const RECORDINGS_DIR = path.join(__dirname, "recordings");

export function parseRecording(text: string): DrillRecording {
    return JSON.parse(text) as DrillRecording;
}

export function loadRecording(run: string): DrillRecording {
    return parseRecording(zlib.gunzipSync(fs.readFileSync(path.join(RECORDINGS_DIR, `${run}.json.gz`))).toString("utf8"));
}

export function rowsOf(recording: DrillRecording, name: string): DrillRow[] {
    return recording.runs[name].map(values => Object.fromEntries(recording.columns.map((column, index) => [column, values[index]])) as unknown as DrillRow);
}

export function statusName(recording: DrillRecording, row: DrillRow): string {
    return recording.info.status[String(row.status)] ?? String(row.status);
}

/** The ticks at which the status changes: its first tick and the status's name */
export function statusChanges(recording: DrillRecording, name: string): {t: number; status: string}[] {
    const changes: {t: number; status: string}[] = [];
    for (const row of rowsOf(recording, name)) {
        const status = statusName(recording, row);
        if (changes.length === 0 || changes[changes.length - 1].status !== status) changes.push({t: row.t, status});
    }
    return changes;
}
