import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config, ConfigSchema } from "../../config/schema";
import { OpenRange } from "../../data-types";
import { Entity } from "../../entities";
import { clockBeltOf } from "../../crafting/plan/unclocked-run";
import { createEntityRegistryFromConfig } from "../../crafting/sequence/simulation-context";
import { takenLanesOf } from "../../crafting/shared-lane-lanes";
import { laneFactsOfConfig } from "./build-traits";
import { everyInputLaneIsDeadEnd } from "./lane-ends";
import { LaneRole } from "./lane-role";

type Parts = Partial<Pick<Config, "machines" | "inserters" | "belts" | "chests" | "overrides">>;

function configOf(parts: Parts): Config {
    return ConfigSchema.parse({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [], belts: [], inserters: [], ...parts,
    }) as Config;
}

const machine = (id: number, recipe: string) => ({ id, recipe, crafting_speed: 1, productivity: 0 });
const lane = (ingredient: string) => ({ ingredient, stack_size: 4 });
const belt = (id: number, ...items: string[]) => ({ id, type: "turbo-transport-belt", lanes: items.map(lane) });
const take = (id: number, belt_id: number, machine_id: number, filters?: string[]) =>
    ({ id, source: { type: "belt" as const, id: belt_id }, sink: { type: "machine" as const, id: machine_id }, ...(filters && { filters }) });
const put = (id: number, machine_id: number, belt_id: number) =>
    ({ id, source: { type: "machine" as const, id: machine_id }, sink: { type: "belt" as const, id: belt_id } });

/** The role of every lane the belts of the config state, belt by belt, lane 1 first */
function rolesOf(config: Config): (LaneRole | null)[] {
    const facts = laneFactsOfConfig(config);
    return config.belts.flatMap(it => facts.lanesOf(it.id).map(lane_facts => lane_facts.role));
}

// a gear assembler takes iron plate, a cable assembler copper plate, a belt assembler gears and iron plate
const machines = [machine(1, "iron-gear-wheel"), machine(2, "copper-cable"), machine(3, "transport-belt")];

describe("the role of a lane", () => {
    it("is input where an inserter takes its item, output where one drops its item, buffer where both", () => {
        const config = configOf({
            machines,
            belts: [belt(1, "iron-plate"), belt(2, "iron-gear-wheel"), belt(3, "iron-gear-wheel")] as Config["belts"],
            // gears onto belt 2; gears onto belt 3 and off it again, into the belt assembler
            inserters: [take(1, 1, 1), put(2, 1, 2), put(3, 1, 3), take(4, 3, 3)],
        });
        expect(rolesOf(config)).toEqual(["input", "output", "buffer"]);
    });

    it("is by item, per lane: an inserter without filters takes only what its sink takes, one with filters what they name", () => {
        const both = [belt(1, "iron-plate", "copper-plate")] as Config["belts"];
        // the gear assembler takes the iron plate only; nothing takes the copper plate
        expect(rolesOf(configOf({ machines, belts: both, inserters: [take(1, 1, 1)] }))).toEqual(["input", null]);
        expect(rolesOf(configOf({ machines, belts: both, inserters: [take(1, 1, 1), take(2, 1, 2)] }))).toEqual(["input", "input"]);
        expect(rolesOf(configOf({ machines, belts: both, inserters: [take(1, 1, 2, ["copper-plate"])] }))).toEqual([null, "input"]);
    });

    it("is input on both lanes where one inserter takes the one item from both", () => {
        const config = configOf({ machines, belts: [belt(1, "iron-plate", "iron-plate")] as Config["belts"], inserters: [take(1, 1, 1)] });
        expect(rolesOf(config)).toEqual(["input", "input"]);
    });

    it("is that of the other lane of its belt for a lane with no item, and none for a belt with two lanes without an item", () => {
        const empty_beside = configOf({ machines, belts: [belt(1, "iron-plate", ""), belt(2, "", "iron-gear-wheel")] as Config["belts"],
            inserters: [take(1, 1, 1), put(2, 1, 2)] });
        expect(rolesOf(empty_beside)).toEqual(["input", "input", "output", "output"]);
        const both_empty = configOf({ machines, belts: [belt(1, "iron-plate"), belt(2, "", "")] as Config["belts"], inserters: [take(1, 1, 1)] });
        expect(rolesOf(both_empty)).toEqual(["input", null, null]);
    });

    it("is none on a belt that no inserter takes from or drops onto", () => {
        expect(rolesOf(configOf({ machines, belts: [belt(1, "iron-plate", "copper-plate")] as Config["belts"] }))).toEqual([null, null]);
    });

    it("is input for the item a belt gives and output for the item dropped onto it, on one belt (rocket fuel, belt 3)", async () => {
        const config = await loadConfigFromFile(ConfigPaths.ROCKET_FUEL_60) as Config;
        const facts = laneFactsOfConfig(config);
        expect(config.belts.find(it => it.id === 3)?.lanes.map(it => it.ingredient)).toEqual(["nutrients", "jellynut-seed"]);
        expect(facts.lanesOf(3).map(it => it.role)).toEqual(["input", "output"]);
        // the lanes a belt pickup takes from are still read at the belt: an inserter without filters takes from both
        expect(takenLanesOf(config).filter(it => it.belt_id === 3).map(it => it.lane)).toEqual([1, 2]);
    });
});

