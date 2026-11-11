import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";
import { ConfigPaths } from "./config-paths";
import { OutputBelt, outputBeltGeometry, streamPhase } from "./output-belt";

/**
 * The output belt of the automation science build of nine copies, as its scaffold has it (read in the game, Factorio
 * 2.1.24, by the API reads of each belt piece). Copies 1 to 4 side-load onto the exits of stretch 1, which side-loads
 * onto the entrance at the start of stretch 2 (the lane change). Copy 5 drops onto stretch 2, copies 6 to 8 side-load
 * onto its exits, and it ends in the splitter's right input. Copy 9 drops at the start of stretch 3, which ends in the
 * splitter's left input. The splitter's right output (stretch 4) runs to the outlet; its left output (stretch 5) turns
 * back with five left curves and side-loads onto the first tile of stretch 4.
 */
const SAMPLE_BELT: OutputBelt = {
    side_belt: { lane: "right", tiles: 2, left_curves: 1 },
    stretches: [
        { points: [{ side_load: [1, 2, 3, 4], lane: "right", layout: "side-exit" }, { tiles: 2, right_curves: 1 }] },
        { points: [
            { side_load: { stretch: 1 }, lane: "left", layout: "side-entrance" },
            { tiles: 7, drop: 5, lane: "right" },
            { tiles: 11, left_curves: 1, right_curves: 1, side_load: [6, 7, 8], lane: "right", layout: "side-exit" },
            { tiles: 16, splitter_input: "right" },
        ] },
        { points: [{ drop: 9, lane: "left" }, { tiles: 16, left_curves: 1, right_curves: 3, splitter_input: "left" }] },
        { points: [
            { splitter_output: "right" },
            { tiles: 1, side_load: { stretch: 5 }, lane: "right", layout: "side-straight" },
            { tiles: 2, lane_end: { kind: "outlet" } },
        ] },
        { points: [{ splitter_output: "left" }, { tiles: 12, left_curves: 5 }] },
    ],
    splitter: { input_priority: "right", output_priority: "right" },
};

