import { describe, expect, it } from "vitest";
import { BeltPickupLane } from "./belt-pickup-lane";
import { BeltSpeed } from "../entities/belt";

function grabs(lane: BeltPickupLane, count: number, start = 0): number[] {
    const ticks: number[] = [];
    for (let tick = start; tick < start + 100 && ticks.length < count; tick++) {
        if (lane.take(tick, 4) > 0) ticks.push(tick - start);
    }
    return ticks;
}

describe("reachable stacks on a moving pickup lane", () => {
    it("reproduces both turbo underground patterns from stream phase, without an endpoint penalty", () => {
        expect(grabs(new BeltPickupLane(BeltSpeed.TURBO_TRANSPORT_BELT, 0.5, 4), 4)).toEqual([0, 1, 3, 5]);
        expect(grabs(new BeltPickupLane(BeltSpeed.TURBO_TRANSPORT_BELT, 0.5, 4, 4), 4)).toEqual([0, 1, 2, 4]);
    });

    it("takes four consecutive stacks on a straight turbo belt in either phase", () => {
        for (const phase of [0, 4]) expect(grabs(new BeltPickupLane(BeltSpeed.TURBO_TRANSPORT_BELT, 1, 4, phase), 4)).toEqual([0, 1, 2, 3]);
    });

    it("predicts an express belt's non-integral stack arrival interval", () => {
        expect(grabs(new BeltPickupLane(BeltSpeed.EXPRESS_TRANSPORT_BELT, 0.5, 4), 4)).toEqual([0, 1, 3, 6]);
    });

    it("keeps holes across a closed window but forgets stacks that have passed", () => {
        const lane = new BeltPickupLane(BeltSpeed.TURBO_TRANSPORT_BELT, 0.5, 4);
        expect(grabs(lane, 2)).toEqual([0, 1]);
        expect(lane.take(2, 4)).toBe(0);
        expect(lane.take(3, 4)).toBe(4);
        expect(grabs(lane, 4, 20)).toEqual([0, 1, 3, 5]);
    });

    it("does not invent a second grab in one tick or lose the remainder of a partial stack", () => {
        const lane = new BeltPickupLane(BeltSpeed.TRANSPORT_BELT, 0.5, 4);
        expect(lane.take(0, 2)).toBe(2);
        expect(lane.take(0, 4)).toBe(0);
        expect(lane.take(1, 4)).toBe(4); // a new upstream stack arrives first
        expect(lane.take(2, 4)).toBe(2); // the partly taken stack is still there
    });

    it("has the same state after a translated stream cycle, including holes", () => {
        const lane = new BeltPickupLane(BeltSpeed.EXPRESS_TRANSPORT_BELT, 0.5, 4);
        lane.take(0, 4);
        const first = lane.stateKey(0);
        lane.take(16, 4);
        expect(lane.stateKey(16)).toBe(first);
        expect(lane.stateKey(17)).not.toBe(first);
    });
});
