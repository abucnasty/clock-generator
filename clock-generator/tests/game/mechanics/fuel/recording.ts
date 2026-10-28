import fs from "fs";
import path from "path";
import zlib from "zlib";

/** What probe.lua writes: the scenarios' facts and a row a tick for each */
export interface FuelRecording {
    info: {
        scenarios: ScenarioInfo[];
        status: Record<string, string>;
        force: {inserter_stack_size_bonus: number; bulk_inserter_capacity_bonus: number};
        /** The largest gap between the entity's energy and its burner's heat in any tick */
        energy_gap: number;
    };
    columns: string[];
    runs: Record<string, number[][]>;
}

export interface ScenarioInfo {
    name: string;
    entity: string;
    /** The prototype's energy usage, J a tick */
    energy_usage: number;
    /** The burner's buffer, J */
    heat_capacity: number;
    effectivity: number;
    /** The fuel's value, J */
    fuel_value: number;
    stack_size: number;
    fuel_slots: number;
    crafting_speed?: number;
    mining_speed?: number;
    /** Items lying on the ground within 6 tiles of the machine at the end of the run, by name; absent when there are none */
    ground_items?: Record<string, number>;
}

export interface FuelRow {
    t: number;
    /** The burner's energy buffer, J */
    heat: number;
    /** What is left of the burning item, J */
    remaining: number;
    /** Items in the fuel slot, not counting the one burning */
    fuel_count: number;
    burning: string;
    progress: number;
    bonus: number;
    status: number;
    /** Items made, taken away or in the output (for a drill, in its chest) */
    output: number;
    finished: number;
    inserter_status: number;
    /** Items in the fuel inserter's hand */
    hand: number;
}

export const RECORDINGS_DIR = path.join(__dirname, "recordings");

export function parseRecording(text: string): FuelRecording {
    return JSON.parse(text) as FuelRecording;
}

export function loadRecording(run: string): FuelRecording {
    return parseRecording(zlib.gunzipSync(fs.readFileSync(path.join(RECORDINGS_DIR, `${run}.json.gz`))).toString("utf8"));
}

export function scenarioOf(recording: FuelRecording, name: string): ScenarioInfo {
    const found = recording.info.scenarios.find(scenario => scenario.name === name);
    if (found === undefined) throw new Error(`no scenario ${name}`);
    return found;
}

export function rowsOf(recording: FuelRecording, name: string): FuelRow[] {
    return recording.runs[name].map(values => Object.fromEntries(recording.columns.map((column, index) => [column, values[index]])) as unknown as FuelRow);
}

export function statusName(recording: FuelRecording, row: FuelRow): string {
    return recording.info.status[String(row.status)] ?? String(row.status);
}
