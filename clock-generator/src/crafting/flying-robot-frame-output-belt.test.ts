import { beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../config";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { copySpacingOf, outputBeltGeometry, outputBeltProblems } from "../config/output-belt";

// The flying robot frame sample (12 copies in two rows of 6) states the output belt of its scaffold: one line a row, each with
// its own end. A row's first three copies drop on a stretch that runs to the end; the other three drop on a stretch of their
// own that side-loads onto the first from the row's other side. Every copy drops from the side onto the row's lane: the right
// lane for the upper row, the left lane for the lower row.
describe("the output belt of the flying robot frame 80 sample", () => {
    let sample: Config;
    beforeAll(async () => { sample = await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME_80); });

    const geometry = () => outputBeltGeometry(sample.output_belt!, copySpacingOf(sample.setpoint.copy_offset)!);

    it("is stated with no problem", () => {
        const outputs = sample.inserters.filter(inserter => inserter.source.type === "machine" && inserter.sink.type === "belt").length;
        expect(outputs).toBe(1);
        expect(sample.setpoint.copies).toBe(12);
        expect(outputBeltProblems(sample.output_belt!, sample.setpoint.copy_offset, outputs)).toEqual([]);
    });

    it("has two lines, each with an infinite end of its own", () => {
        expect(geometry().groups).toEqual([
            { group: 1, stretches: [1, 2], infinite_end_stretch: 1 },
            { group: 2, stretches: [3, 4], infinite_end_stretch: 3 },
        ]);
    });

    it("drops each of the 12 copies once, on the right lane of the upper row and the left lane of the lower row", () => {
        const drops = geometry().drops;
        expect(drops.map(drop => drop.copy).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        for (const drop of drops) {
            expect(drop.lane).toBe(drop.copy <= 6 ? "right" : "left");
        }
    });

    it("numbers the copies of the upper row 1 to 6 from the west and those of the lower row 7 to 12 from the east", () => {
        const copiesOn = (stretch: number) => geometry().drops.filter(drop => drop.stretch === stretch).map(drop => drop.copy);
        expect(copiesOn(1)).toEqual([1, 2, 3]);
        expect(copiesOn(2)).toEqual([4, 5, 6]);
        expect(copiesOn(3)).toEqual([12, 11, 10]);
        expect(copiesOn(4)).toEqual([9, 8, 7]);
    });

    it("puts the drops where the scaffold has them: 6 and 5 tiles apart on the first stretch, 5 and 6 on the second", () => {
        const tiles = (stretch: number) => geometry().drops.filter(drop => drop.stretch === stretch).map(drop => drop.tile);
        expect(tiles(1)).toEqual([0, 6, 11]);
        expect(tiles(2)).toEqual([0, 5, 11]);
        expect(tiles(3)).toEqual([0, 6, 11]);
        expect(tiles(4)).toEqual([0, 5, 11]);
    });

    it("side-loads the second stretch of each row onto the first, from the row's drop side onto its own lane, 21 tiles after the third copy", () => {
        const loads = geometry().side_loads;
        expect(loads.map(load => ({ sender: load.sender, stretch: load.stretch, lane: load.lane, layout: load.layout, tile: load.tile }))).toEqual([
            { sender: { stretch: 2 }, stretch: 1, lane: "right", layout: "side-straight", tile: 32 },
            { sender: { stretch: 4 }, stretch: 3, lane: "left", layout: "side-straight", tile: 32 },
        ]);
    });
});
