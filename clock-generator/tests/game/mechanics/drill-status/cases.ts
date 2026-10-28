/** One drill of probe.lua and what stops it */
export interface DrillCase {
    name: string;
    entity: "burner-mining-drill" | "electric-mining-drill" | "big-mining-drill";
    /** circuit: switched by a circuit condition; script: disabled by script; chest-full: the chest is filled and emptied; chest-room: the chest has room for `room` ore; machine: drops into a furnace that cannot craft */
    mode: "circuit" | "script" | "chest-full" | "chest-room" | "machine";
    /** circuit and script: the ticks [from, to) in which the drill is switched off */
    windows?: [number, number][];
    /** chest-full: the tick the chest is filled and the tick 100 ore are taken out of it */
    fill?: number;
    empty?: number;
    /** chest-room: the ore the chest has room for at the start */
    room?: number;
}

export interface DrillRun {
    name: string;
    ticks: number;
    scenarios: DrillCase[];
}

const DRILLS = ["burner-mining-drill", "electric-mining-drill", "big-mining-drill"] as const;
/** On at the start, off from tick 100 to 300, on for 20 ticks, off from 320 to 500, on until the end */
const WINDOWS: [number, number][] = [[100, 300], [320, 500]];

export const DRILL_RUNS: DrillRun[] = [
    {
        name: "stops", ticks: 1500, scenarios: DRILLS.flatMap(entity => {
            const short = entity.replace("-mining-drill", "");
            return [
                {name: `${short}-circuit`, entity, mode: "circuit", windows: WINDOWS},
                {name: `${short}-script`, entity, mode: "script", windows: WINDOWS},
                {name: `${short}-chest-full`, entity, mode: "chest-full", fill: 300, empty: 800},
                {name: `${short}-chest-room`, entity, mode: "chest-room", room: 2},
            ] satisfies DrillCase[];
        }),
    },
    // a big drill mines 114 ore in about 2,700 ticks: into a furnace it cannot fill past its stop
    {name: "machine", ticks: 5000, scenarios: [{name: "big-machine", entity: "big-mining-drill", mode: "machine"}]},
];
