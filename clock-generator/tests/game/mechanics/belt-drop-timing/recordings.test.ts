import fs from "fs";
import path from "path";
import {describe, expect, test} from "vitest";
import {Belt, BeltSpeed} from "../../../../src/entities/belt/belt";
import {rotationTicks} from "../../../../src/entities/inserter/metadata/inserter-spec";
import {figuresOf, Hand, scenarioOf, summarise} from "./analysis";
import {ALL_RUNS, DropRun, KIND_RUNS, STACK_RUNS, VALIDATION_RUNS} from "./cases";
import {DropRecording, loadRecording} from "./recording";
import {compareRun} from "./simulator-replay";
import {runFigures} from "./summary";

/**
 * The retained recordings of the belt drop timing runs (timing.game.test.ts, probe.lua), read offline: when each hand of a turbo line's
 * inserter is picked up, the tick each stack of it lands, on which lane and where, from each side and end of a line and each end
 * of an underground pair, in each state of the receiving lane, with each inserter kind; and the simulator's lane rule set against them.
 * See README.md and docs/belt-drop/.
 */
const cache = new Map<string, DropRecording>();
const recording = (run: string): DropRecording => {
    let loaded = cache.get(run);
    if (!loaded) { loaded = loadRecording(run); cache.set(run, loaded); }
    return loaded;
};
const run = (name: string): DropRun => ALL_RUNS.find(it => it.name === name)!;
const hands = (runName: string, scenario: string): Hand[] => summarise(recording(runName), scenario).hands;
const first = (runName: string, scenario: string): Hand => hands(runName, scenario)[0];
const offsetsOf = (hand: Hand): number[] => hand.drops.map(drop => drop.tick - hand.drops[0].tick);
const delayOf = (hand: Hand): number => hand.drops[0].tick - hand.pickup;
const rounded = (values: number[]): number[] => values.map(value => Math.round(value * 1000) / 1000);
const LEGENDARY = "legendary-stack";
const name = (approach: string, state: string, kind = LEGENDARY, direction = "east") => `${approach}-${direction}-${kind}-${state}`;

describe("the runs are what cases.ts says", () => {
    test.each(ALL_RUNS.map(it => it.name))("%s: every scenario was recorded for its whole window, with the research unchanged", runName => {
        const loaded = recording(runName);
        expect(loaded.info.research_unchanged).toBe(true);
        expect(loaded.info.factorio).toMatch(/^2\.1\./);
        expect(loaded.info.scenarios.map(scenario => scenario.name)).toEqual(run(runName).scenarios.map(scenario => scenario.name));
        for (const scenario of run(runName).scenarios) expect(loaded.runs[scenario.name].length, scenario.name).toBe(run(runName).ticks + 3);
        expect(loaded.info.force.belt_stack_size_bonus).toBe(run(runName).force!.belt_stack_size_bonus);
    });

    test("every inserter took from its chest and dropped on a turbo belt piece, and no drop position can be named", () => {
        for (const runName of ALL_RUNS.map(it => it.name)) for (const scenario of recording(runName).info.scenarios) {
            expect(scenario.pickup, scenario.name).toBe("steel-chest");
            expect(scenario.drop_target, scenario.name).toMatch(/^turbo-(transport-belt|underground-belt)$/);
            expect(scenario.allow_custom_vectors, scenario.name).toBe(false);
        }
    });

    test("no hand drops more than it was picked up with, and a hand that is followed by another has dropped all of it", () => {
        for (const runName of ALL_RUNS.map(it => it.name)) for (const scenario of recording(runName).info.scenarios) {
            const list = hands(runName, scenario.name);
            list.forEach((hand, index) => {
                const dropped = hand.drops.reduce((sum, drop) => sum + drop.count, 0);
                expect(dropped, `${runName} ${scenario.name} hand ${index}`).toBeLessThanOrEqual(hand.held);
                if (scenario.flows && index < list.length - 1) expect(dropped, `${runName} ${scenario.name} hand ${index}`).toBe(hand.held);
            });
        }
    });
});

