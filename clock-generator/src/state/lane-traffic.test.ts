import { describe, expect, it } from "vitest";
import { LaneTraffic } from "./lane-traffic";
import { RECORDED_PACK_HANDS } from "./lane-traffic.fixture";

/** Ticks of belt travel from the first tile edge to the drop spot: 8 ticks a tile on a turbo belt */
const SPOT_TICKS: Record<number, number> = { 3: 4, 9: 52, 18: 100, 24: 140 };
/** Ticks from a full hand to its first try at a stack: the swing */
const SWING = 4;

/** The lane starts empty here, as the recording's earlier traffic is not in the fixture: its first stacks need 142 ticks to settle */
const WARM_UP = 150;

/** Replays the hands of the recording on one lane, each inserter trying one stack a tick from the swing after its hand is full */
function replay(): Map<string, number[]> {
    const lane = new LaneTraffic();
    Object.values(SPOT_TICKS).forEach(it => lane.registerSpot(it));
    const queues = new Map<number, typeof RECORDED_PACK_HANDS[number][]>();
    for (const hand of RECORDED_PACK_HANDS) {
        queues.set(hand.inserter, [...(queues.get(hand.inserter) ?? []), hand]);
    }
    const placed = new Map<number, number[]>();
    const last_tick = Math.max(...RECORDED_PACK_HANDS.flatMap(it => it.stacks)) + 1;
    const result = new Map<string, number[]>();
    for (let tick = 0; tick <= last_tick; tick++) {
        for (const inserter of Object.keys(SPOT_TICKS).map(Number)) {
            const hand = queues.get(inserter)![0];
            if (hand === undefined || tick < hand.full + SWING) {
                continue;
            }
            const stacks = placed.get(inserter) ?? [];
            if (lane.tryPlace(tick, SPOT_TICKS[inserter])) {
                stacks.push(tick);
            }
            placed.set(inserter, stacks);
            if (stacks.length === 4) {
                if (hand.full >= WARM_UP) result.set(`${inserter}@${hand.full}`, stacks);
                placed.delete(inserter);
                queues.get(inserter)!.shift();
            }
        }
    }
    return result;
}

describe("LaneTraffic", () => {
    it("puts the stacks of a lone hand down at +0, +1, +2 and +4, as a free lane does", () => {
        const lane = new LaneTraffic();
        lane.registerSpot(100);
        const ticks = [0, 1, 2, 3, 4].filter(tick => lane.tryPlace(tick, 100));
        expect(ticks).toEqual([0, 1, 2, 4]);
    });

    it("makes a hand wait for a train of stacks that passes its spot and go in behind it at 2 ticks apart", () => {
        const lane = new LaneTraffic();
        lane.registerSpot(140);
        // a train upstream: stacks 2 ticks apart, 8 ticks long, that reaches the spot at 100 ticks, 40 after the first
        [0, 2, 4, 6].forEach(origin => expect(lane.tryPlace(origin + 52, 52)).toBe(true));
        // the train passes the spot at 140 + origin; a hand there at 140 meets stacks of origins 0..6
        const ticks = Array.from({ length: 14 }, (_, i) => 140 + i).filter(tick => lane.tryPlace(tick, 140));
        expect(ticks.slice(0, 4)).toEqual([146, 148, 150, 152]);
    });

    it("forgets the stacks that have passed the last spot", () => {
        const lane = new LaneTraffic();
        lane.registerSpot(100);
        lane.tryPlace(0, 100);
        expect(lane.stateKey(1)).toBe("-101");
        expect(lane.stateKey(500)).toBe("");
    });

    it("forgets by the last spot also when every position is negative", () => {
        const lane = new LaneTraffic();
        lane.registerSpot(-752);
        expect(lane.tryPlace(0, -752)).toBe(true);
        expect(lane.stateKey(1)).toBe("751");
        expect(lane.stateKey(10)).toBe("");
    });

    it("gives the stack ticks of each of the recorded hands of the four pack inserters, slow drops included", () => {
        const replayed = replay();
        const recorded = new Map(RECORDED_PACK_HANDS.filter(it => it.full >= WARM_UP).map(it => [`${it.inserter}@${it.full}`, [...it.stacks]]));
        expect(replayed.size).toBe(recorded.size);
        expect(Object.fromEntries(replayed)).toEqual(Object.fromEntries(recorded));
    });

    it("has the 6, 14 and 22 tick drops among them", () => {
        const durations = [...replay().values()].map(it => it[3] - it[0]);
        expect(durations.filter(it => it === 4)).toHaveLength(33);
        expect(durations.filter(it => it === 6)).toHaveLength(2);
        expect(durations).toContain(14);
        expect(durations).toContain(22);
    });
});
