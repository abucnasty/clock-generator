import { describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { quiet } from "./generate-blueprint-test-helpers";
import { copiesDisturbanceTrial, describeCopiesShort } from "./shared-lane-trial";

// nine automation science machines of one copy, 9 tiles apart on one belt; the clock of 72 ticks that the generator calls
// pitch_pickups for this build (its windows as it gives them, one output swing a window cycle): on the lanes the nine
// input inserters take from, it recovers from the first five copper plate stops and not from the sixth
describe("the trials on the lanes a build's inserters share of a clock that one trial breaks", () => {
    const config = automationRow({ machines: 9, pitch: 9 });
    const inputs = Array.from({ length: 9 }, (_, index) => [`inserter:${2 * index + 1}`, [{ start: 1, end: 24 }]] as const);
    const outputs = Array.from({ length: 9 }, (_, index) => [`inserter:${2 * index + 2}`, [{ start: 0, end: 3 }, { start: 36, end: 39 }]] as const);
    const windows = Object.fromEntries([...inputs, ...outputs]);

    it("give the trials of the loss as numbers: 5 of the 6 copper plate stops run recover, of the 16 planned; the sixth is cut at tick 18 for 466 ticks", () => {
        const verdict = copiesDisturbanceTrial({ ...config, overrides: { terminal_swing_count: 1 } }, windows, 72, 288, quiet);
        expect(verdict?.survives).toBe(false);
        expect(verdict?.trial_counts).toEqual([{ loss: { kind: "supply", items: ["copper-plate"] }, planned: 16, run: 6, recovered: 5,
            first_not_recovered: { cut_at: 18, loss_ticks: 466, until_stopped: false } }]);
        expect(verdict?.trial).toMatchObject({ cut_at: 18, loss_ticks: 466, until_stopped: false });
    });
});

describe("the sentence of a trial on the copies after which a copy is not back", () => {
    const short = [{ copy: 4, items_per_window_cycle: [96, 80] }];

    it("says that the infinite end of the output belt is shut, where the config states its output belt", () => {
        expect(describeCopiesShort({ kind: "output", item: "automation-science-pack" }, ["1/1"], 9, short, 96, true))
            .toBe("Automation science pack is not taken away at the infinite end of the output belt: the infinite end is shut, and every lane upstream "
                + "backs up from there. Then the infinite end opens again. Copy 4 from the entry ends at 96 and 80 a window cycle, where one copy makes 96.");
    });

    it("says that the copies do not have it taken away, where the config states no output belt", () => {
        expect(describeCopiesShort({ kind: "output", item: "automation-science-pack" }, ["1/1"], 9, short, 96))
            .toBe("Automation science pack is not taken away from the 9 copies, and is taken away again. "
                + "Copy 4 from the entry ends at 96 and 80 a window cycle, where one copy makes 96.");
    });
});
