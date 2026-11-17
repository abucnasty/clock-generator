import { describe, expect, it } from "vitest";
import { BeltSpeed } from "../entities/belt";
import { BackpressurePickupLane } from "./backpressure-pickup-lane";
import { BeltPickupLane } from "./belt-pickup-lane";
import { BeltPickupStock } from "./belt-pickup-stock";
import { SharedLane } from "./shared-lane";

const ratio = (numerator: number, denominator = 1) => ({ numerator, denominator });
const TURBO = BeltSpeed.TURBO_TRANSPORT_BELT;

/** A run of takes: in each tick a hand of `capacity` takes when `takes(tick)`; what each stock gave, tick by tick */
function takesOf(stocks: BeltPickupStock[], ticks: number, takes: (tick: number) => boolean, capacity = 4): number[][] {
    return stocks.map(stock => Array.from({ length: ticks }, (_, tick) => takes(tick) ? stock.take(tick, capacity) : 0));
}

/** A pattern of hands: 16 items taken in a burst every `period` ticks, from `start` on */
const bursts = (period: number, start = 3) => (tick: number) => tick >= start && (tick - start) % period < 6;

describe("a shared lane with one taker", () => {
    it("is the backpressure pickup lane where the lane dead-ends at the end of the reach and the entry keeps up", () => {
        for (const period of [7, 20, 61]) {
            const lane = new SharedLane({ belt_speed: TURBO, stack_size: 4, supply_rate: ratio(120), lane_end: { kind: "dead_end" }, length_tiles: 6 });
            const [shared, alone] = takesOf([lane.reachOf(6, 1), new BackpressurePickupLane(TURBO, 1, 4)], 400, bursts(period));
            expect(shared).toEqual(alone);
        }
    });

    it("is the moving pickup lane where the lane runs on into an infinite end", () => {
        for (const period of [7, 20, 61]) {
            const lane = new SharedLane({ belt_speed: TURBO, stack_size: 4, supply_rate: ratio(120),
                lane_end: { kind: "infinite" }, length_tiles: 6 });
            const [shared, alone] = takesOf([lane.reachOf(6, 1), new BeltPickupLane(TURBO, 1, 4, 0)], 400, bursts(period));
            expect(shared.reduce((a, b) => a + b, 0)).toBe(alone.reduce((a, b) => a + b, 0));
            expect(shared).toEqual(alone);
        }
    });
});

describe("a shared lane with takers in a row", () => {
    it("refills a dead end from the entry at the supply rate, and a taker upstream takes first", () => {
        const lane = new SharedLane({ belt_speed: TURBO, stack_size: 4, supply_rate: ratio(30), lane_end: { kind: "dead_end" }, length_tiles: 4 });
        const upstream = lane.reachOf(2, 1), downstream = lane.reachOf(4, 1);
        const take = (stock: BeltPickupStock, from: number, to: number) => {
            let taken = 0;
            for (let tick = from; tick < to; tick++) taken += stock.take(tick, 4);
            return taken;
        };
        // the stretch upstream empties first; the lane then brings what the entry puts on, 30 a second
        expect(take(upstream, 1, 61)).toBeGreaterThan(take(downstream, 61, 62));
        expect(lane.supplied).toBeLessThanOrEqual(30 + 4);
    });

    it("holds no more than the lane holds, and loses nothing at a dead end", () => {
        const lane = new SharedLane({ belt_speed: TURBO, stack_size: 4, supply_rate: ratio(120), lane_end: { kind: "dead_end" }, length_tiles: 3 });
        const reach = lane.reachOf(3, 1);
        const start = lane.items();
        let taken = 0;
        for (let tick = 1; tick <= 120; tick++) taken += tick % 3 === 0 ? reach.take(tick, 16) : 0;
        lane.advanceTo(120);
        expect(start + lane.supplied - lane.drained - taken).toBe(lane.items());
        expect(lane.items()).toBeLessThanOrEqual(13 * 4);
        expect(lane.drained).toBe(0);
    });

    it("lets an infinite end take the lane's capacity off a lane nobody takes from", () => {
        const lane = new SharedLane({ belt_speed: TURBO, stack_size: 4, supply_rate: ratio(120), lane_end: { kind: "infinite" }, length_tiles: 3 });
        lane.advanceTo(600);
        // 120 a second, a turbo lane of stacks of 4, over 10 seconds, give or take the stack in the bank
        expect(Math.abs(lane.drained - 1200)).toBeLessThanOrEqual(4);
    });

    it("refuses lines on a lane with an infinite end: the lines run to a dead end only", () => {
        expect(() => new SharedLane({ belt_speed: TURBO, stack_size: 4, supply_rate: ratio(120), lane_end: { kind: "infinite" }, length_tiles: 8,
            lines: { cuts_tiles: [2, 4, 6] } })).toThrow(/dead end/);
    });

    it("takes one stack a tick for each reach", () => {
        const lane = new SharedLane({ belt_speed: TURBO, stack_size: 4, supply_rate: ratio(120), lane_end: { kind: "dead_end" }, length_tiles: 3 });
        const reach = lane.reachOf(3, 1);
        expect(reach.take(5, 16)).toBe(4);
        expect(reach.hasTakenAt(5)).toBe(true);
        expect(reach.take(5, 16)).toBe(0);
        expect(reach.take(6, 2)).toBe(2);
        expect(reach.peek(6)?.count).toBe(2);
    });
});

