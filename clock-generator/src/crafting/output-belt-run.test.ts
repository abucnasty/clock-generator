import { describe, expect, it } from "vitest";
import { BeltSpeed } from "../entities/belt";
import type { OutputBeltJoin } from "../entities/belt/join/output-belt-join";
import { BeltLane } from "../simulation/components/belt-lane";
import { OutputBeltDrop, OutputBeltRun } from "./output-belt-run";

// One copy's side belt (a drop tile and a turned belt, 551 long) side-loads onto an underground exit (128), which runs into
// the outlet's loader: the automation science 240 build's copy 1, with its stretch cut short
const JOIN: OutputBeltJoin = {
    layout: {
        lines: [
            { id: "side belt", length: 551 },
            { id: "exit", length: 128, feeds: "loader" },
            { id: "loader", length: 128, end: "loader" },
        ],
        side_loads: [{ sender: "side belt", receiver: "exit", lane: "downstream", entity: "underground-exit" }],
    },
    drops: new Map([[1, { line: "side belt", spot: 551 - 128 }]]),
    outlet_lines: ["loader"],
};

/** The ticks a stack goes down in, trying in every tick from 1 to `ticks` */
function putDowns(run: OutputBeltRun, ticks: number): number[] {
    const down: number[] = [];
    for (let tick = 1; tick <= ticks; tick++) if (run.putDown(1, tick)) down.push(tick);
    return down;
}

describe("the output belt in the run of the copies", () => {
    it("takes a hand's four stacks 0, 1, 2 and 4 ticks after it comes, on a free side belt", () => {
        const run = new OutputBeltRun(JOIN, 0);
        expect(putDowns(run, 5)).toEqual([1, 2, 3, 5]);
        expect(run.held({ arrival: 1, last: 5, stacks: 4 })).toBe(false);
        expect(run.held({ arrival: 1, last: 7, stacks: 4 })).toBe(true);
    });

    it("puts each stack down one step past the drop tile's middle, or 64 behind the stack ahead", () => {
        const run = new OutputBeltRun(JOIN, 0);
        putDowns(run, 5);
        // put down at 96, 128, 160 and 160 from the drop tile's end (295 from the side belt's end) in ticks 1, 2, 3 and 5,
        // they stand after the movement of tick 6 five, four, three and one step on
        expect(run.stacks(6).filter(stack => stack.line === "side belt").map(stack => stack.position))
            .toEqual([295 + 96 - 5 * 32, 295 + 128 - 4 * 32, 295 + 160 - 3 * 32, 295 + 160 - 32]);
    });

    it("holds a stack only when the side belt is full: 8 stacks, with the outlet shut", () => {
        const run = new OutputBeltRun(JOIN, 0);
        run.shutOutlet(0);
        const down = putDowns(run, 400);
        const on_side_belt = run.stacks(400).filter(stack => stack.line === "side belt").length;
        expect(on_side_belt).toBe(8);
        expect(down.length).toBeGreaterThan(8);
        expect(run.hasRoom(1, 401)).toBe(false);
    });

    it("drains again when the outlet opens", () => {
        const run = new OutputBeltRun(JOIN, 0);
        run.shutOutlet(0);
        putDowns(run, 400);
        run.openOutlet(400);
        expect(run.hasRoom(1, 401)).toBe(false);
        expect(run.stacks(600)).toEqual([]);
        expect(run.hasRoom(1, 600)).toBe(true);
    });

    it("keys every stack by its line and position: two states that differ only in a stack on the output belt are not one repeat", () => {
        const one = new OutputBeltRun(JOIN, 0), other = new OutputBeltRun(JOIN, 0), same = new OutputBeltRun(JOIN, 0);
        one.putDown(1, 3);
        same.putDown(1, 3);
        expect(one.key(10)).not.toBe(other.key(10));
        expect(one.key(10)).toBe(same.key(10));
        // the drop slot of the first copy's hand holds the key, so the belt's key (and the state of the run) holds it
        const lane = new BeltLane({ ingredient_name: "automation-science-pack", stack_size: 4 }, BeltSpeed.TURBO_TRANSPORT_BELT);
        const twin = new BeltLane({ ingredient_name: "automation-science-pack", stack_size: 4 }, BeltSpeed.TURBO_TRANSPORT_BELT);
        lane.seedDrop("inserter:2", new OutputBeltDrop(one, 1, true, () => 0, 4, BeltSpeed.TURBO_TRANSPORT_BELT));
        twin.seedDrop("inserter:2", new OutputBeltDrop(other, 1, true, () => 0, 4, BeltSpeed.TURBO_TRANSPORT_BELT));
        expect(lane.dropKey("inserter:2", 10)).toBe(one.key(10));
        expect(lane.dropKey("inserter:2", 10)).not.toBe(twin.dropKey("inserter:2", 10));
    });

    it("keys the outlet shut and the end change not yet acting", () => {
        const open = new OutputBeltRun(JOIN, 0), shut = new OutputBeltRun(JOIN, 0);
        shut.shutOutlet(5);
        expect(shut.key(5)).not.toBe(open.key(5));
        shut.openOutlet(6);
        expect(shut.key(8)).toBe(open.key(8));
    });
});
