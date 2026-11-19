import { describe, expect, it } from "vitest";
import { BeltSpeed } from "../entities/belt";
import { BackpressurePickupLane } from "./backpressure-pickup-lane";
import { BeltPickupLane } from "./belt-pickup-lane";
import { BeltPickupStock } from "./belt-pickup-stock";
import { dropLanding, SharedLane, SharedLaneFeeder } from "./shared-lane";

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

/** The automation science 240 scaffold's copper feeders: legendary stack inserters a tile apart, hands of 16 */
const FEEDERS: SharedLaneFeeder[] = [
    { spot_tiles: 0, hand_items: 16, rotation_ticks: 3, pickup_ticks: 1 },
    { spot_tiles: 1, hand_items: 16, rotation_ticks: 3, pickup_ticks: 1 },
];

describe("a stack put down on a moving lane", () => {
    // a turbo lane steps 32 units a tick; a stack takes 64; positions increase downstream
    const SPOT = 128, STEP = 32;

    it("lands a belt step past its spot where nothing is near", () => {
        expect(dropLanding(SPOT, STEP, [])).toBe(SPOT + STEP);
        expect(dropLanding(SPOT, STEP, [{ x: SPOT + STEP + 64 }])).toBe(SPOT + STEP);
    });

    it("lands a quarter tile behind the stack ahead, but only strictly less than a quarter tile behind its spot", () => {
        expect(dropLanding(SPOT, STEP, [{ x: SPOT + 64 }])).toBe(SPOT);
        expect(dropLanding(SPOT, STEP, [{ x: SPOT + 32 }])).toBe(SPOT - 32);
        expect(dropLanding(SPOT, STEP, [{ x: SPOT + 32 }, { x: SPOT - 32 }])).toBeNull();
    });

    it("is not pushed back by a stack one belt step upstream of its landing, as the game's gear feeders show", () => {
        expect(dropLanding(SPOT, STEP, [{ x: SPOT + 96 }, { x: SPOT }])).toBe(SPOT + 32);
        expect(dropLanding(SPOT, STEP, [{ x: SPOT + 96 }, { x: SPOT + 32 }])).toBe(SPOT - 32);
    });
});

describe("a shared lane fed by feeders", () => {
    it("starts full as its feeders fill it, the first feeder's last stack up to 1/8 tile upstream of its spot", () => {
        const lane = new SharedLane({ belt_speed: TURBO, stack_size: 4, supply_rate: ratio(120), lane_end: { kind: "dead_end" }, length_tiles: 11, feeders: FEEDERS });
        const stacks = lane.stackPositions();
        expect(stacks[0]).toEqual([11, 4]);
        expect(stacks.at(-1)![0]).toBeGreaterThan(-0.25);
        stacks.slice(1).forEach(([tiles], index) => expect(stacks[index][0] - tiles).toBe(0.25));
        expect(lane.supplied).toBe(0);
        expect(lane.initial).toBe(lane.items());
    });

    it("loses nothing: what is on the lane is what the feeders put on less what the takers took", () => {
        const lane = new SharedLane({ belt_speed: TURBO, stack_size: 4, supply_rate: ratio(120), lane_end: { kind: "dead_end" }, length_tiles: 11, feeders: FEEDERS });
        const reaches = [lane.reachOf(6, 1), lane.reachOf(11, 1)];
        let taken = 0;
        for (let tick = 1; tick <= 600; tick++) for (const reach of reaches) taken += bursts(20)(tick) ? reach.take(tick, 16) : 0;
        lane.advanceTo(600);
        expect(taken).toBeGreaterThan(0);
        expect(lane.supplied).toBeGreaterThan(0);
        expect(lane.initial + lane.supplied - taken).toBe(lane.items());
    });

    it("stands its feeders while the entry is closed, hands and arms as they were", () => {
        const lane = new SharedLane({ belt_speed: TURBO, stack_size: 4, supply_rate: ratio(120), lane_end: { kind: "dead_end" }, length_tiles: 11, feeders: FEEDERS });
        const reach = lane.reachOf(1.5, 1);
        for (let tick = 1; tick <= 40; tick++) reach.take(tick, 16);
        lane.closeEntry(40);
        const key = lane.key().split(";").slice(0, 2).join(";");
        const supplied = lane.supplied;
        for (let tick = 41; tick <= 100; tick++) reach.take(tick, 16);
        expect(lane.key().split(";").slice(0, 2).join(";")).toBe(key);
        expect(lane.supplied).toBe(supplied);
        lane.openEntry(100);
        lane.advanceTo(110);
        expect(lane.supplied).toBeGreaterThan(supplied);
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

    it("refuses lines on a lane with an infinite end, or line ends outside the lane or out of order", () => {
        expect(() => new SharedLane({ ...args, lane_end: { kind: "infinite" }, lines: { cuts_tiles: [2, 4, 6] } })).toThrow(/dead end/);
        expect(() => new SharedLane({ ...args, lines: { cuts_tiles: [2, 8] } })).toThrow(/go up inside it/);
        expect(() => new SharedLane({ ...args, lines: { cuts_tiles: [4, 2] } })).toThrow(/go up inside it/);
    });

    it("starts full and standing, as one line does", () => {
        const { one, lines } = lanes();
        for (let tick = 0; tick < 10; tick++) expect(positions(lines, tick)).toEqual(positions(one, tick));
    });

    it("keeps a follower waiting one tick at a line's end where its line was updated while the leader's line was off the list", () => {
        // a take in line A (1 to 2 tiles) puts A on the list; a tick later a take in line D puts D and C on after it, while B
        // stands off the list: A is updated first and cannot move, B goes on only when C moves, and A has had its tick
        const [one_line, in_lines] = Object.values(lanes()).map(lane => Array.from({ length: 40 }, (_, tick) => {
            if (tick === 10) expect(lane.reachOf(2, 1).take(10, 4)).toBe(4);
            if (tick === 11) expect(lane.reachOf(8, 1).take(11, 4)).toBe(4);
            return positions(lane, tick);
        }));
        // up to the take in D the two agree; in the tick after it the stack at A's downstream end (2 tiles from the entry, 6
        // from the reach's edge) stands in the lane of lines and moves in the one line: one tick, then they agree again for good
        expect(in_lines.slice(0, 12)).toEqual(one_line.slice(0, 12));
        expect(in_lines[12]).toContain(6 * 256);
        expect(one_line[12]).not.toContain(6 * 256);
        expect(in_lines.slice(14)).toEqual(one_line.slice(14));
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

    it("puts the line a feeder drops onto on the list: a lane fed by feeders loses nothing in lines", () => {
        const fed = new SharedLane({ ...args, length_tiles: 11, feeders: FEEDERS, lines: { cuts_tiles: [3, 7] } });
        const reaches = [fed.reachOf(6, 1), fed.reachOf(11, 1)];
        let taken = 0;
        for (let tick = 1; tick <= 600; tick++) for (const reach of reaches) taken += bursts(20)(tick) ? reach.take(tick, 16) : 0;
        fed.advanceTo(600);
        expect(taken).toBeGreaterThan(0);
        expect(fed.supplied).toBeGreaterThan(0);
        expect(fed.initial + fed.supplied - taken).toBe(fed.items());
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
