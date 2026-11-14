import {describe, expect, it} from "vitest";
import {ChestType} from "../common/entity-types";
import {ConfigPaths} from "../config/config-paths";
import { TestConfigPaths } from "../../tests/configs/paths";
import {loadConfigFromFile} from "../config/loader";
import {EnableControlMode} from "../config/schema";
import {planClockAlternatives, runClockAlternativeTask} from "./alternatives";
import {quiet} from "./generate-blueprint-test-helpers";

const options = {logger: quiet, factorio_states: false, fuel_consumption_view: false};

describe("belt supply alternative tasks", () => {
    // clocks are made for the supply the config names: no task is the same build with the other supply
    const otherSupply = (plan: ReturnType<typeof planClockAlternatives>) =>
        plan.tasks.filter(task => task.id === "planned" || task.id === "planned-moving-belt");

    it("offers no clock for another supply to a config whose belts move, with or without belt windows", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        expect(config.inserters.some(inserter => inserter.source.type === "belt")).toBe(true);
        expect(otherSupply(planClockAlternatives(config, options))).toEqual([]);
        const always_enabled = {...config, inserters: config.inserters.map(inserter => inserter.source.type === "belt"
            ? {...inserter, overrides: {...inserter.overrides, enable_control: {mode: EnableControlMode.ALWAYS}}}
            : inserter)};
        expect(otherSupply(planClockAlternatives(always_enabled, options))).toEqual([]);
    });

    it("offers no clock for another supply where the only belt pickup supplies fuel", async () => {
        const config = await loadConfigFromFile(TestConfigPaths.BIOCHAMBER_FUEL);
        config.chests = [{type: ChestType.INFINITY_CHEST, id: 1,
            item_filter: [{item_name: "yumako-mash", request_count: 32}]}];
        config.inserters[0].source = {type: "chest", id: 1};
        const plan = planClockAlternatives(config, options);
        expect(plan.primary?.alternatives[0].result.unplanned_inserter_clocks?.["inserter:3"]?.kind).toBe("fuel");
        expect(otherSupply(plan)).toEqual([]);
    });

    it("offers no clock for another supply to a config whose belts are backed up, not even as a fallback", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const plan = planClockAlternatives({...config,
            overrides: {...config.overrides, backed_up_belts: true, search_for_fewer_wake_ups: true}}, options);
        expect(otherSupply(plan)).toEqual([]);
        expect(plan.tasks.filter(task => task.only_when_needed && task.fallback === true).map(task => task.id)).not.toContain("planned-moving-belt");
    });

    it("has the same tasks whichever supply a config without a belt pickup names", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_15_CHEST_FED);
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
        // PROCESSING_UNIT_15_CHEST_FED was the case of a planned 2 until its infinity chest gave the game's item first (#617): 1
        const units = planClockAlternatives(await loadConfigFromFile(ConfigPaths.CHEMICAL_SCIENCE_240_SHARED_FOUNDRY), options);
        expect(units.context.planned_swings).toBe(2);
        expect(swingTasks(units)).toEqual(["swings-3", "swings-4", "swings-1"]);
        const utility = planClockAlternatives(await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT), options);
        expect(utility.context.planned_swings).toBe(3);
        expect(swingTasks(utility)).toEqual(["swings-4", "swings-5", "swings-6", "swings-2", "swings-1"]);
        // a planned count of 1 is not counted as having multiples: 4 at 1 held nowhere
        const grenade = planClockAlternatives(await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY), options);
        expect(grenade.context.planned_swings).toBe(1);
        expect(swingTasks(grenade)).toEqual(["swings-2", "swings-3"]);
        // planning the three builds generates their clocks, which the shaping of the enable windows against ghost wakeups slowed (#695)
    }, 120_000);
});

describe("the fractional swings task", () => {
    const ids = (plan: ReturnType<typeof planClockAlternatives>) => plan.tasks.map(task => task.id);

    // every inserter's hands a cycle come out whole at the primary's own count, which it held on its first plan
    // on logistic science it is left out as well, where the primary keeps the belt pickup slack inside its windows (#595)
    // and the run of fractional swings, which adds the slack, makes the same windows with it: a clock the primary beats
    it("is left out where it would make the primary clock again, which made anyway it does", async () => {
        const config = await loadConfigFromFile(TestConfigPaths.MILITARY_SCIENCE_120_COAL_LANE_PER_COPY);
        let signature = "";
        const plan = planClockAlternatives(config, options, (_context, _tasks, primary) => { signature = primary; });
        expect(plan.context.fractional_is_primary).toBe(true);
        expect(ids(plan)).not.toContain("fractional");
        const made = runClockAlternativeTask(config, { ...plan.context, fractional_is_primary: undefined }, "fractional", options, [signature]);
        // merged into the primary's run: it lists nothing, and still carries the clocks it made as parts of the per-branch clock
        expect({ ...made, parts: undefined }).toEqual({ signature, alternatives: [], parts: undefined });
    });

    it("is made where a swing of the first plan is fractional", async () => {
        const plan = planClockAlternatives(await loadConfigFromFile(ConfigPaths.ELECTRIC_FURNACE_20), options);
        expect(plan.context.fractional_is_primary).toBeUndefined();
        expect(ids(plan)).toContain("fractional");
    });
});
