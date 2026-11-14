import { describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import type { Config } from "../config/schema";
import { gearRow, gearRowEuclideanWindows } from "../../tests/configs/gear-row";
import { quiet } from "./generate-blueprint-test-helpers";
import { flowsAcrossCopySpacing, modelLanesOf, takenTogether, takerSpacingUnknown } from "./shared-lane-lanes";
import { sharedLaneLayoutOf } from "./shared-lane-model";
import { checkedLanesOf, sharedLanesOf } from "./checked-lanes";
import { assumedCopySpacings, judgeSharedLanes } from "./shared-lane-verdict";
import { clockVerdictOf, type ClockAssessment } from "./trial";

// the check of the shared lanes runs on a lane that two or more like inserters take from: those of several copies, and those
// of a build of one copy, each where its position puts it
describe("the input-lane check from the positions of the takers", () => {
    const two = automationRow({ machines: 2, pitch: 9, distinct: true });

    it("runs on a lane that two inserters of one copy take from", () => {
        expect(takenTogether(two, 1, 1)).toBe(true);
        expect(modelLanesOf(two).map(lane => `${lane.belt_id}/${lane.lane} ${lane.shared}`)).toEqual(["1/1 true", "1/2 true"]);
        expect(sharedLanesOf(two).map(lane => `${lane.belt_id}/${lane.lane} ${lane.role}`)).toEqual(["1/1 input", "1/2 input", "2/1 output"]);
    });

    it("lays the takers out where their positions put them, 9 tiles apart", () => {
        const layout = sharedLaneLayoutOf(two, modelLanesOf(two).map(lane => ({ belt_id: lane.belt_id, lane: lane.lane, flow: lane.flow!, shared: true })));
        const [first, second] = layout.rows[0].takers;
        expect(layout.rows[0].copies).toBe(1);
        expect([first.copy, second.copy]).toEqual([0, 0]);
        expect(second.edge_tiles - first.edge_tiles).toBe(9);
        expect(layout.copies.later).toEqual([]);
    });

    it("does not run on a lane that one inserter of a build of one copy takes from", () => {
        const one = automationRow({ machines: 1, pitch: 9 });
        expect(takenTogether(one, 1, 1)).toBe(false);
        expect(modelLanesOf(one)).toEqual([]);
        expect(sharedLanesOf(one)).toEqual([]);
    });

    it("runs on the lane of one inserter in each of several copies, as before", () => {
        const copies = automationRow({ machines: 1, pitch: 9, copies: 9, copy_offset: { x: 9, y: 0 } });
        expect(modelLanesOf(copies).map(lane => `${lane.belt_id}/${lane.lane} ${lane.shared}`)).toEqual(["1/1 true", "1/2 true"]);
    });

    it("places no copy after the first in a build of one copy: no copy spacing is assumed, and a stated one may run across the belt", () => {
        expect(assumedCopySpacings(two)).toEqual([]);
        expect(flowsAcrossCopySpacing({ ...two, setpoint: { ...two.setpoint, copy_offset: { x: 0, y: 9 } } })).toEqual([]);
    });
});

// A row of gear assemblers on one dead-end belt of iron plate that chest feeders keep full, with one clock, as the game's
// scaffolds hold it (tests/game/mechanics/input-lane-gap/): the second assembler's input inserter finds the gap the first one's
// hand left, and makes 5 crafts of every 6 where the clock does not fit the distance between the two. The game made 880 of
// 1,056 crafts in the window it measures (2 assemblers, 3 tiles apart; 600 of 720 for 3 assemblers, 6 tiles apart); the engine
// loses 61 of the 366 swings of the first one's run alone: the same 5 in 6. Both rows are of one copy, with no copy spacing: the
// check runs on the positions of the inserters alone. This is the pin that fails if the check is skipped for a build of one copy.
describe("the input-lane check on a row of one copy, as the game measured it", () => {
    // the windows of the clock the generator weighs as "euclidean_swings" for each row (the game test checks that it makes them)
    const windows = gearRowEuclideanWindows;
    const judged = (machines: number, pitch: number, gears_each: number, window_cycle: number) =>
        judgeSharedLanes(gearRow({ machines, pitch, items_per_second_each: gears_each }), windows(machines), window_cycle, quiet);
    const lost = (machines: number, pitch: number, gears_each: number, window_cycle: number) =>
        judged(machines, pitch, gears_each, window_cycle).losses.map(loss => `${loss.inserter_id} ${loss.item} ${loss.swings}/${loss.alone_swings} copy ${loss.copy} of ${loss.copies}`);
    /** The word for a clock that holds its output where only the lanes are judged: unstable when the lanes lose swings */
    const verdictOf = (machines: number, pitch: number, gears_each: number, window_cycle: number) =>
        clockVerdictOf({ holds: true, start_dependence: null, shared_lane_losses: judged(machines, pitch, gears_each, window_cycle).losses } as ClockAssessment);

    it("checks the one lane the inserters of the build take from, though the build is one copy", () => {
        const row = gearRow({ machines: 2, pitch: 3, items_per_second_each: 30 });
        expect(row.setpoint.copies).toBe(1);
        expect(takenTogether(row, 1, 1)).toBe(true);
        expect(modelLanesOf(row).map(lane => `${lane.belt_id}/${lane.lane} ${lane.shared}`)).toEqual(["1/1 true"]);
    });

    it("flags the second assembler's input 3 tiles from the first's, which is unstable, and not at 6 tiles", () => {
        expect(lost(2, 3, 30, 96)).toEqual(["7 iron-plate 305/366 copy 1 of 1"]);
        expect(verdictOf(2, 3, 30, 96)).toBe("unstable");
        expect(lost(2, 6, 30, 96)).toEqual([]);
        expect(verdictOf(2, 6, 30, 96)).toBe("stable");
    });

    it("flags the second assembler's input 6 tiles from the first's with three assemblers, which is unstable, and not at 9 tiles", () => {
        expect(lost(3, 6, 20, 144)).toEqual(["7 iron-plate 305/366 copy 1 of 1"]);
        expect(verdictOf(3, 6, 20, 144)).toBe("unstable");
        expect(lost(3, 9, 20, 144)).toEqual([]);
        expect(verdictOf(3, 9, 20, 144)).toBe("stable");
    });

    it("loses 1 swing in 6, as the game's second assembler makes 5 crafts in 6", () => {
        const losses = [...judged(2, 3, 30, 96).losses, ...judged(3, 6, 20, 144).losses];
        expect(losses).toHaveLength(2);
        for (const loss of losses) {
            expect([loss.alone_swings - loss.swings, loss.alone_swings]).toEqual([61, 366]);
            expect(loss.swings * 6).toBe(loss.alone_swings * 5);
        }
    });
});

/** The config with no position on the inserters that `which` selects, by their index */
const withoutPositions = (config: Config, which: (index: number) => boolean): Config =>
    ({ ...config, inserters: config.inserters.map(({ position, ...inserter }, index) => which(index) ? inserter : { ...inserter, position }) }) as Config;

/** The rows of a clock's lanes, from the judgement of the lanes as the generation makes it (no lane in the model: no run) */
const rowsOf = (config: Config) => checkedLanesOf({ config, holds: true, judged: judgeSharedLanes(config, {}, 72, quiet), window_cycle_ticks: 72, copies_trial: null, fewer: null })
    ?.rows.map(row => `${row.belt_id}/${row.lane} ${row.state.kind}${row.state.kind === "not_checked" ? ` ${row.state.reason.code}` : ""}`);

// a build of one copy whose takers of a lane do not all have positions: how far apart they stand is not known, so the lane
// is not run from positions, and its row gives the reason as a code
describe("the input-lane check of a build of one copy whose takers have no positions", () => {
    const two = automationRow({ machines: 2, pitch: 9, distinct: true });
    // the input inserters are the first of each assembler's two
    const input = (index: number) => index % 2 === 0;

    it("runs the lanes where every taker has a position", () => {
        expect(takerSpacingUnknown(two, 1, 1)).toBe(false);
        expect(modelLanesOf(two).map(lane => `${lane.belt_id}/${lane.lane} ${lane.shared}`)).toEqual(["1/1 true", "1/2 true"]);
    });

    it("does not run the lanes where no taker has a position, and gives the code on their rows", () => {
        const none = withoutPositions(two, input);
        expect(takerSpacingUnknown(none, 1, 1)).toBe(true);
        expect(modelLanesOf(none)).toEqual([]);
        expect(sharedLanesOf(none).map(lane => `${lane.belt_id}/${lane.lane}`)).toEqual(["1/1", "1/2", "2/1"]);
        expect(rowsOf(none)).toEqual(["1/1 not_checked taker_spacing_unknown", "1/2 not_checked taker_spacing_unknown", "2/1 rate_fits"]);
        const checked = checkedLanesOf({ config: none, holds: true, judged: judgeSharedLanes(none, {}, 72, quiet), window_cycle_ticks: 72, copies_trial: null, fewer: null })!;
        expect(checked.rows[0]).toMatchObject({ label: "Not checked", sentence: "Not every inserter on this lane has a position, so the distance between them is not known." });
        expect(checked.line.run_with_copies).toBe(false);
    });

    it("does not run the lanes where one taker has no position", () => {
        const mix = withoutPositions(two, index => index === 2);
        expect(takerSpacingUnknown(mix, 1, 2)).toBe(true);
        expect(modelLanesOf(mix)).toEqual([]);
        expect(rowsOf(mix)).toEqual(["1/1 not_checked taker_spacing_unknown", "1/2 not_checked taker_spacing_unknown", "2/1 rate_fits"]);
    });

    it("lays several copies out as before where their takers have no positions: a tile apart in the order of the config, the copies a copy's width apart", () => {
        const copies = withoutPositions(automationRow({ machines: 2, pitch: 9, copies: 3 }), input);
        expect(takerSpacingUnknown(copies, 1, 1)).toBe(false);
        const lanes = modelLanesOf(copies);
        expect(lanes.map(lane => `${lane.belt_id}/${lane.lane} ${lane.shared}`)).toEqual(["1/1 true", "1/2 true"]);
        const [row] = sharedLaneLayoutOf(copies, lanes.map(lane => ({ belt_id: lane.belt_id, lane: lane.lane, flow: lane.flow!, shared: true }))).rows;
        // assembling machine 3 is 3 tiles wide: the step is that width, not less than a tile for each of the two takers
        expect(row.step_tiles).toBe(3);
        expect(row.step_stated).toBe(false);
        expect(row.takers.map(taker => `${taker.copy} ${taker.edge_tiles - row.takers[0].edge_tiles}`)).toEqual(["0 0", "0 1", "1 3", "1 4", "2 6", "2 7"]);
    });
});