describe("the probe reproduces the calibrated case (turbo, a side drop, an empty lane, belt stack sizes 1 to 4)", () => {
    const expectations = JSON.parse(fs.readFileSync(path.join(__dirname, "../belt-drop/fixtures/turbo-stacks/speed-expectations.json"), "utf8")) as
        Record<string, {start: number; offsets: number[]; amounts: number[]}[]>;
    const SCENARIO = name("left", "empty");

    test.each([1, 2, 3, 4])("belt stack %i: the ticks are Belt.amountToDropAtTick's and the earlier calibration's, the stacks land at 3/8, 1/2, then 5/8 of a tile from the end", size => {
        const effective = size === 3 ? 15 : 16;
        for (const runName of [`validation-${size}`, `stack-${size}`]) {
            const list = hands(runName, SCENARIO);
            expect(list.length, runName).toBeGreaterThanOrEqual(2);
            // the function: from the first drop, a stack at each tick it names until the hand is empty
            const expected: number[] = [];
            for (let tick = 0, remaining = effective; remaining > 0; tick++) {
                const amount = Belt.amountToDropAtTick(BeltSpeed.TURBO_TRANSPORT_BELT, size as 1, tick);
                if (amount > 0) { expected.push(tick); remaining -= Math.min(amount, remaining); }
            }
            const calibrated = expectations[`turbo/${size}`];
            for (const [index, hand] of list.slice(0, 2).entries()) {
                expect(hand.held, `${runName} hand ${index}`).toBe(effective);
                expect(offsetsOf(hand), `${runName} hand ${index}`).toEqual(expected);
                expect(offsetsOf(hand), `${runName} hand ${index}`).toEqual(calibrated[index].offsets);
                expect(hand.drops.map(drop => drop.count), `${runName} hand ${index}`).toEqual(calibrated[index].amounts);
                expect(delayOf(hand), `${runName} hand ${index}`).toBe(4);
                expect(new Set(hand.drops.map(drop => drop.lane)), `${runName} hand ${index}`).toEqual(new Set([2]));
                expect(hand.drops.map(drop => drop.position), `${runName} hand ${index}`)
                    .toEqual(hand.drops.map((_, at) => Math.min(5 / 8, 3 / 8 + at / 8)));
            }
            // a hand is picked up as the earlier calibration's next hand starts to drop, less the four ticks to the drop
            expect(list[1].pickup - list[0].pickup, runName).toBe(calibrated[1].start - calibrated[0].start);
        }
    });

    test.each([1, 2, 3, 4])("belt stack %i: the run of this one case and the run of the whole matrix give the same figures", size => {
        expect(runFigures(recording(`validation-${size}`))[SCENARIO]).toEqual(runFigures(recording(`stack-${size}`))[SCENARIO]);
    });

    test("the hands follow each other every 36, 20, 14 and 12 ticks, as the earlier calibration's next hand does", () => {
        expect([1, 2, 3, 4].map(size => { const [a, b] = hands(`stack-${size}`, SCENARIO); return b.pickup - a.pickup; })).toEqual([36, 20, 14, 12]);
    });
});

describe("the direction the line runs does not matter", () => {
    test.each([1, 2, 3, 4])("belt stack %i: north, south and west give the east figures from every side and end", size => {
        const figures = runFigures(recording(`stack-${size}`));
        for (const approach of ["left", "right", "back", "front"]) for (const direction of ["north", "south", "west"]) {
            expect(figures[name(approach, "empty", LEGENDARY, direction)], `${approach} ${direction}`).toEqual(figures[name(approach, "empty")]);
        }
    });
});