/** The end of every lane the belts of the config state, belt by belt, lane 1 first */
function endsOf(config: Config): string[] {
    const facts = laneFactsOfConfig(config);
    return config.belts.flatMap(it => facts.lanesOf(it.id).map(lane_facts => lane_facts.lane_end.kind));
}

describe("the end of a lane that states none", () => {
    // belt 1 an input lane, belt 2 an output lane, belt 3 a buffer lane
    const roles = (overrides?: Config["overrides"], lanes: object = {}) => configOf({
        machines,
        belts: [belt(1, "iron-plate"), belt(2, "iron-gear-wheel"), belt(3, "iron-gear-wheel")]
            .map(it => ({ ...it, lanes: it.lanes.map(stated => ({ ...stated, ...lanes })) })) as Config["belts"],
        inserters: [take(1, 1, 1), put(2, 1, 2), put(3, 1, 3), take(4, 3, 3)],
        ...(overrides && { overrides }),
    });

    it("is a dead end on an input lane and on a buffer lane, an infinite end on an output lane", () => {
        expect(rolesOf(roles())).toEqual(["input", "output", "buffer"]);
        expect(endsOf(roles())).toEqual(["dead_end", "infinite", "dead_end"]);
    });

    it("is never unknown, and the end a lane states wins over its role and over the switch", () => {
        for (const kind of ["dead_end", "infinite", "unknown"] as const) {
            for (const overrides of [undefined, { backed_up_belts: true }, { backed_up_belts: false }]) {
                expect(endsOf(roles(overrides, { lane_end: { kind } }))).toEqual([kind, kind, kind]);
            }
        }
        for (const overrides of [undefined, { backed_up_belts: true }, { backed_up_belts: false }]) {
            expect(endsOf(roles(overrides))).not.toContain("unknown");
        }
    });

    it("is what the switch gives where the config states it: a dead end where it is true, an infinite end where it is false", () => {
        expect(endsOf(roles({ backed_up_belts: true }))).toEqual(["dead_end", "dead_end", "dead_end"]);
        expect(endsOf(roles({ backed_up_belts: false }))).toEqual(["infinite", "infinite", "infinite"]);
        expect(endsOf(roles({}))).toEqual(["dead_end", "infinite", "dead_end"]);
    });

    it("is an infinite end on an export lane, whatever the switch", () => {
        const exporting = (overrides?: Config["overrides"]) => configOf({
            machines,
            belts: [belt(1, "iron-plate"),
                { id: 2, type: "turbo-transport-belt", strategy: "export", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 4, consumption_per_second: 1 }] }] as Config["belts"],
            inserters: [take(1, 1, 1), put(2, 1, 2)],
            ...(overrides && { overrides }),
        });
        for (const overrides of [undefined, { backed_up_belts: true }, { backed_up_belts: false }]) {
            expect(laneFactsOfConfig(exporting(overrides)).of(2, 1).lane_end).toEqual({ kind: "infinite" });
        }
        expect(endsOf(exporting({ backed_up_belts: true }))).toEqual(["dead_end", "infinite"]);
    });

    it("is the end of the other lane of its belt on a lane with no item, and as without a role on a belt with two lanes without one", () => {
        const empty_beside = configOf({ machines, belts: [belt(1, "iron-plate", ""), belt(2, "", "iron-gear-wheel")] as Config["belts"],
            inserters: [take(1, 1, 1), put(2, 1, 2)] });
        expect(endsOf(empty_beside)).toEqual(["dead_end", "dead_end", "infinite", "infinite"]);
        const stated_beside = configOf({ machines, belts: [{ ...belt(1, "iron-plate", ""), lanes: [{ ...lane("iron-plate"), lane_end: { kind: "infinite" } }, lane("")] }] as Config["belts"],
            inserters: [take(1, 1, 1)] });
        expect(endsOf(stated_beside)).toEqual(["infinite", "infinite"]);
        const both_empty = (overrides?: Config["overrides"]) => configOf({ machines, belts: [belt(1, "iron-plate"), belt(2, "", "")] as Config["belts"],
            inserters: [take(1, 1, 1)], ...(overrides && { overrides }) });
        expect(endsOf(both_empty())).toEqual(["dead_end", "infinite", "infinite"]);
        expect(endsOf(both_empty({ backed_up_belts: true }))).toEqual(["dead_end", "dead_end", "dead_end"]);
    });

    it("is a dead end on both lanes where one inserter takes the one item from both", () => {
        const config = configOf({ machines, belts: [belt(1, "iron-plate", "iron-plate")] as Config["belts"], inserters: [take(1, 1, 1)] });
        expect(endsOf(config)).toEqual(["dead_end", "dead_end"]);
    });

    it("on a belt pickup with an input lane and a lane only dropped onto: a dead end and an infinite end, and the clock's belt is backed up", () => {
        // the gear assembler takes iron plate off lane 1 and drops its gears onto the same belt, whose lane 2 carries gears
        const config = configOf({ machines, belts: [belt(1, "iron-plate", "iron-gear-wheel")] as Config["belts"],
            inserters: [take(1, 1, 1), put(2, 1, 1)] });
        expect(rolesOf(config)).toEqual(["input", "output"]);
        expect(endsOf(config)).toEqual(["dead_end", "infinite"]);
        // the input and buffer lanes are read, by role: the output lane beside the input lane does not count
        expect(everyInputLaneIsDeadEnd(config, laneFactsOfConfig(config))).toBe(true);
        const registry = createEntityRegistryFromConfig(config);
        const taker = registry.getAll().filter(Entity.isInserter).find(it => it.entity_id.id === "inserter:1")!;
        expect(clockBeltOf(config, registry, new Map([[taker.entity_id.id, [OpenRange.from(0, 10)]]]))).toEqual({ kind: "backed_up" });
    });

    it("reads an input lane that states an infinite end beside a lane only dropped onto: not backed up", () => {
        const config = configOf({ machines, belts: [{ ...belt(1, "iron-plate", "iron-gear-wheel"),
            lanes: [{ ...lane("iron-plate"), lane_end: { kind: "infinite" } }, lane("iron-gear-wheel")] }] as Config["belts"],
            inserters: [take(1, 1, 1), put(2, 1, 1)] });
        expect(everyInputLaneIsDeadEnd(config, laneFactsOfConfig(config))).toBe(false);
    });

    it("is by item on the rocket fuel sample's belt 3 without its stated ends: nutrients a dead end, the seeds dropped onto it an infinite end", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.ROCKET_FUEL_60) as Config;
        const config = { ...sample, belts: sample.belts.map(it => it.id !== 3 ? it
            : { ...it, lanes: (it.lanes as readonly object[]).map(stated => { const { lane_end: _end, ...rest } = stated as { lane_end?: unknown }; return rest; }) }) } as Config;
        expect(laneFactsOfConfig(config).lanesOf(3).map(it => [it.role, it.lane_end.kind])).toEqual([["input", "dead_end"], ["output", "infinite"]]);
    });

    it("on a mixed build: an input lane that states an infinite end keeps it, one that states nothing is a dead end, an output lane an infinite end", () => {
        const mixed = configOf({
            machines,
            belts: [{ ...belt(1, "iron-plate"), lanes: [{ ...lane("iron-plate"), lane_end: { kind: "infinite" } }] }, belt(2, "copper-plate"), belt(3, "iron-gear-wheel")] as Config["belts"],
            inserters: [take(1, 1, 1), take(2, 2, 2), put(3, 1, 3)],
        });
        expect(rolesOf(mixed)).toEqual(["input", "input", "output"]);
        expect(endsOf(mixed)).toEqual(["infinite", "dead_end", "infinite"]);
    });
});

