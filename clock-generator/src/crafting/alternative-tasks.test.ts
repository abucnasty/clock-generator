import {describe, expect, it} from "vitest";
import {ChestType} from "../common/entity-types";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {EnableControlMode} from "../config/schema";
import {planClockAlternatives} from "./alternatives";
import {quiet} from "./generate-blueprint-test-helpers";

const options = {logger: quiet, factorio_states: false, fuel_consumption_view: false};

describe("belt supply alternative tasks", () => {
    // clocks are made for the supply the config names: no task is the same build with the other supply
    const otherSupply = (plan: ReturnType<typeof planClockAlternatives>) =>
        plan.tasks.filter(task => task.id === "planned" || task.id === "planned-moving-belt");

    it("offers no clock for another supply to a config whose belts move, with or without belt windows", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        expect(config.inserters.some(inserter => inserter.source.type === "belt")).toBe(true);
        expect(otherSupply(planClockAlternatives(config, options))).toEqual([]);
        const always_enabled = {...config, inserters: config.inserters.map(inserter => inserter.source.type === "belt"
            ? {...inserter, overrides: {...inserter.overrides, enable_control: {mode: EnableControlMode.ALWAYS}}}
            : inserter)};
        expect(otherSupply(planClockAlternatives(always_enabled, options))).toEqual([]);
    });

    it("offers no clock for another supply where the only belt pickup supplies fuel", async () => {
        const config = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
        config.chests = [{type: ChestType.INFINITY_CHEST, id: 1,
            item_filter: [{item_name: "yumako-mash", request_count: 32}]}];
        config.inserters[0].source = {type: "chest", id: 1};
        const plan = planClockAlternatives(config, options);
        expect(plan.primary?.alternatives[0].result.unplanned_inserter_clocks?.["inserter:3"]?.kind).toBe("fuel");
        expect(otherSupply(plan)).toEqual([]);
    });

    it("offers no clock for another supply to a config whose belts are backed up, not even as a fallback", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const plan = planClockAlternatives({...config,
            overrides: {...config.overrides, backed_up_belts: true, search_for_fewer_wake_ups: true}}, options);
        expect(otherSupply(plan)).toEqual([]);
        expect(plan.tasks.filter(task => task.only_when_needed && task.fallback === true).map(task => task.id)).not.toContain("planned-moving-belt");
    });

    it("has the same tasks whichever supply a config without a belt pickup names", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS);
        const ids = (backed_up_belts: boolean) => planClockAlternatives({...config, overrides: {...config.overrides, backed_up_belts}}, options)
            .tasks.map(task => task.id);
        expect(ids(true)).toEqual(ids(false));
    });
});

describe("output swing counts above the planned one", () => {
    const swingTasks = (plan: ReturnType<typeof planClockAlternatives>) => plan.tasks.map(task => task.id).filter(id => /^swings-\d+$/.test(id));

    // a cycle takes its output swings from a machine that holds the planned count when they start: the count three
    // above it held on no sample or fixture but as a multiple of the planned count (6 at 3)
    it("are tried up to two above it, and three above only where that is a multiple of it", async () => {
        const units = planClockAlternatives(await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS), options);
        expect(units.context.planned_swings).toBe(2);
        expect(swingTasks(units)).toEqual(["swings-3", "swings-4", "swings-1"]);
        const utility = planClockAlternatives(await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS), options);
        expect(utility.context.planned_swings).toBe(3);
        expect(swingTasks(utility)).toEqual(["swings-4", "swings-5", "swings-6", "swings-2", "swings-1"]);
        // a planned count of 1 is not counted as having multiples: 4 at 1 held nowhere
        const grenade = planClockAlternatives(await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE), options);
        expect(grenade.context.planned_swings).toBe(1);
        expect(swingTasks(grenade)).toEqual(["swings-2", "swings-3"]);
    });
});
