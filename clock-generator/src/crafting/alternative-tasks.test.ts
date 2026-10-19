import {describe, expect, it} from "vitest";
import {ChestType} from "../common/entity-types";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {EnableControlMode} from "../config/schema";
import {planClockAlternatives} from "./alternatives";
import {quiet} from "./generate-blueprint-test-helpers";

const options = {logger: quiet, factorio_states: false, fuel_consumption_view: false};

describe("backed-up belt alternative tasks", () => {
    it("omits the duplicate task when belts only receive output", async () => {
        const config = await loadConfigFromFile(ConfigPaths.STONE_BRICKS_DIRECT_INSERT);
        expect(config.belts.length).toBeGreaterThan(0);
        const plan = planClockAlternatives(config, options);
        expect(plan.primary?.alternatives[0].verdict).toBe("stable");
        expect(plan.tasks.some(task => task.id === "planned")).toBe(false);
    });

    it("keeps the task for always-enabled pickups even without belt windows", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        config.inserters = config.inserters.map(inserter => inserter.source.type === "belt"
            ? {...inserter, overrides: {...inserter.overrides, enable_control: {mode: EnableControlMode.ALWAYS}}}
            : inserter);
        const plan = planClockAlternatives(config, options);
        expect(plan.primary?.alternatives[0].belt).toBeNull();
        expect(plan.tasks.some(task => task.id === "planned")).toBe(true);
    });

    it("keeps the task when the only belt pickup supplies fuel", async () => {
        const config = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
        config.chests = [{type: ChestType.INFINITY_CHEST, id: 1,
            item_filter: [{item_name: "yumako-mash", request_count: 32}]}];
        config.inserters[0].source = {type: "chest", id: 1};
        const plan = planClockAlternatives(config, options);
        expect(plan.primary?.alternatives[0].result.unplanned_inserter_clocks?.["inserter:3"]?.kind).toBe("fuel");
        expect(plan.tasks.some(task => task.id === "planned")).toBe(true);
    });

    it("does not offer a second backed-up choice when that supply is configured", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const plan = planClockAlternatives({...config, overrides: {...config.overrides, backed_up_belts: true}}, options);
        expect(plan.tasks.some(task => task.id === "planned")).toBe(false);
    });
});
