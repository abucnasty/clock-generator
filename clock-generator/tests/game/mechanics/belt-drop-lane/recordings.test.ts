import {describe, expect, test} from "vitest";
import {ConfigSchema} from "../../../../src/config";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {handSizeFor} from "../../../../src/entities";
import {BeltHandDrop} from "../../../../src/simulation/components/belt-hand-drop";
import {HandScratch} from "../../../../src/simulation/components/hand";
import {EntityState} from "../../../../src/state";
import {LANE_RUNS} from "./cases";
import {LaneRecording, LaneScenarioInfo, loadRecording, rowsOf} from "./recording";

/**
 * The retained recordings of the belt drop lane runs (lane.game.test.ts, probe.lua), read offline: which lane of a straight
 * belt an inserter drops on, from each side of the belt and from each end of it, in each of the four ways the belt can
 * run, with a basic and a stack inserter, and the two lane choices the simulator makes where a belt's drop has no
 * named spot. See README.md.
 */
const RUNS = ["default", "plain"] as const;
const recordings: Record<string, LaneRecording> = Object.fromEntries(RUNS.map(run => [run, loadRecording(run)]));

/** The lane of the belt, by the game's index in the direction of travel: 1 the left lane, 2 the right lane, by the side the inserter is on */
const GAME_LANE = {left: 2, right: 1, back: 2, front: 2} as const;
/** The belt stack size the force has in each run (the save's research is 3, a stack of 4) */
const BELT_STACK = {default: 4, plain: 1} as const;

/** The lanes the items ever stood on, the left (1) and the right (2) lane of the belt, and the sizes of the groups of items that appeared at once */
function observed(recording: LaneRecording, scenario: LaneScenarioInfo) {
    const rows = rowsOf(recording, scenario.name);
    const lanes = new Set<number>();
    const groups = new Set<number>();
    for (let k = 1; k < rows.length; k++) {
        if (rows[k].left > rows[k - 1].left) { lanes.add(1); groups.add(rows[k].left - rows[k - 1].left); }
        if (rows[k].right > rows[k - 1].right) { lanes.add(2); groups.add(rows[k].right - rows[k - 1].right); }
    }
    return {lanes: [...lanes], groups: [...groups].sort((a, b) => a - b), left: Math.max(...rows.map(row => row.left)), right: Math.max(...rows.map(row => row.right))};
}

describe.each(RUNS)("%s run", run => {
    const recording = recordings[run];
    const scenarios = recording.info.scenarios;

    test("every inserter took from its chest and dropped on the belt, and no drop position can be named", () => {
        expect(scenarios.length).toBe(LANE_RUNS.find(it => it.name === run)!.scenarios.length);
        for (const scenario of scenarios) {
            expect(scenario.pickup, scenario.name).toBe("steel-chest");
            expect(scenario.drop_target, scenario.name).toBe("transport-belt");
            expect(scenario.allow_custom_vectors, scenario.name).toBe(false);
        }
    });

    test("the drop position is a fifth of a tile past the middle of the belt on its far side, and on the middle line for a drop along the belt", () => {
        for (const scenario of scenarios) {
            const {u, v} = scenario.drop;
            if (scenario.side === "left" || scenario.side === "right") {
                expect([u, v], scenario.name).toEqual([3, scenario.side === "left" ? 0.2 : -0.2].map(value => expect.closeTo(value, 2)));
            } else {
                // along the belt: on the middle line, a fifth of a tile past the inserter's own tile edge
                expect(v, scenario.name).toBeCloseTo(0, 6);
                expect(u, scenario.name).toBeCloseTo(scenario.side === "back" ? 0.2 : 4.8, 2);
            }
        }
    });

    test.each(scenarios.map(scenario => scenario.name))("%s: all the items stand on one lane, the one the side of the inserter decides", name => {
        const scenario = scenarios.find(it => it.name === name)!;
        const seen = observed(recording, scenario);
        expect(seen.lanes, "lanes used").toEqual([GAME_LANE[scenario.side]]);
        expect(seen.left === 0 || seen.right === 0).toBe(true);
    });

    test("the lane depends on neither the direction the belt runs, nor the inserter, nor the item", () => {
        const lanes = new Map<string, Set<number>>();
        for (const scenario of scenarios) {
            const lane = observed(recording, scenario).lanes[0];
            lanes.set(scenario.side, (lanes.get(scenario.side) ?? new Set<number>()).add(lane));
        }
        for (const side of ["left", "right", "back", "front"] as const) expect([...lanes.get(side)!], side).toEqual([GAME_LANE[side]]);
        // each combination of direction and inserter was recorded with two items
        for (const direction of ["north", "east", "south", "west"]) {
            expect(scenarios.filter(scenario => scenario.direction === direction).length).toBe(16);
        }
    });

    test("a stack inserter puts a belt stack at a time and a basic inserter one item at a time", () => {
        for (const scenario of scenarios) {
            const {groups} = observed(recording, scenario);
            expect(groups, scenario.name).toEqual(scenario.inserter === "stack-inserter" ? [BELT_STACK[run]] : [1]);
        }
    });
});

