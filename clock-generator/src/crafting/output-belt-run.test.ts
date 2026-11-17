import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { lithiumRows } from "../../tests/configs/lithium-rows";
import { BeltSpeed } from "../entities/belt";
import type { OutputBeltJoin } from "../entities/belt/join/output-belt-join";
import { BeltLane } from "../simulation/components/belt-lane";
import { OutputBeltDrop, OutputBeltRun } from "./output-belt-run";
import type { Config } from "../config";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { outputBeltProblems } from "../config/output-belt";
import { OpenRange } from "../data-types";
import { EntityId } from "../entities";
import { simulationStateKey } from "./runner/steady-state";
import type { SimulationContext } from "./sequence/simulation-context";
import { recordInserters, runOnSharedLanes, sharedLaneLayoutOf, type DropRecorder } from "./shared-lane-model";
import { sharedLaneRunsOf } from "./shared-lane-verdict";

// One copy's side belt (a drop tile and a turned belt, 551 long) side-loads onto an underground exit (128), which runs into
// the infinite end's loader: the automation science 240 build's copy 1, with its stretch cut short
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
    infinite_end_lines: ["loader"],
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

    it("holds a stack only when the side belt is full: 8 stacks, with the infinite end shut", () => {
        const run = new OutputBeltRun(JOIN, 0);
        run.shutInfiniteEnd(0);
        const down = putDowns(run, 400);
        const on_side_belt = run.stacks(400).filter(stack => stack.line === "side belt").length;
        expect(on_side_belt).toBe(8);
        expect(down.length).toBeGreaterThan(8);
        expect(run.hasRoom(1, 401)).toBe(false);
    });

    it("drains again when the infinite end opens", () => {
        const run = new OutputBeltRun(JOIN, 0);
        run.shutInfiniteEnd(0);
        putDowns(run, 400);
        run.openInfiniteEnd(400);
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
        lane.seedDrop("inserter:2", new OutputBeltDrop(one, 1, 1, true, () => 0, 4, BeltSpeed.TURBO_TRANSPORT_BELT));
        twin.seedDrop("inserter:2", new OutputBeltDrop(other, 1, 1, true, () => 0, 4, BeltSpeed.TURBO_TRANSPORT_BELT));
        expect(lane.dropKey("inserter:2", 10)).toBe(one.key(10));
        expect(lane.dropKey("inserter:2", 10)).not.toBe(twin.dropKey("inserter:2", 10));
    });

    it("keys the infinite end shut and the end change not yet acting", () => {
        const open = new OutputBeltRun(JOIN, 0), shut = new OutputBeltRun(JOIN, 0);
        shut.shutInfiniteEnd(5);
        expect(shut.key(5)).not.toBe(open.key(5));
        shut.openInfiniteEnd(6);
        expect(shut.key(8)).toBe(open.key(8));
    });
});

describe("the output belt in the state of a run of the copies", () => {
    it("is held once in the state that a repeat compares, on the automation science 240 build", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const output = [OpenRange.from(1, 37), OpenRange.from(109, 145)];
        const windows = new Map([["inserter:2", output], ["inserter:1", [OpenRange.from(0, 50), OpenRange.from(122, 149), OpenRange.from(159, 186), OpenRange.from(215, 215)]]]);
        const { readings } = sharedLaneRunsOf(config);
        let context: SimulationContext | undefined;
        const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };
        const run = runOnSharedLanes(readings[0].under, windows, 216, readings[0].layouts[0], 4, quiet, it => { context = it; });
        const tick = context!.tick_provider.getCurrentTick();
        const key = run.output_belt!.key(tick);
        expect(run.output_belt!.stacks(tick).length).toBeGreaterThan(0);
        expect(simulationStateKey(context!).split(key).length - 1).toBe(1);
    });
});

/** A clock recorded in the game on the lithium plate build: its windows, and the output swings of a window it was made with */
interface RecordedClock {
    readonly window_cycle_ticks: number;
    readonly output_swings?: number;
    readonly windows: Readonly<Record<string, readonly { start: number; end: number }[]>>;
}

/**
 * Two clocks recorded on the lithium plate build (Factorio 2.1.24, warm-up 3,600 ticks), with only the output path changed
 * between the runs of a clock:
 * - `short_in_game` (4,320 ticks, 5,760 plates a window cycle): 5,120, 5,664, 5,680 and 5,680 as built; 5,152 then 5,728
 *   three times with furnaces 7 and 8 into a chest that removes all; 5,760 in each of four with furnaces 3, 4, 7 and 8
 *   into it
 * - `holds_in_game` (2,160 ticks): its 2,880 plates in every window cycle as built, at four starts
 */