/** [lane, delay from pickup to the first stack, ticks of the stacks from the first, landings: tiles from the end of the piece, after the tick's step] */
type EmptyRow = [number, number, string, number[]];
describe("an empty lane, from each approach", () => {
    // belt stack 4 (hand 16: four stacks) and belt stack 1 (sixteen stacks), the first hand
    const EMPTY: Record<string, {4: EmptyRow; 1: EmptyRow}> = {
        left: {4: [2, 4, "0,1,2,4", [0.375, 0.5, 0.625, 0.625]], 1: [2, 4, "0,1,2,4,6,8,10,12,14,16,18,20,22,24,26,28", [0.375, 0.5, 0.625, 0.625]]},
        right: {4: [1, 4, "0,1,2,4", [0.375, 0.5, 0.625, 0.625]], 1: [1, 4, "0,1,2,4,6,8,10,12,14,16,18,20,22,24,26,28", [0.375, 0.5, 0.625, 0.625]]},
        back: {4: [2, 4, "0,1,2,4", [0.176, 0.301, 0.426, 0.426]], 1: [2, 4, "0,1,2,4,6,8,10,12,14,16,18,20,22,24,26,28", [0.176, 0.301, 0.426, 0.426]]},
        front: {4: [2, 4, "0,1,2,4", [0.574, 0.699, 0.824, 0.824]], 1: [2, 4, "0,1,2,4", [0.574, 0.699, 0.824, 0.824]]},
        "entrance-left": {4: [2, 4, "0,1,3,5", [0, 0, 0, 0]], 1: [2, 4, "0,1,3,5,7,9,11,13,15,17,19,21,23,25,27,29", [0, 0, 0, 0]]},
        "entrance-right": {4: [1, 4, "0,1,3,5", [0, 0, 0, 0]], 1: [1, 4, "0,1,3,5,7,9,11,13,15,17,19,21,23,25,27,29", [0, 0, 0, 0]]},
        "exit-left": {4: [2, 4, "0,1,3,5", [0.371, 0.496, 0.496, 0.496]], 1: [2, 4, "0,1,3,5,7,9,11,13,15,17,19,21,23,25,27,29", [0.371, 0.496, 0.496, 0.496]]},
        "exit-right": {4: [1, 4, "0,1,3,5", [0.371, 0.496, 0.496, 0.496]], 1: [1, 4, "0,1,3,5,7,9,11,13,15,17,19,21,23,25,27,29", [0.371, 0.496, 0.496, 0.496]]},
        "entrance-from-upstream": {4: [2, 4, "0,1,3,5", [0, 0, 0, 0]], 1: [2, 4, "0,1,3,5,7,9,11,13,15,17,19,21,23,25,27,29", [0, 0, 0, 0]]},
        "entrance-from-downstream": {4: [2, 4, "0,1,2,4", [0.074, 0.074, 0.324, 0.324]], 1: [2, 4, "0,1,2,4,6,8,10,12,14,16,18,20,22,24,26,28", [0.074, 0.074, 0.324, 0.324]]},
        "exit-from-upstream": {4: [2, 4, "0,1,3,5", [0.176, 0.301, 0.301, 0.301]], 1: [2, 4, "0,1,3,5,7,9,11,13,15,17,19,21,23,25,27,29", [0.176, 0.301, 0.301, 0.301]]},
        "exit-from-downstream": {4: [2, 4, "0,1", [0.371, 0.496]], 1: [2, 4, "0,1", [0.371, 0.496]]},
    };
    test.each(Object.keys(EMPTY))("%s", approach => {
        for (const size of [4, 1] as const) {
            const hand = first(`stack-${size}`, name(approach, "empty"));
            const [lane, delay, offsets, landings] = EMPTY[approach][size];
            expect({lane: [...new Set(hand.drops.map(drop => drop.lane))], delay: delayOf(hand), offsets: offsetsOf(hand).join(","),
                landings: rounded(hand.drops.slice(0, landings.length).map(drop => drop.position)), counts: [...new Set(hand.drops.map(drop => drop.count))]},
                `stack ${size}`).toEqual({lane: [lane], delay, offsets, landings, counts: [size]});
        }
    });

    test("a straight line lands a stack at the drop position plus one step of the belt, and the next stacks a quarter tile behind each other, never more than a quarter tile behind the drop position", () => {
        for (const size of [1, 2, 3, 4]) for (const approach of ["left", "right", "back", "front"]) {
            const hand = first(`stack-${size}`, name(approach, "empty"));
            const spot = scenarioOf(recording(`stack-${size}`), name(approach, "empty")).drop.u + 0.5;
            expect(hand.drops[0].path, `${approach} ${size}`).toBeCloseTo(spot + 0.125, 2);
            for (const drop of hand.drops) {
                expect(drop.path, `${approach} ${size}`).toBeGreaterThan(spot - 0.25);
                expect(drop.path, `${approach} ${size}`).toBeLessThanOrEqual(spot + 0.126);
            }
        }
    });

    test("an underground end takes its second stack at the third tick, not the second, unless the drop reaches across its hood to the open half from downstream of the entrance", () => {
        for (const approach of ["entrance-left", "entrance-right", "exit-left", "exit-right", "entrance-from-upstream", "exit-from-upstream"]) {
            expect(offsetsOf(first("stack-4", name(approach, "empty"))), approach).toEqual([0, 1, 3, 5]);
        }
        expect(offsetsOf(first("stack-4", name("entrance-from-downstream", "empty")))).toEqual([0, 1, 2, 4]);
    });
});

