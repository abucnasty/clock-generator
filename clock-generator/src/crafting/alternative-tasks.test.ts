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

describe("moving belt fallback task", () => {
    it("is a fallback of a config whose belts are backed up: it waits, also for searches the config runs on every build", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const plan = planClockAlternatives({...config,
            overrides: {...config.overrides, backed_up_belts: true, search_for_fewer_wake_ups: true}}, options);
        expect(plan.tasks.filter(task => task.only_when_needed)).toEqual([
            {id: "planned-moving-belt", label: "Batched swings, moving belt", only_when_needed: true, fallback: true},
        ]);
    });

    it("is not offered where the belts move, or where no inserter picks up from a belt", async () => {
        const moving = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        expect(planClockAlternatives(moving, options).tasks.some(task => task.id === "planned-moving-belt")).toBe(false);
        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS);
        const plan = planClockAlternatives({...config, overrides: {...config.overrides, backed_up_belts: true}}, options);
        expect(plan.tasks.some(task => task.id === "planned-moving-belt")).toBe(false);
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