const sampleText = () => JSON.parse(readFileSync(ConfigPaths.AUTOMATION_SCIENCE_240, "utf8"));
const withoutBelt = () => {
    const config = sampleText();
    delete config.output_belt;
    return config;
};
/** The sample's config with `output_belt` replaced */
const withBelt = (belt: unknown) => ({ ...withoutBelt(), output_belt: belt });
const copyOf = (): OutputBelt => structuredClone(SAMPLE_BELT);
/** The messages the schema gives for a config with this output belt */
const problems = (belt: unknown, change?: (config: ReturnType<typeof withBelt>) => void): string[] => {
    const config = withBelt(belt);
    change?.(config);
    const result = ConfigSchema.safeParse(config);
    return result.success ? [] : result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`);
};

describe("the output belt section of a config", () => {
    it("is optional: a config without it parses as before, with no output_belt", () => {
        const parsed = ConfigSchema.parse(withoutBelt());
        expect("output_belt" in parsed).toBe(false);
        const logistic = ConfigSchema.parse(JSON.parse(readFileSync(ConfigPaths.LOGISTIC_SCIENCE_240, "utf8")));
        expect("output_belt" in logistic).toBe(false);
    });

    it("is read as it is stated: no default or change is added", () => {
        expect(problems(SAMPLE_BELT)).toEqual([]);
        expect(ConfigSchema.parse(withBelt(SAMPLE_BELT)).output_belt).toEqual(SAMPLE_BELT);
    });

    it("is stated by the automation science sample of 240 a second, as its scaffold has it", () => {
        expect(sampleText().output_belt).toEqual(SAMPLE_BELT);
    });

    it("refuses a key it does not know, at any level", () => {
        expect(problems({ ...copyOf(), onto: 1 })).toEqual(['output_belt: Unrecognized key: "onto"']);
        const belt = copyOf();
        (belt.stretches[0].points[1] as Record<string, unknown>).onto = { stretch: 2 };
        expect(problems(belt)).toEqual(['output_belt.stretches.0.points.1: Unrecognized key: "onto"']);
        const entry = copyOf();
        (entry.stretches[2].points as unknown[]).unshift({ entry: {} });
        expect(problems(entry)).toEqual(['output_belt.stretches.2.points.0: Unrecognized key: "entry"']);
    });
});

describe("the refusals of an output belt that the generator does not model", () => {
    it("refuses a splitter with no priority, or with \"none\"", () => {
        const none = copyOf();
        (none.splitter as Record<string, unknown>).input_priority = "none";
        expect(problems(none)).toEqual(["output_belt.splitter.input_priority: State the splitter's input priority as \"left\" or \"right\", "
            + "as it is set in the game. The generator does not model a splitter without a priority (\"none\")."]);
        const missing = copyOf();
        delete (missing.splitter as Record<string, unknown>).output_priority;
        expect(problems(missing)).toEqual(["output_belt.splitter.output_priority: State the splitter's output priority as \"left\" or \"right\", "
            + "as it is set in the game. The generator does not model a splitter without a priority (\"none\")."]);
    });

    it("refuses a stretch that starts with nothing that feeds it", () => {
        const belt = copyOf();
        belt.stretches[2].points = [{}, { tiles: 3, drop: 9, lane: "left" }, { tiles: 13, left_curves: 1, right_curves: 3, splitter_input: "left" }];
        expect(problems(belt)).toEqual(["output_belt.stretches.2.points.0: Stretch 3 starts with nothing that feeds it. "
            + "Its first point must be where items come onto it: a copy's drop (`drop`), a side load (`side_load`) or a splitter output "
            + "(`splitter_output`). The generator does not model a belt that comes onto the output belt from outside the build."]);
    });

    it("refuses an output belt with no outlet or with two", () => {
        const none = copyOf();
        none.stretches[3].points[2] = { tiles: 2 };
        expect(problems(none)).toEqual([
            "output_belt.stretches.3.points.2: The last point of stretch 4 holds only its run, but no `side_load` names stretch 4. "
                + "State where its items go: `side_load: {\"stretch\": 4}` at the point that takes them, `splitter_input`, or the outlet.",
            "output_belt: The output belt states no outlet. "
                + "State exactly one: `lane_end: {\"kind\": \"outlet\"}` on the last point of the stretch whose items leave the build.",
        ]);
        const two = copyOf();
        two.stretches[4].points[1] = { tiles: 12, left_curves: 5, lane_end: { kind: "outlet" } };
        two.stretches[3].points[1] = { tiles: 1 };
        expect(problems(two)).toEqual(["output_belt: The output belt states 2 outlets. "
            + "State exactly one: `lane_end: {\"kind\": \"outlet\"}` on the last point of the stretch whose items leave the build."]);
    });

    it("refuses two side belts onto one tile", () => {
        expect(problems(copyOf(), config => { config.setpoint.copy_offset = { x: 0, y: 0 }; })).toEqual([
            "output_belt.stretches.0.points.0: Stretch 1 takes 4 side loads on one tile (the side belts of copies 1, 2, 3 and 4). "
                + "The generator does not model a tile that takes two side loads. State each side load at a tile of its own, "
                + "and the distance between the copies in `setpoint.copy_offset`.",
            "output_belt.stretches.1.points.2: Stretch 2 takes 3 side loads on one tile (the side belts of copies 6, 7 and 8). "
                + "The generator does not model a tile that takes two side loads. State each side load at a tile of its own, "
                + "and the distance between the copies in `setpoint.copy_offset`.",
        ]);
    });

    describe("refuses a side load onto the lane that an underground's hood shuts", () => {
        // measured in the game: the side belt from the right onto an exit (the sample's copies) and the lane change from
        // the left onto an entrance (the sample); from the left onto an exit and from the right onto an entrance (two
        // test scaffolds, Factorio 2.1.24): an exit passes the sender's lane on the side the stream comes from, an
        // entrance the other one
        it("on an exit from the right: the side belt's right lane passes, its left lane is shut", () => {
            const belt = copyOf();
            belt.side_belt!.lane = "left";
            expect(problems(belt)).toEqual([
                "output_belt.stretches.0.points.0: The side belts of copies 1, 2, 3 and 4 side-load their left lane onto an underground exit "
                    + "(side-exit) from the right of stretch 1, and the exit's hood shuts that lane: its items stop there. On an exit, only "
                    + "the right lane passes from the right. State the lane that the items move on, or the layout of the tile that takes them.",
                "output_belt.stretches.1.points.2: The side belts of copies 6, 7 and 8 side-load their left lane onto an underground exit "
                    + "(side-exit) from the right of stretch 2, and the exit's hood shuts that lane: its items stop there. On an exit, only "
                    + "the right lane passes from the right. State the lane that the items move on, or the layout of the tile that takes them.",
            ]);
        });

        it("on an exit from the left: the side belt's left lane passes; on an entrance from the right: the sender's left lane passes", () => {
            const belt = copyOf();
            belt.side_belt!.lane = "left";
            belt.stretches[0].points[0].lane = "left";
            belt.stretches[1].points[2].lane = "left";
            belt.stretches[1].points[0].lane = "right";
            expect(outputBeltGeometry(belt, 9).stretches[0].carried).toEqual(["left"]);
            expect(problems(belt)).toEqual([]);
        });

        it("on an entrance from the left: the sender's right lane passes, its left lane is shut", () => {
            const belt = copyOf();
            belt.side_belt!.lane = "left";
            belt.stretches[0].points[0].lane = "left";
            belt.stretches[1].points[2].lane = "left";
            expect(problems(belt)).toEqual(["output_belt.stretches.1.points.0: Stretch 1 side-loads its left lane onto an underground "
                + "entrance (side-entrance) from the left of stretch 2, and the entrance's hood shuts that lane: its items stop there. "
                + "On an entrance, only the right lane passes from the left. State the lane that the items move on, or the layout of the "
                + "tile that takes them."]);
        });

        it("on an entrance from the right: the sender's left lane passes, its right lane is shut", () => {
            const belt = copyOf();
            belt.stretches[1].points[0].lane = "right";
            expect(problems(belt)).toEqual(["output_belt.stretches.1.points.0: Stretch 1 side-loads its right lane onto an underground "
                + "entrance (side-entrance) from the right of stretch 2, and the entrance's hood shuts that lane: its items stop there. "
                + "On an entrance, only the left lane passes from the right. State the lane that the items move on, or the layout of the "
                + "tile that takes them."]);
        });

        it("on a straight belt: both lanes pass, onto the lane on the side they come from", () => {
            const geometry = outputBeltGeometry(SAMPLE_BELT, 9);
            const loop = geometry.side_loads.find(load => "stretch" in load.sender && load.sender.stretch === 5)!;
            expect(loop.lanes).toEqual([
                { sender_lane: "left", passes: true, side_load_point: 188 },
                { sender_lane: "right", passes: true, side_load_point: 67 },
            ]);
        });
    });

    it("refuses a last point that holds only its run when no side load names its stretch", () => {
        const belt = copyOf();
        belt.stretches[3].points[1] = { tiles: 1 };
        expect(problems(belt)).toEqual(["output_belt.stretches.4.points.1: The last point of stretch 5 holds only its run, but no "
            + "`side_load` names stretch 5. State where its items go: `side_load: {\"stretch\": 5}` at the point that takes them, "
            + "`splitter_input`, or the outlet."]);
    });
});