describe("a lane with stacks moving on it", () => {
    const names = (approach: string, density: string, size: number) =>
        run(`stack-${size}`).scenarios.filter(scenario => scenario.name.startsWith(name(approach, density) + "-p")).map(scenario => scenario.name);
    const duration = (hand: Hand) => hand.drops.at(-1)!.tick - hand.drops[0].tick;
    // [delay range, duration range] of the first hand at belt stack 4, over the phases of the stream
    const RANGES: Record<string, Record<string, [[number, number], [number, number]]>> = {
        left: {d25: [[4, 4], [6, 8]], d50: [[4, 4], [10, 12]], d75: [[4, 8], [22, 24]]},
        right: {d25: [[4, 4], [6, 8]], d50: [[4, 4], [10, 12]], d75: [[4, 8], [22, 24]]},
        back: {d25: [[4, 4], [6, 8]], d50: [[4, 4], [10, 12]], d75: [[4, 8], [22, 24]]},
        "exit-left": {d25: [[4, 5], [6, 8]], d50: [[4, 5], [11, 12]], d75: [[4, 10], [22, 25]]},
        "entrance-from-downstream": {d25: [[4, 4], [4, 6]], d50: [[4, 4], [8, 10]], d75: [[4, 5], [16, 22]]},
        "exit-from-upstream": {d25: [[4, 4], [6, 8]], d50: [[4, 4], [10, 12]], d75: [[4, 8], [22, 24]]},
    };
    test.each(Object.keys(RANGES))("%s at belt stack 4: the wait and the length of the hand over the eight (four) phases of each stream", approach => {
        for (const [density, [delays, durations]] of Object.entries(RANGES[approach])) {
            const list = names(approach, density, 4).map(scenario => first("stack-4", scenario));
            expect(list.length).toBe(density === "d50" ? 4 : 8);
            expect([Math.min(...list.map(delayOf)), Math.max(...list.map(delayOf))], `${approach} ${density} delay`).toEqual(delays);
            expect([Math.min(...list.map(duration)), Math.max(...list.map(duration))], `${approach} ${density} duration`).toEqual(durations);
        }
    });

    test("a denser stream takes longer: at belt stack 1 the sixteen stacks take 38-40, 58-60 and 118-120 ticks on the 25%, 50% and 75% streams", () => {
        for (const approach of ["left", "right", "back", "exit-from-upstream"]) {
            const longest = (density: string) => names(approach, density, 1).map(scenario => duration(first("stack-1", scenario)));
            expect([Math.min(...longest("d25")), Math.max(...longest("d25"))], approach).toEqual([38, 40]);
            expect([Math.min(...longest("d50")), Math.max(...longest("d50"))], approach).toEqual([58, 60]);
            expect([Math.min(...longest("d75")), Math.max(...longest("d75"))], approach).toEqual([118, 120]);
        }
    });

    test("the stacks never land on the stream's lane in front of a stack they would overlap: each lands within a quarter tile behind the drop position", () => {
        for (const size of [1, 2, 3, 4]) for (const approach of ["left", "right", "back"]) {
            const spot = scenarioOf(recording(`stack-${size}`), name(approach, "empty")).drop.u + 0.5;
            for (const scenario of run(`stack-${size}`).scenarios.filter(it => it.approach === approach && it.direction === "east" && it.traffic)) {
                for (const drop of first(`stack-${size}`, scenario.name).drops) {
                    expect(drop.path, scenario.name).toBeGreaterThan(spot - 0.25);
                    expect(drop.path, scenario.name).toBeLessThanOrEqual(spot + 0.126);
                }
            }
        }
    });
});

