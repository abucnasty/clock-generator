import { describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { gearRow } from "../../tests/configs/gear-row";
import { quiet } from "./generate-blueprint-test-helpers";
import { flowsAcrossCopySpacing, modelLanesOf, takenTogether } from "./shared-lane-lanes";
import { sharedLaneLayoutOf } from "./shared-lane-model";
import { sharedLanesOf } from "./checked-lanes";
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
    // the windows of the clock the generator weighs as "euclidean_swings" for each row: outputs open 1-24, inputs 29-92, in a
    // window cycle of 96 ticks for two assemblers and of 144 ticks for three; the input and output inserters of assembler k are
    // inserters 5 + 2k and 6 + 2k from 0, after the four feeders
    const windows = (machines: number) => Object.fromEntries(Array.from({ length: machines }, (_, index) => [
        [`inserter:${5 + 2 * index}`, [{ start: 29, end: 92 }]], [`inserter:${6 + 2 * index}`, [{ start: 1, end: 24 }]],
    ]).flat());
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
