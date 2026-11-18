import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { copySpacingOf, OutputBelt, outputBeltGeometry } from "../../../config/output-belt";
import { JoinModel } from "./join-model";
import { dropSpotOn } from "./join-rules";
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

    it("ends the infinite end in a loader on each lane", () => {
        expect(join.infinite_end_lines).toEqual(["the infinite end's loader, left lane", "the infinite end's loader, right lane"]);
        expect(line("the infinite end's loader, right lane")).toEqual({ id: "the infinite end's loader, right lane", length: 128, end: "loader" });
        expect(line("stretch 4 right lane: side load of stretch 5 to the infinite end")?.feeds).toBe("the infinite end's loader, right lane");
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

describe("an output belt with a splitter that one stretch feeds", () => {
    // The logistic science 240 build's line as stated for its scaffold: stretch 6 ends in the splitter's right input, no
    // stretch in its left input, and its two outputs side-load back onto the line before the infinite end
    const exit = { lane: "right" as const, layout: "side-exit" as const };
    const belt: OutputBelt = {
        stretches: [
            { points: [{ drop: 1, lane: "right" }, { tiles: 6, drop: 2, lane: "right" }, { tiles: 6, drop: 3, lane: "right" },
                { tiles: 3, left_curves: 1, right_curves: 1, side_load: { stretch: 2 }, lane: "right", layout: "side-entrance" }, { tiles: 13, right_curves: 1 }] },
            { points: [{ drop: 5, lane: "left" }, { tiles: 6, drop: 4, lane: "left" }, { tiles: 5, right_curves: 1 }] },
            { points: [{ side_load: { stretch: 1 }, lane: "left", layout: "side-straight" },
                { tiles: 23, left_curves: 1, right_curves: 1, side_load: { stretch: 4 }, ...exit }, { tiles: 12, side_load: { stretch: 5 }, ...exit },
                { tiles: 8, side_load: { stretch: 7 }, ...exit }, { tiles: 1, side_load: { stretch: 8 }, lane: "left", layout: "side-entrance" },
                { tiles: 6, lane_end: { kind: "infinite" } }] },
            { points: [{ drop: 6, lane: "right" }, { tiles: 6, drop: 7, lane: "right" }, { tiles: 6, drop: 8, lane: "right" }, { tiles: 5, left_curves: 1 }] },
            { points: [{ drop: 9, lane: "right" }, { tiles: 6, drop: 10, lane: "right" }, { tiles: 5, left_curves: 1 }] },
            { points: [{ drop: 11, lane: "right" }, { tiles: 4, splitter_input: "right" }] },
            { points: [{ splitter_output: "right" }, { tiles: 3, left_curves: 1 }] },
            { points: [{ splitter_output: "left" }, { tiles: 5, left_curves: 1, right_curves: 2 }] },
        ],
        splitter: { input_priority: "right", output_priority: "right" },
    };
    const one_input = outputBeltJoinOf(outputBeltGeometry(belt, 0));

    it("takes a stack from every drop through to the infinite end, those of the splitter's one input through the splitter", () => {
        for (const number of [1, 4, 6, 9, 11]) {
            const model = new JoinModel(one_input.layout);
            const drop = one_input.drops.get(number)!;
            const [id] = model.tick({ put_ons: [{ line: drop.line, position: drop.spot - 32, time: "after-movement" }] });
            const lines = new Set<string>();
            for (let tick = 0; tick < 2000 && model.stacks().some(it => it.id === id); tick++) {
                lines.add(model.stacks().find(it => it.id === id)!.line);
                model.tick();
            }
            expect(model.stacks(), `the stack of output ${number}`).toEqual([]);
            expect([...lines].some(line => line.startsWith("the infinite end's loader")), `the stack of output ${number}`).toBe(true);
            if (number === 11) expect([...lines].some(line => line.startsWith("the splitter's right input"))).toBe(true);
        }
    });
});

describe("an output belt of several lines, with a side belt of its own for some output inserters", () => {
    // Two lines, each with its own infinite end: line 1 takes a drop of output 1 and a side load of output 3, line 2 a
    // drop of output 2 and a side load of output 4; output 4's side belt is longer and turns
    const belt: OutputBelt = {
        side_belt: { lane: "right", tiles: 2 },
        side_belts: [{ outputs: [4], lane: "left", tiles: 4, right_curves: 1 }],
        stretch_groups: [[1], [2]],
        stretches: [
            { points: [{ drop: 1, lane: "right" }, { tiles: 4, side_load: [3], lane: "right", layout: "side-straight" }, { tiles: 3, lane_end: { kind: "infinite" } }] },
            { points: [{ drop: 2, lane: "left" }, { tiles: 4, side_load: [4], lane: "left", layout: "side-straight" }, { tiles: 3, lane_end: { kind: "infinite" } }] },
        ],
    };
    const two = outputBeltJoinOf(outputBeltGeometry(belt, 0));
    const of = (id: string) => two.layout.lines.find(it => it.id === id);

    it("ends each line in a loader of its own, named by the stretch it ends", () => {
        expect(two.infinite_end_lines).toEqual(["the infinite end's loader of stretch 1, left lane", "the infinite end's loader of stretch 1, right lane",
            "the infinite end's loader of stretch 2, left lane", "the infinite end's loader of stretch 2, right lane"]);
        expect(of("stretch 1 right lane: side load of copy 3 to the infinite end")?.feeds).toBe("the infinite end's loader of stretch 1, right lane");
        expect(of("stretch 2 left lane: side load of copy 4 to the infinite end")?.feeds).toBe("the infinite end's loader of stretch 2, left lane");
        expect(new JoinModel(two.layout).stacks()).toEqual([]);
    });

    it("puts each side-loaded output's drop on the middle of the first tile of its own side belt, on its own lane", () => {
        expect(of("side belt of copy 3 right lane")?.length).toBe(512);
        expect(two.drops.get(3)).toEqual({ line: "side belt of copy 3 right lane", spot: 512 - 128 });
        // a drop tile, two straight tiles and a right curve, whose left lane is its outer one
        expect(of("side belt of copy 4 left lane")?.length).toBe(3 * 256 + 295);
        expect(two.drops.get(4)).toEqual({ line: "side belt of copy 4 left lane", spot: 3 * 256 + 295 - 128 });
    });

    it("keeps the stacks of one line off the other", () => {
        const model = new JoinModel(two.layout);
        const drop = two.drops.get(2)!;
        const [id] = model.tick({ put_ons: [{ line: drop.line, position: drop.spot - 32, time: "after-movement" }] });
        const lines = new Set<string>();
        for (let tick = 0; tick < 300; tick++) {
            model.tick();
            const stack = model.stacks().find(it => it.id === id);
            if (stack === undefined) break;
            lines.add(stack.line);
        }
        expect([...lines].every(line => line.startsWith("stretch 2 ") || line.includes("of stretch 2"))).toBe(true);
        expect(model.stacks()).toEqual([]);
    });
});

// The lithium plate build's rows (Factorio 2.1.24, filled-start search 5's lane recording): the first furnace's output inserter
// drops in line onto an underground entrance from downstream of it, its stacks seen at 19 and 83 on the entrance's own half (179 - 32
// and 179 + 32 from the tile's end, 128 more than on the half); the second's onto an exit from upstream of it, at 45, 77 and 109
// (77 and a step either side); the third's from upstream onto the entrance of its side belt, an underground pair, as on a straight
// side belt's drop tile: the first stack 32 past the entrance's own half
describe("a drop onto an underground end", () => {
    it("lands past the tile's middle, on the far side from an inserter in line with the belt, and on the end's own half", () => {
        expect(dropSpotOn({ end: "entrance", inserter: "downstream" })).toBe(179);
        expect(dropSpotOn({ end: "exit", inserter: "upstream" })).toBe(77);
        expect(dropSpotOn({ end: "entrance", inserter: "upstream" })).toBe(128);
        expect(dropSpotOn({ end: "exit", inserter: "downstream" })).toBe(128);
        expect(dropSpotOn({ end: "entrance", inserter: "beside" })).toBe(128);
    });

    it("puts the drop's spot on the line of its tile, and a drop onto a straight belt on the tile's middle", () => {
        const belt: OutputBelt = {
            stretches: [{ points: [
                { drop: 1, lane: "right", drop_tile: { end: "entrance", inserter: "downstream" } },
                { tiles: 10, drop: 2, lane: "right", drop_tile: { end: "exit", inserter: "upstream" } },
                { tiles: 2, drop: 3, lane: "right" },
                { tiles: 3, lane_end: { kind: "infinite" } },
            ] }],
        };
        const drops = outputBeltJoinOf(outputBeltGeometry(belt, 0)).drops;
        expect([1, 2, 3].map(copy => drops.get(copy)!.spot)).toEqual([179, 77, 128]);
    });
});