describe("a full lane", () => {
    // the stream stops at tick 60; the first stack comes in the tick the last stack of it has passed the drop position
    const WAIT: Record<string, number> = {
        left: 46, right: 46, back: 24, "entrance-left": 22, "entrance-right": 22, "exit-left": 48, "exit-right": 48,
        "entrance-from-upstream": 22, "entrance-from-downstream": 5, "exit-from-upstream": 49,
    };
    test.each(Object.keys(WAIT))("%s: the hand waits for the stream to pass, then puts a stack down every second tick", approach => {
        for (const size of [1, 2, 3, 4]) {
            const hand = first(`stack-${size}`, name(approach, "full"));
            expect(delayOf(hand), `${approach} ${size}`).toBe(WAIT[approach]);
            if (approach === "entrance-from-downstream") {
                // the drop is ahead of where the stream enters the line: one stack finds room, the rest wait for the stream to pass
                expect(offsetsOf(hand).slice(0, 3), `${approach} ${size}`).toEqual([0, 18, 20]);
            } else {
                // twelve stacks every second tick; an underground exit's later stacks of a sixteen-stack hand come at odd ticks
                expect(offsetsOf(hand).slice(0, 12).every((offset, at) => offset === 2 * at), `${approach} ${size}`).toBe(true);
            }
        }
    });
});

describe("the end of a line", () => {
    test("a line that ends at the inserter takes the stacks of a hand until its last tile is full, whatever the stack size or the hand", () => {
        for (const size of [1, 2, 3, 4]) {
            const front = (state: string) => first(`stack-${size}`, name("front", state));
            expect(offsetsOf(front("empty")), `${size} empty`).toEqual([0, 1, 2, 4]);
            expect(offsetsOf(front("queue2")), `${size} queue2`).toEqual([0, 1]);
            expect(offsetsOf(front("queue3")), `${size} queue3`).toEqual([0]);
            expect(front("queue4").drops, `${size} queue4`).toEqual([]);
            expect(rounded(front("empty").drops.map(drop => drop.position))).toEqual([0.574, 0.699, 0.824, 0.824]);
            expect(rounded(front("queue2").drops.map(drop => drop.position))).toEqual([0.574, 0.75]);
        }
    });

    test("an underground exit that ends the line takes two stacks and then no more; with any queue at its end, none", () => {
        for (const size of [1, 2, 3, 4]) {
            const exit = (state: string) => first(`stack-${size}`, name("exit-from-downstream", state));
            expect(offsetsOf(exit("empty")), `${size}`).toEqual([0, 1]);
            for (const queue of [2, 3, 4]) expect(exit(`queue${queue}`).drops, `${size} queue${queue}`).toEqual([]);
        }
    });

    test("the hand of a blocked line stays in the inserter: it is never picked up again", () => {
        for (const state of ["empty", "queue2", "queue3", "queue4"]) {
            const picked = hands("stack-1", name("front", state)).map(hand => hand.pickup);
            expect(picked, state).toEqual([41]);
        }
    });
});

