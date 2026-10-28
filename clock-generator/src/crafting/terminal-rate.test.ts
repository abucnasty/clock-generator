import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { Entity } from "../entities";
import { judgeRecovery, runsOn } from "./backpressure-loss";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { buildOutputInsertersOf, type EntityTransferCountMap } from "./sequence/cycle/swing-counts";
import { targetItemOf } from "./sequence/cycle/target-ends";
import { atRateFrom, branchesScaledTo, cycleAtRate, firstBinAtRate, neverBlockingBranchesOf, type BranchBins } from "./terminal-rate";
import { traitsOf } from "../entities/traits/traits-of";

/** The branches of a sample, with every terminal output planned to move one hand of 16 a period */
async function branchesOf(path: string) {
    const config = await loadConfigFromFile(path);
    const registry = createEntityRegistryFromConfig(config);
    const target = targetItemOf(config.target_output);
    const outputs = registry.getAll().filter(Entity.isMachine).filter(machine => machine.output.item_name === target.item)
        .flatMap(machine => buildOutputInsertersOf(machine, registry));
    const swing_counts = { entries: () => outputs.map(inserter => [inserter.entity_id,
        { total_transfer_count: { toDecimal: () => 1 }, stack_size: 16 }]) } as unknown as EntityTransferCountMap;
    return neverBlockingBranchesOf(registry, traitsOf(config), swing_counts, 1, new Set(outputs.map(it => it.entity_id.id)));
}

describe("the branches of the terminal outputs into sinks that never block", () => {
    it("are the science plants' drains where they drop into infinity chests that remove all", async () => {
        expect(await branchesOf(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL_NO_BUFFERS)).toEqual([
            { source_id: "machine:1", inserter_ids: ["inserter:4"], share_per_period: 16, hand: 16 },
            { source_id: "machine:2", inserter_ids: ["inserter:3"], share_per_period: 16, hand: 16 },
        ]);
    });

    it("are none where the output goes onto a belt: it is judged exactly in every period", async () => {
        expect(await branchesOf(ConfigPaths.PROCESSING_UNITS_BELT_EXPORT)).toEqual([]);
    });

    it("keep each branch's part when judged on another count than the plan's", () => {
        const branches = [{ source_id: "a", inserter_ids: ["1"], share_per_period: 16, hand: 16 }, { source_id: "b", inserter_ids: ["2"], share_per_period: 48, hand: 16 }];
        expect(branchesScaledTo(branches, 32).map(branch => branch.share_per_period)).toEqual([8, 24]);
        expect(branchesScaledTo(branches, 64)).toEqual(branches);
    });
});

describe("a branch at its rate over the cycle", () => {
    const branch = (bins: number[], hand = 16, takes_surplus = true): BranchBins => ({ bins, share_per_bin: 16, hand, takes_surplus });

    it("may run a hand behind: none and then 32 is the share of 16 a period, two hands behind is not", () => {
        expect(atRateFrom([branch([16, 0, 32, 16, 0, 32])], 0)).toBe(true);
        expect(atRateFrom([branch([16, 0, 0, 48])], 0)).toBe(false);
    });

    it("may carry more than its share into a sink that takes the surplus, and no more than a hand over it into one that does not", () => {
        expect(atRateFrom([branch([32, 32, 16, 32])], 0)).toBe(true);
        expect(atRateFrom([branch([32, 32, 16, 32], 16, false)], 0)).toBe(false);
    });

    it("is exact in every bin where it has no hand to spare and no surplus is taken", () => {
        expect(atRateFrom([branch([16, 32, 0, 16], 0, false)], 0)).toBe(false);
        expect(atRateFrom([branch([16, 32, 16], 0, false)], 0)).toBe(false);
        expect(firstBinAtRate([branch([0, 16, 32, 0, 16, 16], 0, false)])).toBe(4);
    });

    it("does not let a surplus make up for a later shortfall: a hand ahead and then two short is two hands behind", () => {
        expect(atRateFrom([branch([16, 32, 0, 0, 16, 32])], 0)).toBe(false);
        // the output a science plant had stocked before the loss, handed on when it is restored, and then the bins the
        // loss left empty: back from the last of those, not from the first bin
        expect(firstBinAtRate([branch([32, 32, 16, 0, 0, 0, 16, 16, 16, 16])])).toBe(5);
    });

    it("starts after what a loss left behind", () => {
        // three empty bins after the loss, then the build is back and runs a hand behind now and then: the last of them
        // is within a hand of what follows
        expect(firstBinAtRate([branch([0, 0, 0, 16, 32, 0, 16, 32, 0, 16])])).toBe(2);
    });

    it("falls no further behind where it repeats forever", () => {
        expect(cycleAtRate([branch([32, 0])])).toBe(true);
        expect(cycleAtRate([branch([16, 0])])).toBe(false);
        expect(cycleAtRate([branch([32, 16])])).toBe(true);
        expect(cycleAtRate([branch([32, 16], 16, false)])).toBe(false);
    });
});

describe("recovery where every terminal output drops into a sink that never blocks", () => {
    // the drains of the no-buffer science build: each branch hands its surplus on a hand at a time
    const branches = (a: number[], b: number[]): BranchBins[] => [
        { bins: a, share_per_bin: 16, hand: 16, takes_surplus: true }, { bins: b, share_per_bin: 16, hand: 16, takes_surplus: true }];
    const a = [0, 0, 16, 16, 32, 0, 16, 16, 16, 32, 0, 16, 16, 16];
    const b = [0, 16, 16, 32, 0, 16, 16, 16, 16, 16, 32, 0, 16, 16];
    const total = a.map((items, at) => items + b[at]);

    it("is back at the rate of every branch, not an exact count in every period", () => {
        expect(judgeRecovery(total, 32, null, 8, branches(a, b))).toMatchObject({ recovers: true, recovered_after_bins: 1 });
    });

    it("stays exact in every period where the output can block (no branches: a belt, a chest that fills)", () => {
        expect(judgeRecovery(total, 32, null, 8).recovers).toBe(false);
    });

    it("is back where a science plant makes a little more than its share and its drain hands the surplus on", () => {
        // a hand over its share every 14 periods, for the longest a trial runs on: 14 hands ahead by its end
        const ahead = Array.from({ length: 200 }, (_, at) => at % 14 === 13 ? 32 : 16);
        expect(judgeRecovery(ahead.map(items => items * 2), 32, null, 40, branches(ahead, ahead)).recovers).toBe(true);
    });

    it("does not run on a trial that is at the rate before the late mark", () => {
        const late = Array(40).fill(16);
        expect(runsOn(late.map(items => items * 2), 32, null, 32, 8, branches(late, late))).toBe(false);
    });
});
