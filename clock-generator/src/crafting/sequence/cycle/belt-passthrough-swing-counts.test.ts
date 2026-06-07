import { describe, it, expect } from "vitest";
import { generateClockForConfig } from "../../generate-blueprint";
import { loadConfigFromFile } from "../../../config/loader";
import { ConfigPaths } from "../../../config/config-paths";

/**
 * Regression test for machine -> belt -> machine flows where a belt is used as an
 * internal buffer between machines (as opposed to an external input/output belt).
 *
 * The casting machines (iron-gear-wheel, copper) drop onto a shared belt, which is
 * then drained into the automation-science-pack machine. The output inserters that
 * fill the buffer belt must receive transfer counts via the swing-count recursion,
 * otherwise downstream processing throws "No value found for key inserter:1".
 */
describe("belt used as an internal buffer between machines", async () => {
    const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_BELTED_INTERNAL_BUFFER);
    const result = generateClockForConfig(config);

    const transferMap = result.crafting_cycle_plan.entity_transfer_map;
    const byId = (id: string) =>
        Array.from(transferMap.entries()).find(([key]) => key.id === id)?.[1];

    it("generates a blueprint without throwing", () => {
        expect(result.blueprint).toBeDefined();
    });

    it("assigns a transfer count to the iron-gear-wheel output inserter feeding the belt", () => {
        const inserter1 = byId("inserter:1");
        expect(inserter1).toBeDefined();
        expect(inserter1!.total_transfer_count.toDecimal()).toBeGreaterThan(0);
        expect(inserter1!.item_transfers.map(it => it.item_name)).toEqual(["iron-gear-wheel"]);
    });

    it("assigns a transfer count to the copper-plate output inserter feeding the belt", () => {
        const inserter2 = byId("inserter:2");
        expect(inserter2).toBeDefined();
        expect(inserter2!.total_transfer_count.toDecimal()).toBeGreaterThan(0);
        expect(inserter2!.item_transfers.map(it => it.item_name)).toEqual(["copper-plate"]);
    });
});
