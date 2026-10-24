import { describe, expect, it } from "vitest";
import * as path from "path";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { fraction } from "../data-types/fraction";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { TargetProductionRate } from "./target-production-rate";
import { randomAmountMargins, RANDOM_MARGIN_SIGMAS } from "./random-margins";

// the exact-speed recycler cell of the ore voider benchmark (save F), planned at 400 iron ore a second destroyed
const FIXTURE = path.join(__dirname, "fixtures", "ore-voider-F-recycler.json");

async function marginsOf(windows: Map<string, OpenRange[]>) {
    const config = await loadConfigFromFile(FIXTURE);
    const registry = createEntityRegistryFromConfig(config);
    const plan = CraftingCyclePlan.create(TargetProductionRate.fromConfig(config.target_output), registry, fraction(1));
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
        // a binomial of 1280 crafts at 1/4: sqrt(1280 x 3/16)
        expect(ore.sigma_items).toBeCloseTo(15.4919, 4);
        expect(ore.room_items).toBe(2 * 6 * 16);
        expect(ore.added_hands).toBe(0);
        expect(lengthened.get("inserter:1")).toBe(windows.get("inserter:1"));
        // the recycler: 1296 crafts a period against 1280, one standard deviation; three of them over 1216 ticks
        expect(crafting).toEqual([{ machine_id: 1, crafts: 1280, capacity: 1296, sigma_crafts: ore.sigma_items,
            sigmas: expect.closeTo(1.0328, 4), ticks_to_cover: 1216 }]);
    });

    it("gets the hands it is short of three standard deviations, a swing more on as many windows", async () => {
        // ten windows of 7 ticks each: one hand each, the ten planned, no room
        const one_hand_each = Array.from({ length: 10 }, (_, k) => OpenRange.from(k * 14, k * 14 + 6));
        const windows = new Map([...feeders([OpenRange.from(0, 119)]), ["inserter:1", one_hand_each], ["inserter:2", one_hand_each]]);
        const { margins, windows: lengthened } = await marginsOf(windows);
        // 46.5 ore short over two inserters: 2 hands of 16 each
        expect(margins[0].added_hands).toBe(2);
        expect(margins[0].room_items).toBe(64);
        expect(margins[0].sigmas).toBeGreaterThanOrEqual(RANDOM_MARGIN_SIGMAS);
        // the first and the sixth window a swing longer, where they run into the next
        expect(lengthened.get("inserter:1")!.map(range => [range.start_inclusive, range.end_inclusive]))
            .toEqual([[0, 20], [28, 34], [42, 48], [56, 62], [70, 90], [98, 104], [112, 118], [126, 132]]);
    });
});
