import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {assessSameItemPickups, SameItemPickupProbe} from "./same-item-pickup-probe";

type NativeStack = [id: number, position: number, count: number];
type Frame = [tick: number, held: number, handX: number, handY: number, near: NativeStack[], far: NativeStack[]];
interface Clip {release_delay: number; first_grab: number; frames: Frame[]}
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,
    "fixtures/different-items/arm-travel-clips.json"), "utf8")) as {
    endpoint: string; stack_size: number; item: string; lane_length: number; clips: Clip[];
};

function reportOf(clip: Clip): SameItemPickupProbe {
    return {...fixture, samples: clip.frames.map(([tick, held, , , ...lanes]) => ({
        tick, held, held_item: held ? fixture.item : undefined,
        lanes: lanes.map(stacks => ({length: fixture.lane_length,
            stacks: stacks.map(([, position, count]) => ({at: position / 256, count, item: fixture.item}))})),
    }))};
}

// The stock-only reference preserves why availability alone misses arm travel. Production coverage lives in
// src/state/belt-pickup-arm.test.ts and predicts the native held quantities and lane stock.
for (const clip of fixture.clips) test(`stock-only reference for native normal entrance arm travel after release delay ${clip.release_delay}`, () => {
    const assessment = assessSameItemPickups(reportOf(clip), 1, 1, 65);
    expect(assessment.hands).toBe(1);
    if (clip.release_delay === 4) {
        expect([...assessment.hand_patterns]).toEqual(["0,1,2,3"]);
        expect(assessment.differences).toEqual([]);
        return;
    }
    expect(assessment.differences).toEqual([{tick: clip.first_grab,
        actual: [0, 1, 3, 4], predicted: [0, 1, 2, 3], lane_mismatches: 2}]);
    const nearGrab = clip.frames.find(frame => frame[0] === clip.first_grab + 1)!;
    const traveling = clip.frames.find(frame => frame[0] === clip.first_grab + 2)!;
    const farGrab = clip.frames.find(frame => frame[0] === clip.first_grab + 3)!;
    expect([nearGrab[1], traveling[1], farGrab[1]]).toEqual([8, 8, 12]);
    expect(traveling[3]).toBeGreaterThan(nearGrab[3]);
    expect(traveling[3]).toBeLessThan(farGrab[3]);
    // The same native stack is already inside pickup reach before the arm arrives on the far lane.
    const consumed = traveling[5].find(([id]) => !farGrab[5].some(stack => stack[0] === id))!;
    expect(consumed).toBeDefined();
    expect(nearGrab[5].some(([id]) => id === consumed[0])).toBe(true);
    expect(consumed[1]).toBeGreaterThanOrEqual(0);
    expect(consumed[1]).toBeLessThan(fixture.lane_length * 256);
    expect(consumed[2]).toBe(4);
});
