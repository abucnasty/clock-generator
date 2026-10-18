import fs from "fs";
import path from "path";
import {expect, it} from "vitest";
import {advanceRightPrioritySplitter, SplitterBoundary, SplitterStack} from "./splitter-replay";

const cuts = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/splitter/right-priority-transitions.json"), "utf8")) as {
    tick: number; description: string; before: SplitterStack[][]; boundary: SplitterBoundary; after: SplitterStack[][];
}[];

for (const cut of cuts) it(`measured right-priority transition ${cut.tick}: ${cut.description}`, () => {
    const initial = structuredClone(cut.before);
    expect(advanceRightPrioritySplitter(cut.before, cut.boundary)).toEqual(cut.after);
    expect(cut.before).toEqual(initial);
});

for (const [head, landing] of [[0, 45], [19, 64], [31, 76]]) it(`preserves the measured input offset ${head}`, () => {
    const lines: SplitterStack[][] = Array.from({length: 8}, () => []);
    lines[0] = [{id: 1, position: head, item: "iron-plate", count: 4}];
    const next = advanceRightPrioritySplitter(lines, {upstream: [[], []]});
    expect(next[0]).toEqual([]);
    expect(next[6]).toEqual([{id: 1, position: landing, item: "iron-plate", count: 4}]);
});

it("waits at the measured 32-unit input boundary before routing", () => {
    const lines: SplitterStack[][] = Array.from({length: 8}, () => []);
    lines[0] = [{id: 1, position: 32, item: "iron-plate", count: 4}];
    const next = advanceRightPrioritySplitter(lines, {upstream: [[], []]});
    expect(next[0]).toEqual([{id: 1, position: 0, item: "iron-plate", count: 4}]);
    expect(next[6]).toEqual([]);
});

it("fits at output position 127 but an isolated head waits when entry would be 128", () => {
    const lines: SplitterStack[][] = Array.from({length: 8}, () => []);
    lines[0] = [{id: 1, position: 19, item: "iron-plate", count: 4}];
    lines[6] = [{id: 2, position: 95, item: "iron-plate", count: 4}];
    expect(advanceRightPrioritySplitter(lines, {upstream: [[], []]})[6].map(s => s.position)).toEqual([63, 127]);
    lines[6][0].position = 96;
    const next = advanceRightPrioritySplitter(lines, {upstream: [[], []]});
    expect(next[0][0].position).toBe(0);
    expect(next[4]).toEqual([]);
    expect(next[6].map(s => s.position)).toEqual([64]);
    expect(advanceRightPrioritySplitter(next, {upstream: [[], []]})[6].map(s => s.position)).toEqual([32, 96]);
});

it("keeps an isolated head waiting at a full preferred output instead of inventing overflow", () => {
    const lines: SplitterStack[][] = Array.from({length: 8}, () => []);
    lines[0] = [{id: 1, position: 0, item: "iron-plate", count: 4}];
    lines[6] = [0, 64].map((position, i) => ({id: i + 2, position, item: "iron-plate", count: 4}));
    expect(advanceRightPrioritySplitter(lines, {upstream: [[], []]})).toEqual(lines);
});

it("uses the measured follower window for overflow: position 95 diverts, 96 waits one tick", () => {
    const lines: SplitterStack[][] = Array.from({length: 8}, () => []);
    lines[0] = [0, 95].map((position, i) => ({id: i + 1, position, item: "iron-plate", count: 4}));
    lines[6] = [0, 64].map((position, i) => ({id: i + 3, position, item: "iron-plate", count: 4}));
    const diverted = advanceRightPrioritySplitter(lines, {upstream: [[], []]});
    expect(diverted[4]).toEqual([{id: 1, position: 76, item: "iron-plate", count: 4}]);
    expect(diverted[0]).toEqual([{id: 2, position: 63, item: "iron-plate", count: 4}]);
    lines[0][1].position = 96;
    const waiting = advanceRightPrioritySplitter(lines, {upstream: [[], []]});
    expect(waiting[4]).toEqual([]);
    expect(waiting[0].map(s => s.position)).toEqual([0, 64]);
    expect(advanceRightPrioritySplitter(waiting, {upstream: [[], []]})[4])
        .toEqual([{id: 1, position: 45, item: "iron-plate", count: 4}]);
});
