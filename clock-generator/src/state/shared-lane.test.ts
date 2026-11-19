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
