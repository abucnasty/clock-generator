import { describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { flowsAcrossCopySpacing, modelLanesOf, takenTogether } from "./shared-lane-lanes";
import { sharedLaneLayoutOf } from "./shared-lane-model";
import { sharedLanesOf } from "./checked-lanes";
import { assumedCopySpacings } from "./shared-lane-verdict";

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
