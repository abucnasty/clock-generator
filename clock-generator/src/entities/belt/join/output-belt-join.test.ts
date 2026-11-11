import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { copySpacingOf, OutputBelt, outputBeltGeometry } from "../../../config/output-belt";
import { JoinModel } from "./join-model";
import { outputBeltJoinOf } from "./output-belt-join";

// The automation science 240 build's output belt, as its sample states it
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../../resources/config-samples/science/automation/automation-240.json"), "utf-8"));
const join = outputBeltJoinOf(outputBeltGeometry(sample.output_belt as OutputBelt, copySpacingOf(sample.setpoint.copy_offset)!));
const line = (id: string) => join.layout.lines.find(it => it.id === id);

/**
 * One stack put on the copy's drop tile where the game puts a hand's first stack (96 from the tile's end, one step past
 * its middle), through an empty model: the tick each line is first entered
 */
function entered(copy: number): Map<string, number> {
    const model = new JoinModel(join.layout);
    const drop = join.drops.get(copy)!;
    const [id] = model.tick({ put_ons: [{ line: drop.line, position: drop.spot - 32, time: "after-movement" }] });
    const ticks = new Map([[drop.line, 0]]);
    for (let tick = 1; tick < 900; tick++) {
        model.tick();
        const stack = model.stacks().find(it => it.id === id);
        if (stack === undefined) break;
        if (!ticks.has(stack.line)) ticks.set(stack.line, tick);
    }
    return ticks;
}

describe("the output belt as the lines of the join model", () => {
    it("lands a side load onto an underground entrance on the entrance's own line, the upstream half of its tile", () => {
        expect(line("stretch 2 left lane: the tile of the side load of stretch 1")).toEqual({ id: "stretch 2 left lane: the tile of the side load of stretch 1",
            length: 128, feeds: "stretch 2 left lane: the tile of the side load of stretch 1 (its tunnel half)" });
        expect(line("stretch 2 left lane: the tile of the side load of stretch 1 (its tunnel half)")?.length).toBe(128);
        expect(join.layout.side_loads).toContainEqual({ sender: "stretch 1 right lane: side load of copy 4 to its side load onto stretch 2",
            receiver: "stretch 2 left lane: the tile of the side load of stretch 1", lane: "upstream", entity: "underground-entrance" });
    });

    it("ends the outlet in a loader on each lane", () => {
        expect(join.outlet_lines).toEqual(["the outlet's loader, left lane", "the outlet's loader, right lane"]);
        expect(line("the outlet's loader, right lane")).toEqual({ id: "the outlet's loader, right lane", length: 128, end: "loader" });
        expect(line("stretch 4 right lane: side load of stretch 5 to the outlet")?.feeds).toBe("the outlet's loader, right lane");
    });

    it("has the side belts and the stretches side-load, and the splitter take its inputs", () => {
        expect(line("side belt of copy 4 right lane")).toEqual({ id: "side belt of copy 4 right lane", length: 551 });
        expect(join.layout.side_loads).toContainEqual({ sender: "side belt of copy 4 right lane",
            receiver: "stretch 1 right lane: side load of copy 3 to side load of copy 4", lane: "downstream", entity: "underground-exit" });
        expect(join.layout.side_loads).toContainEqual({ sender: "side belt of copy 4 left lane",
            receiver: "stretch 1 right lane: side load of copy 3 to side load of copy 4", lane: "upstream", entity: "underground-exit" });
        expect(line("the splitter's left input, left lane")).toEqual({ id: "the splitter's left input, left lane", length: 179 });
        expect(join.layout.splitters).toEqual([{ inputs: { left: ["the splitter's left input, left lane", "the splitter's left input, right lane"],
            right: ["the splitter's right input, left lane", "the splitter's right input, right lane"] },
        outputs: { left: ["the splitter's left output, left lane", "the splitter's left output, right lane"],
            right: ["the splitter's right output, left lane", "the splitter's right output, right lane"] },
        input_priority: "right", output_priority: "right" }]);
    });

    it("puts each copy's drop on the middle of its drop tile", () => {
        expect(join.drops.get(4)).toEqual({ line: "side belt of copy 4 right lane", spot: 551 - 128 });
        expect(join.drops.get(5)).toEqual({ line: "stretch 2 right lane: side load of stretch 1 to drop of copy 5", spot: 128 });
        expect(join.drops.get(9)).toEqual({ line: "stretch 3 left lane: the tile of the drop of copy 9", spot: 128 });
    });

    // The travel of the build's recordings (side belt: 13 ticks from the put-down to the landing, 2 to leave the exit's
    // line; the lane change 414 from copy 4's exit to the splitter; 120 from copy 8's; copy 9's put-down 122 to the
    // splitter; copy 5 4 ticks to leave its drop tile and 84 more to copy 6's exit), from the tiles alone
    it("gives the travel the game's recordings of the build have, from the tiles", () => {
        const copy1 = entered(1), copy4 = entered(4), copy8 = entered(8), copy9 = entered(9), copy5 = entered(5);
        expect(copy1.get("stretch 1 right lane: the tile of the side load of copy 1")).toBe(13);
        expect(copy1.get("stretch 1 right lane: side load of copy 1 to side load of copy 2")).toBe(15);
        expect(copy4.get("the splitter's right input, left lane")! - copy4.get("stretch 1 right lane: side load of copy 4 to its side load onto stretch 2")!).toBe(414);
        expect(copy8.get("the splitter's right input, right lane")! - copy8.get("stretch 2 right lane: side load of copy 8 to the splitter's right input")!).toBe(120);
        expect(copy9.get("the splitter's left input, left lane")).toBe(122);
        expect(copy5.get("stretch 2 right lane: drop of copy 5 to side load of copy 6")).toBe(4);
        expect(copy5.get("stretch 2 right lane: side load of copy 6 to side load of copy 7")! - copy5.get("stretch 2 right lane: drop of copy 5 to side load of copy 6")!).toBe(84);
    });
});
