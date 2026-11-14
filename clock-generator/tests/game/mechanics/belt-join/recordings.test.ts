import { describe, expect, test } from "vitest";
import { COPIES, layoutOf } from "./cases";
import { loadKept, replay } from "./recording";

/**
 * The kept copies of the belt join family (join.game.test.ts, probe.lua), read without Factorio: the join model fed with
 * each copy's put-on events and end changes gives every stack's line and position in every tick. See README.md.
 */
const kept = COPIES.filter(copy => copy.kept);

describe("the kept copies are what cases.ts says", () => {
    test.each(kept.map(copy => copy.name))("%s: recorded in Factorio 2.1 with stacks of 4, its lines as long as the model's", name => {
        const copy = COPIES.find(c => c.name === name)!;
        const recording = loadKept(name);
        expect(recording.factorio).toMatch(/^2\.1\./);
        expect(recording.belt_stack_size).toBe(4);
        const lengths = new Map(recording.lines);
        for (const line of layoutOf(copy).lines) expect(lengths.get(line.id), line.id).toBe(line.length);
    });
});

describe("the join model gives the game's rows", () => {
    test.each(kept.map(copy => copy.name))("%s: every stack's line and position in every tick", name => {
        const recording = loadKept(name);
        expect(replay(COPIES.find(c => c.name === name)!, recording)).toBeNull();
    });
});
