import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { fraction } from "../data-types/fraction";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { TargetProductionRate } from "./target-production-rate";
import { binomialQuantile, excessAtLevel, randomAmountMargins } from "./random-margins";
import { ConfigPaths } from "../config/config-paths";

// the exact-speed recycler cell of the ore voider benchmark (save F), planned at 400 iron ore a second destroyed
const FIXTURE = ConfigPaths.REAL_OWNER_ORE_VOIDER_EXACT_SPEED;

async function marginsOf(windows: Map<string, OpenRange[]>) {
    const config = await loadConfigFromFile(FIXTURE);
    const registry = createEntityRegistryFromConfig(config);
    const plan = CraftingCyclePlan.create(TargetProductionRate.fromConfig(config.target_output), registry, config, fraction(1));
    // 12 cycles of 12 ticks
    return randomAmountMargins(plan, registry, windows, 144, 12);
}

const feeders = (ranges: OpenRange[]) => new Map(["inserter:3", "inserter:4", "inserter:5", "inserter:6"].map(id => [id, ranges] as const));

describe("the room of the windows that carry a result that comes by chance", () => {
    it("is counted against the spread of a period's returns: 320 ore on average, 15.5 of standard deviation", async () => {
        // two windows each that fit 8 hands of 8 ticks: 16 a period against the 10 planned
        const windows = new Map([...feeders([OpenRange.from(0, 119)]),
            ["inserter:1", [OpenRange.from(0, 56), OpenRange.from(72, 128)]], ["inserter:2", [OpenRange.from(0, 56), OpenRange.from(72, 128)]]]);
        const { margins, crafting, windows: lengthened } = await marginsOf(windows);
        expect(margins).toHaveLength(1);
        const [ore] = margins;
        expect(ore.inserter_ids).toEqual(["inserter:1", "inserter:2"]);
        expect(ore.crafts).toBe(1280);
        expect(ore.expected_items).toBe(320);
        // a binomial of 1280 crafts at 1/4: sqrt(1280 x 3/16); its 0.99865 quantile is 367, 47 over the mean
        expect(ore.sigma_items).toBeCloseTo(15.4919, 4);
        expect(ore.needed_items).toBe(47);
        expect(ore.room_items).toBe(2 * 6 * 16);
        expect(ore.added_hands).toBe(0);
        expect(lengthened.get("inserter:1")).toBe(windows.get("inserter:1"));
        // the recycler: 1296 crafts a period against 1280, one standard deviation; its spare covers what comes back over
        // the mean in 1233 ticks (137 crafts against the 137 over the mean of a binomial of 10,960 rolls at 1/4)
        expect(crafting).toEqual([{ machine_id: 1, crafts: 1280, capacity: 1296, sigma_crafts: ore.sigma_items,
            sigmas: expect.closeTo(1.0328, 4), ticks_to_cover: 1233 }]);
    });

    it("gets the hands it is short of three standard deviations, a swing more on as many windows", async () => {
        // ten windows of 7 ticks each: one hand each, the ten planned, no room
        const one_hand_each = Array.from({ length: 10 }, (_, k) => OpenRange.from(k * 14, k * 14 + 6));
        const windows = new Map([...feeders([OpenRange.from(0, 119)]), ["inserter:1", one_hand_each], ["inserter:2", one_hand_each]]);
        const { margins, windows: lengthened } = await marginsOf(windows);
        // 47 ore short over two inserters: 2 hands of 16 each
        expect(margins[0].added_hands).toBe(2);
        expect(margins[0].room_items).toBe(64);
        expect(margins[0].room_items).toBeGreaterThanOrEqual(margins[0].needed_items);
        // the first and the sixth window a swing longer, where they run into the next
        expect(lengthened.get("inserter:1")!.map(range => [range.start_inclusive, range.end_inclusive]))
            .toEqual([[0, 20], [28, 34], [42, 48], [56, 62], [70, 90], [98, 104], [112, 118], [126, 132]]);
    });
});

describe("what a period gives of a result over its mean, in all but 1 in 740 periods", () => {
    it("is the binomial's own quantile less the mean, past 3 sigma where the count is small", () => {
        // recorded on a recycler on scrap: 10 holmium ore or more in 378 crafts at 1/100 came 4 times as often as 3 sigma says
        expect(binomialQuantile(378, 0.01)).toBe(11);
        expect(378 * 0.01 + 3 * Math.sqrt(378 * 0.01 * 0.99)).toBeCloseTo(9.58, 2);
        expect(binomialQuantile(1280, 0.25)).toBe(367);
        expect(binomialQuantile(100, 0.5)).toBe(65);
        // a count that hardly ever comes needs no room
        expect(binomialQuantile(10, 0.0001)).toBe(0);
        expect(binomialQuantile(0, 0.25)).toBe(0);
        expect(binomialQuantile(10, 1)).toBe(10);
    });

    it("follows each shape of a result's yield", () => {
        const result = (amount: number, extras: Record<string, unknown>) => ({ name: "iron-plate", type: "item", amount, ...extras }) as never;
        // recycled iron ore: itself at 1/4
        expect(excessAtLevel(result(1, { independent_probability: 0.25 }), 1280)).toBe(47);
        // a gear recycled: an amount of 0 and a plate at 1/2
        expect(excessAtLevel(result(0, { extra_count_fraction: 0.5 }), 100)).toBe(15);
        // always 2, and one more at 1/2: 200 and a binomial of 100 at 1/2 over 250
        expect(excessAtLevel(result(2, { extra_count_fraction: 0.5 }), 100)).toBe(15);
        // 3 at 1/2: three times a binomial of 100 at 1/2
        expect(excessAtLevel(result(3, { independent_probability: 0.5 }), 100)).toBe(45);
        // rolls that are not whole are rounded up
        expect(excessAtLevel(result(1, { independent_probability: 0.25 }), 1279.5)).toBe(47);
    });
});
