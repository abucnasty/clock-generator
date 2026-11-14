import { describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { quiet } from "./generate-blueprint-test-helpers";
import { copiesDisturbanceTrial, describeCopiesShort } from "./shared-lane-trial";
import { OpenRange } from "../data-types";
import type { SkippedTrial } from "./disturbance-trial";
import { runOnSharedLanes } from "./shared-lane-model";
import { sharedLaneRunsOf } from "./shared-lane-verdict";

// nine automation science machines of one copy, 9 tiles apart on one belt; the clock of 72 ticks that the generator calls
// pitch_pickups for this build (its windows as it gives them, one output swing a window cycle): on the lanes the nine
// input inserters take from, it recovers from the first five copper plate stops and not from the sixth; of all 16, from 14
describe("the trials on the lanes a build's inserters share of a clock that one trial breaks", () => {
    const config = automationRow({ machines: 9, pitch: 9 });
    const inputs = Array.from({ length: 9 }, (_, index) => [`inserter:${2 * index + 1}`, [{ start: 1, end: 24 }]] as const);
    const outputs = Array.from({ length: 9 }, (_, index) => [`inserter:${2 * index + 2}`, [{ start: 0, end: 3 }, { start: 36, end: 39 }]] as const);
    const windows = Object.fromEntries([...inputs, ...outputs]);
    const with_swings = { ...config, overrides: { terminal_swing_count: 1 } };

    it("give the trials of the loss as numbers: every one of the 16 planned is run, 14 recover; the first not recovered from is the sixth, cut at tick 18 for 466 ticks", () => {
        const verdict = copiesDisturbanceTrial(with_swings, windows, 72, 288, quiet);
        expect(verdict?.survives).toBe(false);
        expect(verdict?.trial_counts).toEqual([{ loss: { kind: "supply", items: ["copper-plate"] }, planned: 16, run: 16, recovered: 14,
            first_not_recovered: { cut_at: 18, loss_ticks: 466, until_stopped: false } }]);
        expect(verdict?.trial).toMatchObject({ cut_at: 18, loss_ticks: 466, until_stopped: false });
    });

    it("run the trial after the one left out from the state the run was in before it: the trials before it are those of the run that stopped", () => {
        const { readings } = sharedLaneRunsOf(with_swings);
        const { under, layouts } = readings[0];
        const ranges = new Map([...inputs, ...outputs].map(([id, list]) => [id, list.map(range => OpenRange.from(range.start, range.end))] as const));
        const loss = { kind: "supply", item: "copper-plate" } as const;
        const runOf = (skipped_trials?: readonly SkippedTrial[]) => runOnSharedLanes(under, ranges, 72, layouts[0], 1, quiet, undefined,
            { loss, window_cycle_ticks: 72, expected_output_items: 288, ...(skipped_trials !== undefined && { skipped_trials }) }).disturbance_trial!;
        const first = runOf();
        const failed = first.trials[first.trials.length - 1];
        expect(failed).toMatchObject({ plan_index: 5, cut_at: 18, loss_ticks: 466, recovers: false });
        const next = runOf([{ plan_index: failed.plan_index, stopped_after_ticks: failed.stopped_after_ticks }]);
        expect(next.trials.slice(0, 5)).toEqual(first.trials.slice(0, 5));
        expect(next.trials[5].plan_index).toBe(6);
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
