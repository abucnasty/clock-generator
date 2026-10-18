import { expect, it } from "vitest";
import { advanceMergeStock, candidateMergeEntry, candidateTurboMergeEntry } from "./two-stream-merge-replay";

it("replays measured turbo merge entries against the preceding stock, including queued entry", () => {
    // Observed tick 23 -> 24: both streams join; the inner entry leaves a temporarily compressed follower.
    expect(candidateMergeEntry([3, 124], 67)).toBe(67);
    expect(candidateMergeEntry([3, 124], 188)).toBe(188);
    // Observed tick 29 -> 30: the inner stream joins one full spacing upstream of its free-flow entry.
    expect(candidateMergeEntry([3, 67], 67)).toBe(131);
    // Observed tick 25 -> 26: the inner queue waits; the outer stream fits beyond the trailing stock.
    expect(candidateMergeEntry([3, 67, 131], 67)).toBeUndefined();
    expect(candidateMergeEntry([3, 67, 131], 188)).toBe(195);
    // Before the first withdrawal, the outer train excludes the inner entry.
    expect(candidateMergeEntry([28, 92, 156], 67)).toBeUndefined();
    expect(candidateMergeEntry([28, 92, 156], 188)).toBe(220);
});

it("replays the measured tick 24 -> 25 follower slowdown rather than forcing every stack to move 32 units", () => {
    const stock = [35, 92, 156].map((position, id) => ({id, position}));
    expect(advanceMergeStock(stock).map(stack => stack.position)).toEqual([3, 67, 131]);
    expect(stock.map(stack => stack.position)).toEqual([35, 92, 156]);
});

it("admits the measured release-17 entry while rejecting the observed 96-unit shift", () => {
    // Tick 19 -> 20, with the release shifted to 17: the inner stack enters at 156 before movement.
    expect(candidateMergeEntry([28, 92], 67)).toBeUndefined();
    expect(candidateTurboMergeEntry([28, 92], 67)).toBe(156);
    // Release-16 tick 40 -> 41: the actual incoming queue waits rather than entering at 163.
    expect(candidateTurboMergeEntry([35, 99], 67)).toBeUndefined();
});

it("matches the calibrated turbo entry boundary at every integer shift from 89 through 96", () => {
    // Native game calibration seeds two receiving stacks, 64 units apart, with the inner lead at zero.
    for (const shift of [89, 90, 91, 92, 93, 94, 95, 96]) {
        const receiving = [shift - 61, shift + 3];
        expect(candidateTurboMergeEntry(receiving, 67)).toBe(shift === 96 ? undefined : 67 + shift);
    }
});

it("holds the calibrated compressed follower in place until forward motion can restore its gap", () => {
    // Shift-95 calibration, tick 1 -> 2: the 26-unit gap cannot grow to 64 in a single 32-unit tick.
    const compressed = [2, 66, 130, 156].map((position, id) => ({id, position}));
    const next = advanceMergeStock(compressed);
    expect(next.map(stack => stack.position)).toEqual([-30, 34, 98, 156]);
    // The next tick restores normal spacing; no stack ever travels upstream to make room.
    expect(advanceMergeStock(next).map(stack => stack.position)).toEqual([-62, 2, 66, 130]);
});

it("replays the measured stopped-outlet tail instead of advancing through the closed belt end", () => {
    // Outlet removal, tick 125 -> 126: the tail reaches -768 and compresses its downstream queue.
    const stock = [-765, -701, -637, -573, -445].map((position, id) => ({id, position}));
    expect(advanceMergeStock(stock, 32, -768, true).map(stack => stack.position))
        .toEqual([-768, -704, -640, -576, -477]);
    // Restoring the outlet, tick 188 -> 189: the end stack leaves and its follower can move freely.
    const stopped = [-768, -704, -640].map((position, id) => ({id, position}));
    expect(advanceMergeStock(stopped, 32, -768).map(stack => stack.position)).toEqual([-736, -672]);
});


it("preserves the two measured express counterexamples to the turbo entry hypothesis", () => {
    // Tick 18 -> 19: the actual inner stack enters at pre-movement position 139, then moves 24 to 115.
    const observedEntry = 115 + 24;
    expect(observedEntry - 67).toBe(72);
    expect(candidateMergeEntry([11, 75], 67)).toBeUndefined(); // candidate rejects an observed transfer
    // Tick 26 -> 27: the candidate admits entry 67 beside a follower at 68, but the actual queue waits.
    expect(candidateMergeEntry([3, 68, 132], 67)).toBe(67);
});
