import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {JammedPickupReport, replayJammedPickups} from "./jammed-pickup-replay";

interface Clip {
    name: string; item: string; belt_speed: number; stack_size: number; lane_length: number;
    lane_items: string[]; frames: [number, [number, number][], [number, number][]][];
}
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,
    "fixtures/different-items/jammed-pickup-clips.json"), "utf8")) as {seed_tick: number; last_tick: number; clips: Clip[]};

function reportOf(clip: Clip): JammedPickupReport {
    return {...clip, samples: clip.frames.map(([held, ...lanes], index) => ({
        tick: fixture.seed_tick + index, held,
        held_item: held ? clip.item : undefined,
        lanes: lanes.map((stacks, lane) => ({length: clip.lane_length,
            stacks: stacks.map(([position, count]) => ({at: position / 256, count, item: clip.lane_items[lane]}))})),
    }))};
}

for (const clip of fixture.clips) test(`experimental jammed queue matches native stock and held counts: ${clip.name}`, () => {
    const result = replayJammedPickups(reportOf(clip), fixture.seed_tick);
    expect(result.samples).toBe(fixture.last_tick - fixture.seed_tick);
    expect(result.hands).toBeGreaterThanOrEqual(4);
    expect(result.differences).toEqual([]);
});

test("retains the native normal straight-belt depletion across later hands", () => {
    const report = reportOf(fixture.clips.find(clip => clip.name === "normal-straight-belt-backed-accumulator")!);
    let first = 0, grabs: number[] = [];
    const hands: number[][] = [];
    for (let index = 1; index < report.samples.length; index++) {
        const sample = report.samples[index], previous = report.samples[index - 1];
        if (sample.held <= previous.held) continue;
        if (!previous.held) {first = sample.tick; grabs = [];}
        grabs.push(sample.tick - first);
        if (sample.held === 16) hands.push(grabs);
    }
    expect(hands).toEqual([[0, 1, 2, 3], [0, 1, 6, 14], [0, 8, 16, 24], [0, 8, 16, 24], [0, 8, 16, 24]]);
});