describe("the shape checks the derivation needs", () => {
    it("asks for the steps of each point after the first, and none on the first", () => {
        const belt = copyOf();
        delete belt.stretches[1].points[1].tiles;
        belt.stretches[2].points[0].tiles = 1;
        expect(problems(belt)).toEqual([
            "output_belt.stretches.1.points.1: State `tiles` on this point: the steps from the previous point, as the sidecar's walk counts them.",
            "output_belt.stretches.2.points.0: The first point of a stretch is where it starts: state `tiles` and curves on the later points only.",
        ]);
    });

    it("asks for one thing a point, with its lane and layout", () => {
        const belt = copyOf();
        belt.stretches[1].points[1] = { tiles: 7, drop: 5 };
        belt.stretches[1].points[2].layout = undefined;
        delete belt.stretches[1].points[2].layout;
        belt.stretches[3].points[2] = { tiles: 2, lane_end: { kind: "outlet" }, drop: 5, lane: "left" };
        expect(problems(belt)).toEqual([
            "output_belt.stretches.1.points.1: State the `lane` that takes the drop or the side load: \"left\" or \"right\" in the direction of travel.",
            "output_belt.stretches.1.points.2: State the `layout` of the tile that takes the side load: side-straight, side-entrance or side-exit.",
            "output_belt.stretches.3.points.2: A point states one of `side_load`, `drop`, `splitter_input`, `splitter_output` and `lane_end`; "
                + "this one states drop and lane_end. State the others at points of their own.",
        ]);
    });

    it("asks for no more curves than a run has tiles before its point, and for the stretch a side load names", () => {
        const belt = copyOf();
        belt.stretches[0].points[1] = { tiles: 2, right_curves: 2 };
        belt.stretches[1].points[0] = { side_load: { stretch: 7 }, lane: "left", layout: "side-entrance" };
        expect(problems(belt)).toEqual([
            "output_belt.stretches.0.points.1: This run holds 2 curves in 1 tile before its point; a curve takes a tile of its own.",
            "output_belt.stretches.1.points.0: `side_load` names stretch 7, which is not in `stretches` (1 to 5), or this stretch itself.",
            "output_belt.stretches.0.points.1: The last point of stretch 1 holds only its run, but no `side_load` names stretch 1. "
                + "State where its items go: `side_load: {\"stretch\": 1}` at the point that takes them, `splitter_input`, or the outlet.",
        ]);
    });

    it("asks for the copy spacing where a side load lists two copies or more, and for the side belt", () => {
        expect(problems(copyOf(), config => { delete config.setpoint.copy_offset; })).toContain(
            "output_belt.stretches.0.points.0: State `setpoint.copy_offset` in whole tiles: the side loads of a list stand that far apart along the stretch.");
        const belt = copyOf();
        delete belt.side_belt;
        expect(problems(belt)).toEqual(["output_belt: State `side_belt`: the belt that each copy's output inserter drops on, up to its side load."]);
        const unordered = copyOf();
        unordered.stretches[0].points[0].side_load = [1, 3, 2, 4];
        expect(problems(unordered)).toEqual(["output_belt.stretches.0.points.0: List the copies of a side load in the order they stand along "
            + "the stretch, upstream first, each once."]);
    });

    it("asks for a splitter with each input and output side once", () => {
        const belt = copyOf();
        delete belt.splitter;
        expect(problems(belt)).toEqual(["output_belt: State `splitter` with its `input_priority` and `output_priority`: stretches 2 and 3 "
            + "end at its inputs, and stretches 4 and 5 start at its outputs."]);
        const twice = copyOf();
        twice.stretches[2].points[1].splitter_input = "right";
        expect(problems(twice)).toEqual(["output_belt.stretches.2.points.1: The splitter's right input is stated twice (stretches 2 and 3). "
            + "State one stretch for each input and each output."]);
    });
});