describe("the other inserter kinds", () => {
    // [hand, delay from pickup to the first drop at normal and at legendary quality, items in each drop at belt stack 1 / 3 / 4]
    const KINDS: Record<string, [number, number, number, [number, number, number]]> = {
        inserter: [4, 35, 14, [1, 1, 1]],
        "long-handed-inserter": [4, 24, 9, [1, 1, 1]],
        "fast-inserter": [4, 12, 4, [1, 1, 1]],
        "bulk-inserter": [12, 12, 4, [1, 1, 1]],
        "stack-inserter": [16, 12, 4, [1, 3, 4]],
    };
    test.each(Object.keys(KINDS))("%s", prototype => {
        const [hand, normal, legendary, items] = KINDS[prototype];
        for (const [index, size] of [1, 3, 4].entries()) for (const [quality, delay] of [["normal", normal], ["legendary", legendary]] as const) {
            const label = `${prototype}-${quality}`;
            const h = first(`kinds-${size}`, name("left", "empty", label));
            const effective = prototype === "stack-inserter" && size === 3 ? 15 : hand;
            // the hand is what the research gives the kind; only the stack inserter's is cut to whole belt stacks
            expect(h.held, `${label} ${size}`).toBe(effective);
            expect(delayOf(h), `${label} ${size}`).toBe(delay);
            // the engine's swing from a chest to a belt (the rotation of the kind and quality, one tick to pick up) is the wait to the first drop
            expect(delay, `${label} swing`).toBe(rotationTicks(prototype, quality) + 1);
            expect([...new Set(h.drops.map(drop => drop.count))], `${label} ${size}`).toEqual([items[index]]);
            expect(h.drops.length, `${label} ${size}`).toBe(effective / items[index]);
            // the cadence of the drops is the belt's, whatever the kind
            const cadence = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28].slice(0, h.drops.length);
            expect(offsetsOf(h), `${label} ${size}`).toEqual(cadence);
        }
    });

    test("every kind lands on the same lane and the same places as the stack inserter does, from every side and end", () => {
        for (const size of [1, 3, 4]) for (const approach of ["left", "right", "back", "front"]) {
            const reference = first(`stack-${size}`, name(approach, "empty"));
            for (const proto of Object.keys(KINDS)) for (const quality of ["normal", "legendary"]) {
                const mine = first(`kinds-${size}`, name(approach, "empty", `${proto}-${quality}`));
                const shared = Math.min(4, mine.drops.length, reference.drops.length);
                expect(new Set(mine.drops.map(drop => drop.lane)), `${proto} ${quality} ${approach}`).toEqual(new Set(reference.drops.map(drop => drop.lane)));
                expect(rounded(mine.drops.slice(0, shared).map(drop => drop.position)), `${proto} ${quality} ${approach}`)
                    .toEqual(rounded(reference.drops.slice(0, shared).map(drop => drop.position)));
            }
        }
    });
});