const LITHIUM_CLOCKS: Readonly<Record<"short_in_game" | "holds_in_game", RecordedClock>> =
    JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "lithium-plate-80-recorded-clocks.json"), "utf8"));
/** The ticks of a run, and of its cold start before the window cycles that are judged */
const LITHIUM_RUN_TICKS = 6 * 4320;
const LITHIUM_WARM_UP_TICKS = 2 * 4320;
const LITHIUM_PER_SECOND = 80;
const quietLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };

/**
 * The plates that the furnaces' output inserters (onto the belt or into the chest) put down in each window cycle of a run
 * of the clock on the build from a cold start, after the warm-up
 */
function platesByWindowCycle(config: Config, clock: RecordedClock): number[] {
    const under: Config = clock.output_swings === undefined ? config
        : { ...config, overrides: { ...config.overrides, terminal_swing_count: clock.output_swings } };
    const windows = new Map(Object.entries(clock.windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const furnaces = new Set(config.machines.filter(machine => machine.recipe === config.setpoint.recipe).map(machine => machine.id));
    const output_ids = config.inserters.flatMap((inserter, index) => inserter.source.type === "machine" && furnaces.has(inserter.source.id)
        ? [EntityId.forInserter(inserter.id ?? index + 1).id] : []);
    const cycles = LITHIUM_RUN_TICKS / clock.window_cycle_ticks;
    let recorders: Map<string, DropRecorder> | undefined;
    runOnSharedLanes(under, windows, clock.window_cycle_ticks, sharedLaneLayoutOf(under, []), cycles, quietLogger,
        context => { recorders = recordInserters(context, output_ids); });
    const plates = new Array<number>(cycles).fill(0);
    for (const recorder of recorders!.values()) {
        for (const hand of recorder.hands) {
            const cycle = Math.floor(hand.tick / clock.window_cycle_ticks);
            if (cycle < cycles) plates[cycle] += hand.items;
        }
    }
    return plates.slice(LITHIUM_WARM_UP_TICKS / clock.window_cycle_ticks);
}

/** The plates of a window cycle of the clock, at the build's 80 a second */
const targetOf = (clock: RecordedClock) => LITHIUM_PER_SECOND * clock.window_cycle_ticks / 60;
const fallsShort = (plates: number[], clock: RecordedClock) => Math.min(...plates) < targetOf(clock);
const holds = (plates: number[], clock: RecordedClock) => plates.every(made => made >= targetOf(clock));

// The lithium plate build's two rows of three furnaces, each row's output on a line of its own: two output inserters
// drop in line onto underground ends of it, the third onto a side belt that side-loads onto it (tests/configs/lithium-rows.ts).
// The run of the copies moves the plates on both lines, so a hand that cannot put its plates down waits. The tests compare
// the direction with the game's (short or full in a window cycle), not the counts.
describe("the output belt of two lines, with three output inserters on each, on the lithium plate build", () => {
    let sample: Config;
    beforeAll(async () => { sample = await loadConfigFromFile(ConfigPaths.LITHIUM_PLATE_80_SILO_CHEST); });
    const { short_in_game, holds_in_game } = LITHIUM_CLOCKS;

    it("is stated with no problem as built, without the side loads, and with one furnace a row", () => {
        for (const form of ["as built", "no side loads", "one furnace a row"] as const) {
            const config = lithiumRows(sample, form);
            const outputs = config.inserters.filter(inserter => inserter.source.type === "machine" && inserter.sink.type === "belt").length;
            expect(outputBeltProblems(config.output_belt!, config.setpoint.copy_offset, outputs)).toEqual([]);
        }
    });

    it("as built: the clock short in the game falls short, the clock that holds in the game makes its plates in every window cycle", () => {
        expect(fallsShort(platesByWindowCycle(lithiumRows(sample, "as built"), short_in_game), short_in_game)).toBe(true);
        expect(holds(platesByWindowCycle(lithiumRows(sample, "as built"), holds_in_game), holds_in_game)).toBe(true);
    });

    it("the clock short in the game holds with one furnace a row on the lines, and falls short with two", () => {
        expect(holds(platesByWindowCycle(lithiumRows(sample, "one furnace a row"), short_in_game), short_in_game)).toBe(true);
        expect(fallsShort(platesByWindowCycle(lithiumRows(sample, "no side loads"), short_in_game), short_in_game)).toBe(true);
    });

    it("without the output belt, each hand on a tile of its own, the clock short in the game holds", () => {
        expect(holds(platesByWindowCycle(sample, short_in_game), short_in_game)).toBe(true);
    });
});