describe("the roles of the lanes of the samples", () => {
    // every lane of each sample, lane 1 before lane 2, belt by belt in the config's order; "empty" is a lane with no item,
    // which has the role of the other lane of its belt
    const listed: Record<string, string> = {
    ADVANCED_CIRCUIT_240: "input output input input input output",
    ADVANCED_CIRCUIT_230: "input output input input input output",
    CHEMICAL_SCIENCE_240_SHARED_FOUNDRY: "input input input input input input input input output output",
    ELECTROMAGNETIC_SCIENCE_330: "input input",
    ELECTRIC_FURNACE_20: "input output output",
    LOGISTIC_SCIENCE_240: "output output input input",
    INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK: "input input input input output input input",
    STONE_BRICK_120_DRILL_DIRECT_INSERT: "output empty",
    UTILITY_SCIENCE_120: "input input input input output",
    MILITARY_SCIENCE_240: "output output input input input input input input input input",
    LDS_240: "output input",
    METALLURGIC_SCIENCE_45: "input input input input",
    UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT: "input input output input input",
    PROCESSING_UNIT_15_CHEST_FED: "",
    ACCUMULATOR_320: "output output",
    AUTOMATION_SCIENCE_240: "input input output",
    AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER: "buffer buffer output",
    PRODUCTION_SCIENCE_120_TWO_BELTS: "output empty input input",
    FLYING_ROBOT_FRAME_80: "output empty input input input input",
    LOGISTIC_SCIENCE_240_DIRECT_INSERT: "output empty output empty input empty empty input",
    ROCKET_FUEL_60: "input input output output input output",
    AGRICULTURAL_SCIENCE_250: "input input input input",
    IRON_BACTERIA_380_CULTIVATION: "input input",
    PROCESSING_UNIT_80_CIRCUIT_EXPORT: "input input output output output output",
    UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN: "input input input input output output input input",
    ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED: "input input input empty output input input input empty",
    LITHIUM_PLATE_80_SILO_CHEST: "output output",
    IRON_PLATE_80_CAR_CHEST: "output output",
    GRENADE_240_FILLS_BELT_EXACTLY: "output output",
    PRODUCTIVITY_MODULE_80_CHEST_CHAIN: "input output empty",
    IRON_ORE_VOIDER_400_EXACT_SPEED: "",
    IRON_ORE_VOIDER_400_OVERBEACONED: "",
    STEEL_PLATE_26_WAGON_CHEST: "output",
    };

    it("are the roles each sample's inserters give its lanes", async () => {
        const counts = new Map<string, number>();
        for (const [key, file] of Object.entries(ConfigPaths)) {
            const config = await loadConfigFromFile(file) as Config;
            const facts = laneFactsOfConfig(config);
            const lanes = config.belts.flatMap(it => {
                const stated: readonly { ingredient: string }[] = it.lanes;
                return stated.map((lane_config, index) => ({ item: lane_config.ingredient, facts: facts.lanesOf(it.id), index }));
            });
            const expected = listed[key] === undefined ? undefined : listed[key].split(" ").filter(role => role !== "");
            expect(expected, key).toBeDefined();
            expect(lanes.map(it => it.item === "" ? "empty" : it.facts[it.index].role), key).toEqual(expected);
            for (const it of lanes.filter(it => it.item === "")) {
                expect(it.facts[it.index].role, `${key}: a lane with no item`).toBe(it.facts[1 - it.index]?.role ?? null);
            }
            for (const role of expected ?? []) counts.set(role, (counts.get(role) ?? 0) + 1);
        }
        expect(Object.fromEntries(counts)).toEqual({ input: 82, buffer: 2, output: 43, empty: 10 });
    });
});