describe("the two lane choices of the simulator", () => {
    /** A machine that makes gears, dropping onto a belt of two lanes with no drop spot named; the lanes name the given items */
    function build(lanes: [string, string], stack_sizes: [number, number] = [4, 4]) {
        const config = ConfigSchema.parse({target_output: {recipe: "iron-gear-wheel", items_per_second: 1, copies: 1},
            machines: [{id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0}],
            belts: [{id: 1, type: "turbo-transport-belt", lanes: lanes.map((ingredient, index) => ({ingredient, stack_size: stack_sizes[index]}))}],
            inserters: [{id: 1, source: {type: "machine", id: 1}, sink: {type: "belt", id: 1}, stack_size: 16, filters: ["iron-gear-wheel"]}]});
        const context = SimulationContext.fromConfig(config);
        const inserter = context.inserters[0].inserter_state;
        const belt = context.state_registry.getStateByEntityIdOrThrow(inserter.inserter.sink.entity_id);
        if (!EntityState.isBelt(belt)) throw new Error("not a belt");
        return {context, inserter, belt};
    }

    /** The lanes (1, 2) the simulator's drop leaves stacks on, for the hand of gears the inserter holds */
    function dropLanes(lanes: [string, string], stack_sizes: [number, number] = [4, 4]): number[] {
        const {context, inserter, belt} = build(lanes, stack_sizes);
        inserter.held_item = {item_name: "iron-gear-wheel", quantity: 16};
        inserter.inventoryState.setQuantity("iron-gear-wheel", 16);
        const drop = new BeltHandDrop(inserter, new HandScratch(), belt, context.tick_provider);
        context.tick_provider.setCurrentTick(0);
        drop.drop();
        // the inserter's own local tile of each lane
        return belt.lanes.flatMap((lane, index) => lane.dropOf(inserter.entity_id.id)!.snapshot(0).length > 0 ? [index + 1] : []);
    }

    test("the item named on a lane goes on that lane, the geometry of the inserter not asked", () => {
        expect(dropLanes(["iron-gear-wheel", "copper-plate"])).toEqual([1]);
        expect(dropLanes(["copper-plate", "iron-gear-wheel"])).toEqual([2]);
    });

    test("an item no lane names goes on the lane with the larger stack, the first when they are equal", () => {
        expect(dropLanes(["copper-plate", "iron-plate"])).toEqual([1]);
        expect(dropLanes(["", "iron-plate"])).toEqual([1]);
        expect(dropLanes(["copper-plate", "iron-plate"], [2, 4])).toEqual([2]);
    });

    test("the hand size of an item no lane names is cut to the belt stacks of the same lane choice: 16 in stacks of 4, 15 in stacks of 3", () => {
        // the lanes' stacks differ only here: the game has one belt stack size for all of a force's belts
        expect(handSizeFor(build(["copper-plate", "iron-plate"], [3, 4]).inserter.inserter, "iron-gear-wheel")).toBe(16);
        expect(handSizeFor(build(["copper-plate", "iron-plate"], [4, 3]).inserter.inserter, "iron-gear-wheel")).toBe(16);
        expect(handSizeFor(build(["copper-plate", "iron-plate"], [2, 3]).inserter.inserter, "iron-gear-wheel")).toBe(15);
        // an item a lane names takes that lane's stack
        expect(handSizeFor(build(["iron-gear-wheel", "iron-plate"], [3, 4]).inserter.inserter, "iron-gear-wheel")).toBe(15);
    });
});