/**
 * A lane of four lines, A to D downstream, cut at 2, 4 and 6 tiles: a full dead end of 8 tiles, as the game cuts a lane
 * at its underground entrances (SharedLaneLines)
 */
describe("a shared lane in lines", () => {
    const args = { belt_speed: TURBO, stack_size: 4, supply_rate: ratio(120), lane_end: { kind: "dead_end" }, length_tiles: 8 } as const;
    const lanes = () => ({ one: new SharedLane(args), lines: new SharedLane({ ...args, lines: { cuts_tiles: [2, 4, 6] } }) });
    /** Where every stack stands, tick by tick: as the reach of the whole lane sees them */
    const positions = (lane: SharedLane, tick: number) => lane.reachOf(8, 8).snapshot(tick).map(([position]) => position);

    it("starts full and standing, as one line does", () => {
        const { one, lines } = lanes();
        for (let tick = 0; tick < 10; tick++) expect(positions(lines, tick)).toEqual(positions(one, tick));
    });

    it("keeps a follower waiting one tick at a line's end where its line was updated while the leader's line was off the list", () => {
        const { one, lines } = lanes();
        for (const lane of [one, lines]) {
            // a take in line A (1 to 2 tiles) puts A on the list; a tick later a take in line D puts D and C on after it, while B
            // stands off the list: A is updated first and cannot move, B goes on only when C moves, and A has had its tick
            expect(lane.reachOf(2, 1).take(10, 4)).toBe(4);
            expect(lane.reachOf(8, 1).take(11, 4)).toBe(4);
        }
        // up to the take in D the two agree; in the tick after it the stacks of A between its gap and B's first stack stand in
        // the lane of lines and move in the one line: one tick, and then they agree again for good
        for (let tick = 10; tick <= 11; tick++) expect(positions(lines, tick)).toEqual(positions(one, tick));
        const waits = positions(lines, 12), moves = positions(one, 12);
        expect(waits).not.toEqual(moves);
        const at_a = (list: number[]) => list.filter(position => position >= 6 * 256 && position < 7 * 256);
        // the leader at A's downstream end (6 tiles upstream of the reach's edge) waits, the one line has it moved
        expect(at_a(waits)[0]).toBe(6 * 256);
        expect(at_a(moves)[0]).toBeLessThan(6 * 256);
        for (let tick = 14; tick < 40; tick++) expect(positions(lines, tick)).toEqual(positions(one, tick));
    });

    it("invents no wait where a pickup puts its line and the line feeding it on: takes downstream alone move the lines as one line", () => {
        const { one, lines } = lanes();
        const taken = [one, lines].map(lane => {
            const reaches = [lane.reachOf(8, 1), lane.reachOf(5, 1), lane.reachOf(3, 1)];
            return Array.from({ length: 600 }, (_, tick) => reaches.map((reach, at) => tick % (11 + 4 * at) === at ? reach.take(tick, 4) : 0));
        });
        expect(taken[1]).toEqual(taken[0]);
        for (let tick = 600; tick < 620; tick++) expect(positions(lines, tick)).toEqual(positions(one, tick));
    });

    it("keys the lines on the list and the takes of the tick, so that two lanes that will move apart do not key alike", () => {
        const { lines } = lanes();
        const other = new SharedLane({ ...args, lines: { cuts_tiles: [2, 4, 6] } });
        lines.advanceTo(5);
        other.advanceTo(5);
        expect(lines.key()).toBe(other.key());
        lines.reachOf(8, 1).take(5, 4);
        other.reachOf(8, 1).take(5, 4);
        expect(lines.key()).toBe(other.key());
        expect(lines.key()).not.toBe(new SharedLane(args).key());
    });
});
