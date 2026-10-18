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