/**
 * The derived output belt of the sample. Lengths in 1/256 tile, as the game has them: a straight tile 256, a curve 295 on
 * its outer lane and 106 on its inner lane, an underground pair 256 a tile, the splitter's input line 179 and output line
 * 128. Accepted against the sums of each piece's `line_length` that the game gave on the sample's scaffold.
 */
describe("the geometry derived from the sample's output belt", () => {
    const geometry = outputBeltGeometry(SAMPLE_BELT, 9);
    const line = (name: string) => {
        const found = geometry.lines.find(each => each.name === name);
        if (!found) throw new Error(`no line ${name}: ${geometry.lines.map(each => each.name).join("; ")}`);
        return found;
    };

    it("gives each lane between two points the game's length", () => {
        // copy to copy, copy_offset 9 tiles apart: 9 tiles
        for (const [stretch, from, to] of [[1, 1, 2], [1, 2, 3], [1, 3, 4], [2, 6, 7], [2, 7, 8]]) {
            for (const lane of ["left", "right"]) {
                expect(line(`stretch ${stretch} ${lane} lane: side load of copy ${from} to side load of copy ${to}`).length).toBe(9 * 256);
            }
        }
        // copy 5's drop to copy 6's side load: 11 tiles, a left and a right curve: 10.5664
        expect(line("stretch 2 right lane: drop of copy 5 to side load of copy 6").length).toBe(2705);
        expect(2705 / 256).toBeCloseTo(10.5664, 4);
        // copy 9's drop to the splitter: 15 tiles, a left curve (inner) and three right curves (outer) on the left lane: 14.8711
        expect(line("stretch 3 left lane: drop of copy 9 to the splitter's left input").length).toBe(3807);
        expect(3807 / 256).toBeCloseTo(14.8711, 4);
        // the loop: 11 tiles of five left curves to the tile it side-loads onto: 11.7617 on the right lane, 8.0703 on the left
        expect(line("stretch 5 right lane: the splitter's left output to its side load onto stretch 4").length).toBe(3011);
        expect(line("stretch 5 left lane: the splitter's left output to its side load onto stretch 4").length).toBe(2066);
        expect(3011 / 256).toBeCloseTo(11.7617, 4);
        expect(2066 / 256).toBeCloseTo(8.0703, 4);
        // the side belt: its drop tile and a left curve, 2.1523 on its right lane (the seg the game gave each side belt)
        expect(line("side belt of copy 1 right lane").length).toBe(551);
        expect(551 / 256).toBeCloseTo(2.15234375, 8);
        // the splitter's own lines
        expect(line("the splitter's right input, left lane").length).toBe(179);
        expect(line("the splitter's left output, right lane").length).toBe(128);
    });

    it("says which line feeds which", () => {
        expect(line("side belt of copy 3 right lane").feeds).toEqual(["stretch 1 right lane: side load of copy 2 to side load of copy 3"]);
        // the side belt's left lane stops at the exit's hood
        expect(line("side belt of copy 3 left lane").feeds).toEqual([]);
        expect(line("stretch 1 right lane: side load of copy 4 to its side load onto stretch 2").feeds)
            .toEqual(["stretch 2 left lane: the tile of the side load of stretch 1"]);
        expect(line("stretch 1 left lane: side load of copy 4 to its side load onto stretch 2").feeds).toEqual([]);
        expect(line("stretch 2 right lane: side load of copy 8 to the splitter's right input").feeds)
            .toEqual(["the splitter's right input, right lane"]);
        expect(line("the splitter's right input, left lane").feeds)
            .toEqual(["the splitter's left output, left lane", "the splitter's right output, left lane"]);
        expect(line("the splitter's left output, right lane").feeds)
            .toEqual(["stretch 5 right lane: the splitter's left output to its side load onto stretch 4"]);
        expect(line("stretch 5 left lane: the splitter's left output to its side load onto stretch 4").feeds)
            .toEqual(["stretch 4 right lane: the splitter's right output to side load of stretch 5"]);
        expect(line("stretch 4 right lane: side load of stretch 5 to the outlet").feeds).toEqual([]);
    });

    it("gives each side load its receiving lane, layout and side-load point, each drop, the splitter and the outlet", () => {
        expect(geometry.side_loads.map(load => [load.sender, load.stretch, load.lane, load.layout, load.tile,
            load.lanes.filter(each => each.passes).map(each => [each.sender_lane, each.side_load_point])])).toEqual([
            [{ side_belt_of_copy: 1 }, 1, "right", "side-exit", 0, [["right", 67]]],
            [{ side_belt_of_copy: 2 }, 1, "right", "side-exit", 9, [["right", 67]]],
            [{ side_belt_of_copy: 3 }, 1, "right", "side-exit", 18, [["right", 67]]],
            [{ side_belt_of_copy: 4 }, 1, "right", "side-exit", 27, [["right", 67]]],
            [{ stretch: 1 }, 2, "left", "side-entrance", 0, [["right", 60]]],
            [{ side_belt_of_copy: 6 }, 2, "right", "side-exit", 18, [["right", 67]]],
            [{ side_belt_of_copy: 7 }, 2, "right", "side-exit", 27, [["right", 67]]],
            [{ side_belt_of_copy: 8 }, 2, "right", "side-exit", 36, [["right", 67]]],
            [{ stretch: 5 }, 4, "right", "side-straight", 1, [["left", 188], ["right", 67]]],
        ]);
        expect(geometry.drops).toEqual([
            { copy: 5, stretch: 2, lane: "right", tile: 7, end_at: { left: 2048, right: 2048 }, line: "stretch 2 right lane: side load of stretch 1 to drop of copy 5" },
            { copy: 9, stretch: 3, lane: "left", tile: 0, end_at: { left: 256, right: 256 }, line: "stretch 3 left lane: the tile of the drop of copy 9" },
        ]);
        expect(geometry.splitter).toEqual({ input_priority: "right", output_priority: "right",
            inputs: [{ side: "right", stretch: 2 }, { side: "left", stretch: 3 }], outputs: [{ side: "right", stretch: 4 }, { side: "left", stretch: 5 }] });
        expect(geometry.outlets).toEqual([{ stretch: 4, tile: 3, end_at: { left: 512, right: 512 },
            lines: { left: "stretch 4 left lane: side load of stretch 5 to the outlet", right: "stretch 4 right lane: side load of stretch 5 to the outlet" } }]);
        // the lines at each side load: the receiving lane's line that ends at the tile, and the sender's last line on each lane
        expect(geometry.side_loads.map(load => [load.receiver_line, load.sender_lines])).toContainEqual(["stretch 2 left lane: the tile of the side load of stretch 1",
            { left: "stretch 1 left lane: side load of copy 4 to its side load onto stretch 2", right: "stretch 1 right lane: side load of copy 4 to its side load onto stretch 2" }]);
        expect(geometry.side_loads.map(load => [load.receiver_line, load.sender_lines])).toContainEqual(["stretch 1 right lane: side load of copy 3 to side load of copy 4",
            { left: "side belt of copy 4 left lane", right: "side belt of copy 4 right lane" }]);
        expect(geometry.stretches.map(stretch => stretch.carried)).toEqual([["right"], ["left", "right"], ["left"], ["left", "right"], ["left", "right"]]);
    });
});

