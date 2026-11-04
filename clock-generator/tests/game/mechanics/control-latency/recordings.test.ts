import {describe, expect, test} from "vitest";
import {LATENCY_CASES} from "./cases";
import {loadRecording, rowsOf, statusName} from "./recording";

/**
 * The retained recording of the control latency run (control-latency.game.test.ts, probe.lua), read offline. Ticks are the
 * probe's samples, all taken at one point of each tick, so a difference between two of them counts the ticks between.
 * See README.md.
 */
const recording = loadRecording();

/** The first sample at or after `from` where `column` differs from its value in the sample before `from` */
function firstChange(cell: string, column: string, from: number): number {
    const rows = rowsOf(recording, cell);
    const before = rows.find(row => row.t === from - 1)![column];
    return rows.find(row => row.t >= from && row[column] !== before)!.t;
}

/** The switches of signal A in a cell's schedule */
const switches = (cell: string) => LATENCY_CASES.find(it => it.name === cell)!.schedule!.map(([tick]) => tick);

describe("an enable, by the inserter's state when it comes", () => {
    // [cell, the switch, the hand]: idle at a full chest; asleep at a machine that has room by then; a backed-up belt; two on one decider
    const enables: [string, number, number][] = [["chest", 60, 1], ["chest", 260, 1], ["chest-off-103", 143, 1], ["chest-off-107", 147, 1],
        ["machine-room", 160, 1], ["machine-room", 80, 2], ["belt-backed", 200, 1], ["pair", 60, 1], ["pair", 60, 2], ["pair-shared", 60, 2]];

    test.each(enables)("%s at %i, hand %i: output a tick after the decider's input, status a tick later, first items a tick after that", (cell, at, hand) => {
        const gate = cell === "machine-room" && hand === 2 ? 2 : 1;
        const input = firstChange(cell, `din${gate}`, at);
        expect(input).toBe(at + 1);
        expect(firstChange(cell, `dout${gate}`, at)).toBe(input + 1);
        expect(firstChange(cell, `dis${hand}`, at)).toBe(input + 2);
        expect(firstChange(cell, `held${hand}`, at)).toBe(input + 3);
    });

    test("over an empty belt: the status changes as over a chest, and the hand waits for the plates", () => {
        const input = firstChange("belt-empty", "din1", 60);
        expect(firstChange("belt-empty", "dis1", 60)).toBe(input + 2);
        expect(statusName(recording, rowsOf(recording, "belt-empty").find(row => row.t === input + 2)!.status1)).toBe("waiting_for_source_items");
        expect(firstChange("belt-empty", "held1", 60)).toBeGreaterThan(120);
    });

    test("two inserters on one decider and one hand's worth in their chest: the one built second takes it, in the tick the other would", () => {
        const rows = rowsOf(recording, "pair-shared");
        expect(firstChange("pair-shared", "held2", 60)).toBe(64);
        expect(rows.every(row => row.held1 === 0)).toBe(true);
    });
});

describe("a disable while the hand moves", () => {
    test.each([["chest", 160], ["chest-off-103", 103], ["chest-off-107", 107]] as const)("%s at %i: shown disabled 3 ticks later, the hand finishes its swing and drop and stops at its pickup", (cell, at) => {
        const disabled = firstChange(cell, "dis1", at);
        expect(disabled).toBe(at + 3);
        const rows = rowsOf(recording, cell).filter(row => row.t >= disabled && row.t < at + 40);
        // the hand still moves after it is shown disabled, then rests over its pickup, empty
        expect(rows.some((row, index) => index > 0 && (row.x1 !== rows[index - 1].x1 || row.y1 !== rows[index - 1].y1))).toBe(true);
        const rest = rows[rows.length - 1];
        expect(rest.held1).toBe(0);
        expect(rows.slice(-5).every(row => row.x1 === rest.x1 && row.y1 === rest.y1)).toBe(true);
    });
});

describe("an inserter asleep at a machine, woken by what another entity does in a tick", () => {
    test.each(["wake-take-100", "wake-take-101"])("%s: another inserter takes the machine off its output block; the first items come a tick after the take", cell => {
        const take = firstChange(cell, "held2", switches(cell)[0]);
        expect(firstChange(cell, "held1", switches(cell)[0])).toBe(take + 1);
    });

    test.each([70, 71, 72, 73])("craft-then-take-%i: a craft finishes at the block, the taker takes the output; the first items come a tick after the take, also when the craft finished in the tick before it", gate => {
        const cell = `craft-then-take-${gate}`;
        const finished = firstChange(cell, "finished", 70);
        const take = firstChange(cell, "held2", gate);
        expect(take - finished).toBe(gate - 71 + 1);
        expect(firstChange(cell, "held1", 56)).toBe(take + 1);
    });

    test("the machine's craft makes room under the insertion limit: the first items come a tick after the plates go down", () => {
        const rows = rowsOf(recording, "machine-craft");
        const room = rows.filter((row, index) => index > 0 && row.w1 < 8 && rows[index - 1].w1 >= 8).map(row => row.t);
        expect(room.length).toBeGreaterThanOrEqual(2);
        for (const tick of room) expect(firstChange("machine-craft", "held1", tick), `room at ${tick}`).toBe(tick + 1);
    });
});
