import { describe, expect, it } from "vitest";
import { branchDeliveryGate } from "./science-ledger";

const SHARE = 32;
const HAND = 16;

/** A report whose four branches all have the gate `gate` */
function reportOf(gate: "rate" | "exact") {
    return { share_per_period: SHARE, hand: HAND, topology: { branches: [0, 1, 2, 3].map(() => ({ gate })) } };
}

/** Periods of four branches; the branch under test delivers its share plus `deltas`, the other three exactly their share */
function periodsOf(deltas: number[]): number[][] {
    return deltas.map(delta => [SHARE + delta, SHARE, SHARE, SHARE]);
}

function judge(gate: "rate" | "exact", deltas: number[]) {
    const result = branchDeliveryGate(reportOf(gate), periodsOf(deltas));
    return { result, branch: result.branches[0] };
}

describe("branchDeliveryGate counts a rate branch's fall from its best running total", () => {
    it("passes a branch that delivers its share every period", () => {
        const { result } = judge("rate", [0, 0, 0, 0]);
        expect(result.passes).toBe(true);
    });

    it("passes a branch that falls one hand below its start", () => {
        const { branch } = judge("rate", [-16, 0, 0]);
        expect(branch.passes).toBe(true);
        expect(branch.lowest_ahead).toBe(-16);
    });

    it("fails a branch that falls 1.5 hands below its start", () => {
        const { branch, result } = judge("rate", [-24, 0, 0]);
        expect(branch.passes).toBe(false);
        expect(branch.first_period_beyond_hand).toBe(0);
        expect(result.passes).toBe(false);
    });

    it("passes a branch that runs a hand ahead and falls back one hand", () => {
        const { branch } = judge("rate", [16, -16, 0, 0]);
        expect(branch.passes).toBe(true);
        expect(branch.highest_ahead).toBe(16);
        expect(branch.lowest_ahead).toBe(0);
    });

    it("fails a branch that runs a hand ahead and falls back 1.5 hands, which the start of the span does not count", () => {
        const { branch } = judge("rate", [16, -24, 0, 0]);
        // 8 below its start, within a hand of it, but 24 below its best running total
        expect(branch.lowest_ahead).toBe(-8);
        expect(branch.first_period_beyond_hand).toBe(1);
        expect(branch.passes).toBe(false);
    });

    it("fails a branch that runs two hands ahead and falls back to its start: the surplus does not hide the fall", () => {
        const { branch } = judge("rate", [32, -32, 0]);
        expect(branch.highest_ahead).toBe(32);
        expect(branch.lowest_ahead).toBe(0);
        expect(branch.first_period_beyond_hand).toBe(1);
        expect(branch.passes).toBe(false);
    });

    it("lets a surplus stand: a branch that only runs ahead passes", () => {
        const { branch } = judge("rate", [16, 16, 16]);
        expect(branch.passes).toBe(true);
        expect(branch.surplus).toBe(48);
    });

    it("reports each branch on its own", () => {
        const periods = [[SHARE, SHARE - 24, SHARE, SHARE], [SHARE, SHARE, SHARE, SHARE]];
        const result = branchDeliveryGate(reportOf("rate"), periods);
        expect(result.branches.map(branch => branch.passes)).toEqual([true, false, true, true]);
        expect(result.passes).toBe(false);
    });
});

describe("branchDeliveryGate keeps the exact check for a branch into a buffer", () => {
    it("passes a branch that delivers exactly its share in every period", () => {
        expect(judge("exact", [0, 0, 0]).branch.passes).toBe(true);
    });

    it("fails a branch that is one item off in a period", () => {
        const { branch } = judge("exact", [0, -1, 0]);
        expect(branch.passes).toBe(false);
        expect(branch.first_period_off_share).toBe(1);
    });
});

describe("branchDeliveryGate checks what it is given", () => {
    it("refuses a report without four branch gates", () => {
        expect(() => branchDeliveryGate({ share_per_period: SHARE, hand: HAND, topology: { branches: [] } }, periodsOf([0]))).toThrow();
    });

    it("refuses a period that does not have four deliveries", () => {
        expect(() => branchDeliveryGate(reportOf("rate"), [[SHARE, SHARE]])).toThrow();
    });
});