/**
 * The phase of a join: where a sender's stacks stand on its line when they reach its end, in 1/256 tile modulo a turbo
 * belt's step of 32 a tick. It is the put-on spot (its distance to the end of its tile, an engine fact that the section
 * does not hold) plus the length of the sender's lane after that tile. The recorded phases are from the game recordings
 * of the sample (every landing, Factorio 2.1.24) and of the test scaffold with the splitter's loop.
 */
describe("the phase of each join, from the derived lengths", () => {
    const TURBO_STEP = 32;
    const geometry = outputBeltGeometry(SAMPLE_BELT, 9);
    const stretch = (n: number) => geometry.stretches[n - 1];
    const place = (n: number, name: string) => stretch(n).places.find(each => each.name === name)!;
    /** A drop puts its stacks 3/8, 1/2 and 5/8 tile from the end of the drop tile (the calibrated side drop) */
    const DROP_SPOTS = [96, 128, 160];

    it("is 7 at the side loads of copies 1 to 4 and 6 to 8", () => {
        const side = geometry.side_belt!;
        for (const spot of DROP_SPOTS) {
            expect(streamPhase(spot, side.line_end.right - side.drop_tile_end, TURBO_STEP)).toBe(7);
        }
    });

    it("is 20 at the lane change, from the stacks of copies 1 to 4 landing on stretch 1", () => {
        // a free stack lands at the side-load point less a step, plus the sender's phase: 67 - 32 + 7 = 42 (recorded)
        const landing = 67 - TURBO_STEP + 7;
        for (const copy of [1, 2, 3, 4]) {
            const after = stretch(1).end.line_end.right - place(1, `side load of copy ${copy}`).end_at.right;
            expect(streamPhase(landing, after, TURBO_STEP)).toBe(20);
        }
    });

    it("is 17 for copy 5's stacks at copy 6's side load", () => {
        const after = place(2, "side load of copy 6").end_at.right - place(2, "drop of copy 5").end_at.right;
        for (const spot of DROP_SPOTS) expect(streamPhase(spot, after, TURBO_STEP)).toBe(17);
    });

    it("is 2 and 17 on the loop of the test scaffold with the splitter, from the put-on spots of its script", () => {
        // the same loop: the splitter's left output, 12 tiles with 5 left curves; the script put its stacks 294 before the end
        // of the first curve's outer lane and 105 before the end of its inner lane. The straight tiles before that curve add
        // whole steps (256 is 8 steps), so the phase is the spot plus the lane after the first curve.
        const loop = outputBeltGeometry({ stretches: [
            { points: [{ splitter_output: "left" }, { tiles: 12, left_curves: 5 }] },
            { points: [{ splitter_output: "right" }, { tiles: 1, side_load: { stretch: 1 }, lane: "right", layout: "side-straight" },
                { tiles: 2, lane_end: { kind: "outlet" } }] },
        ], splitter: { input_priority: "right", output_priority: "right" } }, 9);
        const end = loop.stretches[0].end.line_end;
        expect(streamPhase(294, end.right - 295, TURBO_STEP)).toBe(2);
        expect(streamPhase(105, end.left - 106, TURBO_STEP)).toBe(17);
    });

    it("is 13 and 28 on the sample's own loop, from a lane phase of 10 at the splitter (computed only, not recorded)", () => {
        const end = stretch(5).end.line_end;
        expect(streamPhase(10, end.right, TURBO_STEP)).toBe(13);
        expect(streamPhase(10, end.left, TURBO_STEP)).toBe(28);
    });
});

