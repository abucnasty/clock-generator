import fs from "fs";
import path from "path";
import zlib from "zlib";
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
import { simulateClockOnly, type SerializableClockWindows } from "./generate-blueprint";
import { switchOf } from "./disturbance-trial";
import { runClockOnBuild } from "./trial";
import { SimulationTick } from "./runner/simulation-tick";
import { isWindowCycleClock } from "../simulation/controls/enable-control";

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
    return runOfClock(config, clock).plates;
}

/** `platesByWindowCycle`, with the hands that the output belt took */
function runOfClock(config: Config, clock: RecordedClock): { plates: number[]; belt_hands: number } {
    // from the cold start, as the runs were laid against the game's (the reader counts window cycles from its tick 0)
    const cold: Config = { ...config, overrides: { ...config.overrides, judged_start: "cold" } };
    const under: Config = clock.output_swings === undefined ? cold
        : { ...cold, overrides: { ...cold.overrides, terminal_swing_count: clock.output_swings } };
    const windows = new Map(Object.entries(clock.windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const furnaces = new Set(config.machines.filter(machine => machine.recipe === config.setpoint.recipe).map(machine => machine.id));
    const output_ids = config.inserters.flatMap((inserter, index) => inserter.source.type === "machine" && furnaces.has(inserter.source.id)
        ? [EntityId.forInserter(inserter.id ?? index + 1).id] : []);
    const cycles = LITHIUM_RUN_TICKS / clock.window_cycle_ticks;
    let recorders: Map<string, DropRecorder> | undefined;
    const run = runOnSharedLanes(under, windows, clock.window_cycle_ticks, sharedLaneLayoutOf(under, []), cycles, quietLogger,
        context => { recorders = recordInserters(context, output_ids); });
    const plates = new Array<number>(cycles).fill(0);
    for (const recorder of recorders!.values()) {
        for (const hand of recorder.hands) {
            const cycle = Math.floor(hand.tick / clock.window_cycle_ticks);
            if (cycle < cycles) plates[cycle] += hand.items;
        }
    }
    return { plates: plates.slice(LITHIUM_WARM_UP_TICKS / clock.window_cycle_ticks),
        belt_hands: [...run.output_belt?.hands.values() ?? []].reduce((sum, hands) => sum + hands.length, 0) };
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

    it("is stated by the sample as loaded, with no problem, and the sample's run is the same as the test config's", () => {
        const outputs = sample.inserters.filter(inserter => inserter.source.type === "machine" && inserter.sink.type === "belt").length;
        expect(outputBeltProblems(sample.output_belt!, sample.setpoint.copy_offset, outputs)).toEqual([]);
        expect(sample.output_belt).toEqual(lithiumRows(sample, "as built").output_belt);
        expect(fallsShort(platesByWindowCycle(sample, short_in_game), short_in_game)).toBe(true);
        expect(holds(platesByWindowCycle(sample, holds_in_game), holds_in_game)).toBe(true);
    });

    it("as built: the clock short in the game falls short, the clock that holds in the game makes its plates in every window cycle", () => {
        expect(fallsShort(platesByWindowCycle(lithiumRows(sample, "as built"), short_in_game), short_in_game)).toBe(true);
        expect(holds(platesByWindowCycle(lithiumRows(sample, "as built"), holds_in_game), holds_in_game)).toBe(true);
    });

    it("the clock short in the game holds with one furnace a row on the lines, and falls short with two", () => {
        const one_a_row = runOfClock(lithiumRows(sample, "one furnace a row"), short_in_game);
        expect(holds(one_a_row.plates, short_in_game)).toBe(true);
        // furnaces 5 and 6 put their plates on the lines: 4 hands a window, 15 windows a window cycle, 6 window cycles
        expect(one_a_row.belt_hands).toBeGreaterThanOrEqual(2 * 4 * 15 * 5);
        expect(fallsShort(platesByWindowCycle(lithiumRows(sample, "no side loads"), short_in_game), short_in_game)).toBe(true);
    });

    it("without the output belt, each hand on a tile of its own, the clock short in the game holds", () => {
        expect(holds(platesByWindowCycle({ ...sample, output_belt: undefined }, short_in_game), short_in_game)).toBe(true);
    });
});

/**
 * The audit minute of the game's recording of the lithium plate build under the Coordinated Sources pick 660fda31 (4,320-tick
 * window cycle; Factorio 2.1.24, from ruling 60's start, recorded by filled-start search 2): the run's start options seed the
 * simulator from its first sample (scripts/seeded-run.js: the machines and hands; the clock at position 1,075; the silo, which
 * the recording does not hold, at 100 lithium), and `game` holds every inserter's hand and furnace 7's plates from sample 1 on.
 * Made by filled-start search 5's make-replay-fixture.js.
 */
interface SeededReplay {
    window_cycle_ticks: number;
    clock_windows: SerializableClockWindows;
    start: Parameters<typeof simulateClockOnly>[5];
    game: { samples: number; held: Record<string, number[]>; "machine:7 lithium-plate": number[] };
}
const REPLAY: SeededReplay = JSON.parse(zlib.zstdDecompressSync(
    fs.readFileSync(path.join(__dirname, "fixtures", "lithium-plate-80-silo-660fda31-audit.json.zst"))).toString("utf8"));

/** Each hand of an inserter in a series of what it holds: the tick of its first stack, and the ticks its stacks went down in from there */
function handsOf(held: readonly number[]): { tick: number; offsets: string }[] {
    const hands: { tick: number; offsets: string }[] = [];
    let start: number | null = null, offsets: number[] = [];
    for (let tick = 1; tick < held.length; tick++) {
        if (held[tick] >= held[tick - 1]) continue;
        if (start === null) {
            start = tick;
            offsets = [];
        }
        offsets.push(tick - start);
        if (held[tick] === 0) {
            hands.push({ tick: start, offsets: offsets.join(",") });
            start = null;
        }
    }
    return hands;
}

// Inserter 15 (furnace 7) drops onto an underground entrance whose exit side-loads onto its row's line, from the line's right
// side. The game puts four of each of its window's hands down 0, 1, 3 and 5 ticks after the first, not 0, 1, 2 and 4: in those
// hands the stub stands full to the drop spot, held at the side load by the plates of inserters 3 and 11 on the line, and it moves on
// a stack every 2 ticks from the hand's first stack (filled-start search 5's lane recording). Where those plates stand on the line
// comes from where inserters 3 and 11 put their stacks down on their underground ends (`drop_tile`).
describe("the output belt in the run of one copy, on the lithium plate build's pick 660fda31", () => {
    let sample: Config;
    beforeAll(async () => { sample = await loadConfigFromFile(ConfigPaths.LITHIUM_PLATE_80_SILO_CHEST); });
    const P = REPLAY.window_cycle_ticks;

    it("lays the seeded run on the game's audit minute: every hand, and furnace 7's plates, at every sample", () => {
        const stock = simulateClockOnly(sample, REPLAY.clock_windows, P, 2, quietLogger, REPLAY.start);
        const samples = REPLAY.game.samples;
        for (const [id, game] of Object.entries(REPLAY.game.held)) {
            const held = stock.inserters.find(it => it.inserter_id === id)!.held.slice(0, samples);
            expect({ id, first_parting: held.findIndex((value, tick) => value !== game[tick]) }).toEqual({ id, first_parting: -1 });
        }
        const furnace = stock.machines.find(it => it.machine_id === "machine:7")!;
        expect(furnace.outputs["lithium-plate"].slice(0, samples)).toEqual(REPLAY.game["machine:7 lithium-plate"]);
    });

    it("from the cold start, takes 58 hands of inserter 15 a window cycle, 5 of them late, and 60 of inserter 16: 11,456 plates in two", () => {
        const stock = simulateClockOnly(sample, REPLAY.clock_windows, P, 4, quietLogger);
        const judged = (id: string) => handsOf(stock.inserters.find(it => it.inserter_id === id)!.held)
            .filter(hand => hand.tick >= P && hand.tick < 3 * P);
        const late = (id: string) => judged(id).filter(hand => hand.offsets !== "0,1,2,4");
        // the game's late hands stand at clock values 622, 1,486, 2,350, 3,214 and 4,078: 4 more than the run's ticks of the window cycle
        expect(late("inserter:15").map(hand => [hand.tick % P, hand.offsets])).toEqual([618, 1482, 2346, 3210, 4074, 618, 1482, 2346, 3210, 4074]
            .map(tick => [tick, "0,1,3,5"]));
        expect(judged("inserter:15")).toHaveLength(2 * 58);
        for (const id of ["inserter:3", "inserter:6", "inserter:11", "inserter:12", "inserter:16"]) {
            expect({ id, hands: judged(id).length, late: late(id).length }).toEqual({ id, hands: 2 * 60, late: 0 });
        }
        // the game's baseline over two window cycles: 11,456 of the 11,520 the target asks
        const outputs = ["inserter:3", "inserter:6", "inserter:11", "inserter:12", "inserter:15", "inserter:16"];
        expect(outputs.reduce((sum, id) => sum + judged(id).length * 16, 0)).toBe(11_456);
    });
});

/**
 * The game's output block on the iron plate car build (Factorio 2.1.24, the car probe with `CAR_SERIES=1`): the probe fills the
 * chest that the output belt's loader empties into, then empties it again (the release). For each case, the game's state of both
 * furnaces at the seed tick, the block's and release's ticks, the game's ticks of a whole window cycle, and from the seed on, every
 * tick's plates in each furnace and in each output inserter's hand. Made by the output belt backup's make-fixture.js.
 */
interface CarBlockCase {
    name: string;
    terminal_swing_count: number;
    window_cycle_ticks: number;
    windows: SerializableClockWindows;
    seed: { tick: number; clock: number; furnaces: { plates: number; ore: number; crafting_progress: number; bonus_progress: number }[] };
    block_tick: number;
    release_tick: number;
    cycle_ticks: number[];
    game: Record<"stock_1" | "stock_2" | "out_hand_1" | "out_hand_2", number[]>;
}
const CAR_BLOCK: { cases: CarBlockCase[] } = JSON.parse(zlib.zstdDecompressSync(
    fs.readFileSync(path.join(__dirname, "fixtures", "iron-plate-80-car-output-block.json.zst"))).toString("utf8"));
/** The game's clock counter against the simulator's clock position (verdict gaps 11's alignment of the car's series) */
const CAR_CLOCK_SHIFT = 3;

/**
 * The simulator put at the game's state at the seed tick, after its own steady state, then the game's block and release at the
 * game's ticks through the loss trials' own switch: from there every tick is a game tick. Each tick's row is read before the
 * probe acts in it, then the tick runs, as the game's rows are.
 */
function replayCarBlock(sample: Config, run: CarBlockCase): CarBlockCase["game"] {
    const P = run.window_cycle_ticks;
    const config: Config = { ...sample, overrides: { ...sample.overrides, terminal_swing_count: run.terminal_swing_count, derive_clock_windows: false } };
    const windows = new Map(Object.entries(run.windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    let context: SimulationContext | undefined;
    runClockOnBuild(config, windows, P, quietLogger, { warmup_window_cycles: 0, simulate_window_cycles: 1, record_histories: false,
        factorio_states: false, on_context: it => { context = it; } });
    const step = new SimulationTick(context!);
    const clock = [...context!.inserters, ...context!.drills].map(it => it.control.asked).find(isWindowCycleClock)!;
    const position = () => ((clock.clockTick() % P) + P) % P;
    const furnaces = context!.machines.map(it => it.machine_state).sort((a, b) => a.entity_id.number - b.entity_id.number);
    const outputs = furnaces.map(furnace => context!.inserters.map(it => it.inserter_state)
        .find(it => it.inserter.source.entity_id.id === furnace.entity_id.id)!);
    const want = ((run.seed.clock - CAR_CLOCK_SHIFT) % P + P) % P;
    for (let tick = 0; tick < 7200 || position() !== want; tick++) step.executeForTick();
    furnaces.forEach((furnace, at) => {
        const seed = run.seed.furnaces[at];
        furnace.inventoryState.setQuantity("iron-plate", seed.plates);
        furnace.ingress.ingredientInventory("iron-ore").setQuantity("iron-ore", seed.ore);
        furnace.craftingProgress.progress = seed.crafting_progress;
        furnace.bonusProgress.progress = seed.bonus_progress;
    });
    const output = switchOf(context!, { kind: "output", item: "iron-plate" });
    const rows: CarBlockCase["game"] = { stock_1: [], stock_2: [], out_hand_1: [], out_hand_2: [] };
    for (let tick = run.seed.tick; tick < run.seed.tick + run.game.stock_1.length; tick++) {
        furnaces.forEach((furnace, at) => rows[at === 0 ? "stock_1" : "stock_2"].push(furnace.inventoryState.getQuantity("iron-plate")));
        outputs.forEach((inserter, at) => rows[at === 0 ? "out_hand_1" : "out_hand_2"].push(inserter.held_item?.quantity ?? 0));
        if (tick === run.block_tick) output.cut();
        if (tick === run.release_tick) output.restore();
        step.executeForTick();
    }
    return rows;
}

/** The first tick from which a hand holds plates for more than `ticks` ticks on end: the hand cannot put them down. Null where it never does. */
function firstHeld(held: readonly number[], from: number, ticks = 8): number | null {
    for (let run = 0, at = 0; at < held.length; at++) {
        run = held[at] > 0 ? run + 1 : 0;
        if (run > ticks) return from + at - ticks;
    }
    return null;
}

// The two furnaces' output inserters drop in line onto the ends of one underground pair: furnace 2's onto the entrance, on the
// right lane, furnace 1's onto the exit, on the left lane, 11 tiles before the loader. Under the block the left lane backs up to
// the exit first: furnace 1's hand is held, and its plates fill it to its output limit, while furnace 2's are taken in full all through
// the block (its lane is 9 tiles longer, through the tunnel). The simulator refused both furnaces' plates from the block's first tick.
describe("the output belt in the run of one copy, under the output block of the iron plate car build", () => {
    let sample: Config;
    beforeAll(async () => { sample = await loadConfigFromFile(ConfigPaths.IRON_PLATE_80_CAR_CHEST); });

    for (const run of CAR_BLOCK.cases) {
        it(`${run.name}: holds furnace 1's hand at the game's tick, never furnace 2's, and both furnaces' plates are the game's in every window cycle`, () => {
            const replay = replayCarBlock(sample, run);
            const at = (series: number[], tick: number) => series[tick - run.seed.tick];
            const cycles = run.cycle_ticks.map(tick => ({ tick, plates: [at(replay.stock_1, tick), at(replay.stock_2, tick)] }));
            expect(cycles).toEqual(run.cycle_ticks.map(tick => ({ tick, plates: [at(run.game.stock_1, tick), at(run.game.stock_2, tick)] })));
            expect(firstHeld(replay.out_hand_1, run.seed.tick)).toBe(firstHeld(run.game.out_hand_1, run.seed.tick));
            expect(firstHeld(run.game.out_hand_1, run.seed.tick)).toBeGreaterThan(run.block_tick);
            expect(firstHeld(replay.out_hand_2, run.seed.tick)).toBeNull();
            expect(firstHeld(run.game.out_hand_2, run.seed.tick)).toBeNull();
        });

        it(`${run.name}: lays on the game's plates every tick from the seed, but in the window cycle after the release`, () => {
            const replay = replayCarBlock(sample, run);
            // where a hand waits at the release, the simulator's loader takes its first stack a tick after the game's here (an end
            // that opens holds its stacks one tick more, join-model.ts), and furnace 1 runs a tick behind until its next pick-up
            const parted = (key: "stock_1" | "stock_2") => replay[key].flatMap((plates, at) => plates === run.game[key][at] ? [] : [run.seed.tick + at]);
            for (const key of ["stock_1", "stock_2"] as const) {
                expect(parted(key).filter(tick => tick <= run.release_tick || tick > run.release_tick + run.window_cycle_ticks)).toEqual([]);
            }
        });
    }
});
