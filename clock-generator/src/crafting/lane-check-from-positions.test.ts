import { describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import type { Config } from "../config/schema";
import { flowsAcrossCopySpacing, modelLanesOf, takenTogether, takerSpacingUnknown } from "./shared-lane-lanes";
import { sharedLaneLayoutOf } from "./shared-lane-model";
import { checkedLanesOf, sharedLanesOf } from "./checked-lanes";
import { assumedCopySpacings, judgeSharedLanes } from "./shared-lane-verdict";

const quiet = { log() { }, warn() { }, error() { }, debug() { } };

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