/**
 * The blocks of seven test scaffolds, read in the game by the API reads of each belt piece (Factorio 2.1.24). Each
 * stretch that a belt from outside feeds starts at a point `entry`, which is not a field: the generator does not model
 * such a belt. Without it, each block is refused by the rules it breaks.
 */
describe("the blocks of the seven test scaffolds", () => {
    const sideLoaded = (layout: string) => ({ stretches: [
        { points: [{ entry: {} }, { tiles: 4 }] },
        { points: [{ entry: {} }, { side_load: { stretch: 1 }, lane: "left", layout, tiles: 5 }, { tiles: 7, lane_end: { kind: "outlet" } }] },
        { points: [{ entry: {} }, { side_load: { stretch: 4 }, lane: "right", layout, tiles: 5 }, { tiles: 7, lane_end: { kind: "outlet" } }] },
        { points: [{ entry: {} }, { tiles: 4 }] },
    ] });
    const BLOCKS: [string, unknown][] = [
        ["two straight belts, each taking a side load from one side", sideLoaded("side-straight")],
        ["two underground exits, each taking a side load from one side", sideLoaded("side-exit")],
        ["two underground entrances, each taking a side load from one side", sideLoaded("side-entrance")],
        ["a side belt onto an exit, then the lane change onto an entrance", { side_belt: { lane: "right", left_curves: 1, tiles: 2 }, stretches: [
            { points: [{ entry: {} }, { tiles: 9, side_load: [1], lane: "right", layout: "side-exit" }, { tiles: 2, right_curves: 1 }] },
            { points: [{ side_load: { stretch: 1 }, lane: "left", layout: "side-entrance" }, { tiles: 10, left_curves: 1, right_curves: 1, lane_end: { kind: "outlet" } }] },
        ] }],
        ["a side belt onto an exit, then a plain belt to the outlet", { side_belt: { lane: "right", left_curves: 1, tiles: 2 }, stretches: [
            { points: [{ entry: {} }, { tiles: 9, side_load: [1], lane: "right", layout: "side-exit" }, { tiles: 10, lane_end: { kind: "outlet" } }] },
        ] }],
        ["a splitter with no priority", { stretches: [
            { points: [{ entry: {} }, { tiles: 8, splitter_input: "left" }] },
            { points: [{ entry: {} }, { tiles: 8, splitter_input: "right" }] },
            { points: [{ splitter_output: "left" }, { tiles: 9, lane_end: { kind: "outlet" } }] },
            { points: [{ splitter_output: "right" }, { tiles: 9, lane_end: { kind: "outlet" } }] },
        ], splitter: { input_priority: "none", output_priority: "none" } }],
        ["a splitter whose left output loops back onto its right output", { stretches: [
            { points: [{ entry: {} }, { tiles: 3, left_curves: 1, right_curves: 1, splitter_input: "left" }] },
            { points: [{ entry: {} }, { tiles: 6, splitter_input: "right" }] },
            { points: [{ splitter_output: "left" }, { tiles: 12, left_curves: 5 }] },
            { points: [{ splitter_output: "right" }, { side_load: { stretch: 3 }, lane: "right", layout: "side-straight", tiles: 1 },
                { tiles: 2, lane_end: { kind: "outlet" } }] },
        ], splitter: { input_priority: "right", output_priority: "right" } }],
    ];
    const withoutEntry = (value: unknown): unknown => Array.isArray(value) ? value.map(withoutEntry)
        : value !== null && typeof value === "object"
            ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "entry").map(([key, each]) => [key, withoutEntry(each)])) : value;
    /** Each refusal by its rule */
    const rules = (belt: unknown) => problems(belt).map(problem =>
        problem.includes("Unrecognized key: \"entry\"") ? "unknown key entry"
            : problem.includes("starts with nothing that feeds it") ? "nothing feeds a stretch"
                : problem.includes("outlets") || problem.includes("no outlet") ? "not one outlet"
                    : problem.includes("without a priority") ? "no priority" : problem);

    it.each(BLOCKS)("refuses %s for its entry from outside, a key the schema does not know", (name, block) => {
        expect(new Set(rules(block))).toEqual(new Set(["unknown key entry", ...(name === "a splitter with no priority" ? ["no priority"] : [])]));
    });

    it("refuses each block without its entry by the rules it breaks", () => {
        expect(BLOCKS.map(([name, block]) => [name, rules(withoutEntry(block))])).toEqual([
            ["two straight belts, each taking a side load from one side", [...Array(4).fill("nothing feeds a stretch"), "not one outlet"]],
            ["two underground exits, each taking a side load from one side", [...Array(4).fill("nothing feeds a stretch"), "not one outlet"]],
            ["two underground entrances, each taking a side load from one side", [...Array(4).fill("nothing feeds a stretch"), "not one outlet"]],
            ["a side belt onto an exit, then the lane change onto an entrance", ["nothing feeds a stretch"]],
            ["a side belt onto an exit, then a plain belt to the outlet", ["nothing feeds a stretch"]],
            ["a splitter with no priority", ["no priority", "no priority"]],
            ["a splitter whose left output loops back onto its right output", ["nothing feeds a stretch", "nothing feeds a stretch"]],
        ]);
        // with the priorities stated, the splitter's block is refused for its two entries and its two outlets
        const splitter = withoutEntry(BLOCKS[5][1]) as { splitter: object };
        expect(rules({ ...splitter, splitter: { input_priority: "right", output_priority: "right" } }))
            .toEqual(["nothing feeds a stretch", "nothing feeds a stretch", "not one outlet"]);
    });
});
