import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { BeltSpeed } from "../entities/belt";
import { BeltLineMotion } from "./belt-line-motion";

/** The ticks the line is moving in, from `from` to `to`, after the takes of each tick */
function movingTicks(motion: BeltLineMotion, takes: ReadonlyMap<number, number>, from: number, to: number): number[] {
    motion.track();
    const moving: number[] = [];
    for (let tick = from; tick < to; tick++) {
        motion.taken(tick, takes.get(tick) ?? 0);
        if (motion.movingAt(tick)) moving.push(tick);
    }
    return moving;
}

describe("BeltLineMotion", () => {
    it("moves a turbo line 2 ticks a stack of four taken, from the tick of the take, and stops in the next", () => {
        expect(movingTicks(new BeltLineMotion(BeltSpeed.TURBO_TRANSPORT_BELT), new Map([[10, 1]]), 0, 20)).toEqual([10, 11, 12]);
        // a hand of four stacks taken a stack a tick: 9 ticks; two hands taken side by side: 17
        expect(movingTicks(new BeltLineMotion(BeltSpeed.TURBO_TRANSPORT_BELT), new Map([[0, 1], [1, 1], [2, 1], [3, 1]]), 0, 30)).toHaveLength(9);
        expect(movingTicks(new BeltLineMotion(BeltSpeed.TURBO_TRANSPORT_BELT), new Map([[0, 2], [1, 2], [2, 2], [3, 2]]), 0, 30)).toHaveLength(17);
    });

    it("closes a gap at the belt's speed: a stack in 8 ticks on a transport belt, 3 on an express belt (not checked in the game)", () => {
        expect(movingTicks(new BeltLineMotion(BeltSpeed.TRANSPORT_BELT), new Map([[0, 1]]), 0, 30)).toHaveLength(9);
        expect(movingTicks(new BeltLineMotion(BeltSpeed.EXPRESS_TRANSPORT_BELT), new Map([[0, 1]]), 0, 30)).toHaveLength(4);
    });

    it("keeps a take that empties no stack still, and keys the ticks it still moves; untracked, it keeps nothing", () => {
        const motion = new BeltLineMotion(BeltSpeed.TURBO_TRANSPORT_BELT);
        motion.taken(2, 1);
        expect(motion.movingAt(2)).toBe(false);
        expect(motion.key(2)).toBe("");
        motion.track();
        motion.taken(5, 0);
        expect(motion.movingAt(5)).toBe(false);
        expect(motion.key(5)).toBe("-1");
        motion.taken(6, 1);
        expect(motion.key(6)).toBe("2");
        expect(motion.key(8)).toBe("0");
        expect(motion.key(9)).toBe("-1");
    });
});

/**
 * The two lines of the turbo belt under backpressure of the sample metallurgic science build, recorded in Factorio 2.1.24
 * (crafting/fixtures/wake-ups-capture-metallurgic-science-2.1.24.json): the ticks the game moved each, against the takes of
 * the inserters that take from it, read off their hands (stacks of four: a rise of four is a stack emptied)
 */
describe("BeltLineMotion against the game", () => {
    interface Fixture {
        ticks: number;
        inserters: Record<string, { held: [number, number][] }>;
        belt_lines_moved: Record<string, { observed_from: number; moved: [number, number][] }>;
    }
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "crafting", "fixtures", "wake-ups-capture-metallurgic-science-2.1.24.json"), "utf8")) as Fixture;
    const held = (id: string): number[] => {
        const values: number[] = [];
        let at = 0;
        const changes = fixture.inserters[id].held;
        for (let tick = 0; tick < fixture.ticks; tick++) {
            while (at < changes.length && changes[at][0] <= tick) at++;
            values.push(changes[at - 1][1]);
        }
        return values;
    };

    it.each([
        ["belt:1:0", ["inserter:4", "inserter:5"]],
        ["belt:1:1", ["inserter:7"]],
    ])("moves %s in every tick the game moved it and in no other", (line, takers) => {
        const hands = takers.map(held);
        const takes = new Map<number, number>();
        for (let tick = 1; tick < fixture.ticks; tick++) {
            const stacks = hands.reduce((sum, hand) => sum + Math.floor((hand[tick] - hand[tick - 1]) / 4), 0);
            if (stacks > 0) takes.set(tick, stacks);
        }
        // the game moves a line in a tick when it was moving after the tick before; compared from 32 ticks after the
        // watch began, past any run of a take from before the fixture's first tick
        const { observed_from, moved } = fixture.belt_lines_moved[line];
        const from = observed_from + 32;
        const game = moved.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, index) => first + index))
            .filter(tick => tick >= from);
        const model = movingTicks(new BeltLineMotion(BeltSpeed.TURBO_TRANSPORT_BELT), takes, 0, fixture.ticks - 1).map(tick => tick + 1)
            .filter(tick => tick >= from);
        expect(game.length).toBeGreaterThan(4000);
        expect(model).toEqual(game);
    });
});
