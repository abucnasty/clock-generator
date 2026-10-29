import fs from "fs";
import path from "path";
import zlib from "zlib";

/** What probe.lua writes: the machines' facts, a row a tick for each and the result of each trial */
export interface LimitRecording {
    info: {
        scenarios: LimitScenarioInfo[];
        status: Record<string, string>;
        force: {inserter_stack_size_bonus: number; bulk_inserter_capacity_bonus: number};
    };
    columns: string[];
    runs: Record<string, number[][]>;
    trials: Record<string, Trial[]>;
    finished: boolean;
}

export interface LimitScenarioInfo {
    name: string;
    entity: string;
    inserter: string;
    ingredient: string;
    crafting_speed: number;
    speed_bonus: number;
    stack_size: number;
    inserter_pickup: string;
    inserter_drop: string;
    inactive: boolean;
    /** A machine with a recipe set: its name, craft time in seconds and ingredients */
    recipe?: string;
    energy_required?: number;
    ingredients?: {name: string; amount: number}[];
}

/** One drop attempt: the chest held n items, the machine s0 of the ingredient */
export interface Trial {
    n: number;
    s0: number;
    /** The stock set after the pickup, when the trial sets one */
    bump?: number;
    /** The most the inserter held */
    held: number;
    /** The machine's stock when the trial ended */
    after: number;
    dropped: boolean;
    /** Ticks from the setup to the end of the trial */
    ticks: number;
    /** The items still in the hand when it timed out */
    hand?: number;
}

export const RECORDINGS_DIR = path.join(__dirname, "recordings");

export function parseRecording(text: string): LimitRecording {
    return JSON.parse(text) as LimitRecording;
}

export function loadRecording(run: string): LimitRecording {
    return parseRecording(zlib.gunzipSync(fs.readFileSync(path.join(RECORDINGS_DIR, `${run}.json.gz`))).toString("utf8"));
}