describe("the simulator's lane rule against the game (LaneTraffic, with the hand the simulator gives and the game's own stream)", () => {
    // [cases on a straight line, those the simulator reproduces: the ticks and the landings of the first hand]
    const COUNTS: Record<string, [number, number]> = {
        "stack-1": [82, 68], "stack-2": [82, 68], "stack-3": [82, 68], "stack-4": [82, 72],
        "kinds-1": [160, 124], "kinds-3": [160, 23], "kinds-4": [160, 25],
    };
    test.each(Object.keys(COUNTS))("%s", runName => {
        const results = compareRun(run(runName), recording(runName));
        expect([results.length, results.filter(result => result.ticks && result.landings).length]).toEqual(COUNTS[runName]);
    });

    test("an empty lane beside the line or behind its first tile: the simulator agrees at every stack size and from every direction", () => {
        for (const runName of ["stack-1", "stack-2", "stack-3", "stack-4"]) {
            const results = compareRun(run(runName), recording(runName));
            for (const result of results.filter(it => /^(left|right|back)-\w+-legendary-stack-empty$/.test(it.name))) {
                expect(result.ticks && result.landings, `${runName} ${result.name}`).toBe(true);
            }
        }
    });

    test("a full lane and a lane with a stack in two: the simulator agrees (50%: 16 of 16 and 75%: 31 of 32 first hands on each side, per stack size)", () => {
        for (const runName of ["stack-1", "stack-2", "stack-3", "stack-4"]) {
            const results = compareRun(run(runName), recording(runName));
            const of = (pattern: RegExp) => results.filter(it => pattern.test(it.name));
            expect(of(/^(left|right|back)-east-legendary-stack-(d50|full)/).every(it => it.ticks && it.landings), runName).toBe(true);
            expect(of(/^(left|right)-east-legendary-stack-d75/).every(it => it.ticks && it.landings), runName).toBe(true);
        }
    });

    test("a lane with a stack in four: the simulator disagrees in the phases where a stack of the stream is within a tile of the drop position when the second stack lands", () => {
        const results = compareRun(run("stack-1"), recording("stack-1"));
        const wrong = results.filter(it => /-d25-/.test(it.name) && !(it.ticks && it.landings)).map(it => it.name.replace("-east-legendary-stack", ""));
        expect(wrong).toEqual(["left-d25-p4", "left-d25-p6", "right-d25-p4", "right-d25-p6", "back-d25-p2", "back-d25-p4"]);
        const left = results.find(it => it.name === name("left", "d25-p4"))!;
        expect(left.game.offsets.slice(0, 4)).toEqual([0, 1, 4, 6]);
        expect(left.sim!.offsets.slice(0, 4)).toEqual([0, 2, 4, 6]);
    });

    test("a line that ends at the inserter: the simulator lets the whole hand land, the game stops after the last tile is full", () => {
        const results = compareRun(run("stack-1"), recording("stack-1"));
        const front = results.find(it => it.name === name("front", "empty"))!;
        expect(front.game.counts.length).toBe(4);
        expect(front.sim!.counts.length).toBe(16);
    });

    test("a kind that is not the stack inserter, on belt stacks of 3 and 4: the simulator drops whole belt stacks, the game one item at a time", () => {
        for (const [runName, simDrops] of [["kinds-4", [4]], ["kinds-3", [3]]] as const) {
            const result = compareRun(run(runName), recording(runName)).find(it => it.name === name("left", "empty", "inserter-legendary"))!;
            expect(result.game.counts).toEqual([1, 1, 1, 1]);
            expect(result.sim!.counts).toEqual(simDrops);
        }
        const bulk = compareRun(run("kinds-4"), recording("kinds-4")).find(it => it.name === name("left", "empty", "bulk-inserter-legendary"))!;
        expect(bulk.game.counts.length).toBe(12);
        expect(bulk.sim!.counts).toEqual([4, 4, 4]);
    });
});

describe("the runs keep the figures a fresh run is compared with", () => {
    test.each(ALL_RUNS.map(it => it.name))("%s: figures of every scenario", runName => {
        const figures = runFigures(recording(runName));
        expect(Object.keys(figures)).toHaveLength(run(runName).scenarios.length);
        for (const scenario of run(runName).scenarios) expect(figures[scenario.name].hands[0], scenario.name).not.toBeUndefined();
        void figuresOf;
    });
    test("the validation, stack and kind runs are all of them", () => {
        expect(ALL_RUNS).toEqual([...VALIDATION_RUNS, ...STACK_RUNS, ...KIND_RUNS]);
    });
});
