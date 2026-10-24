import { describe, expect, it } from "vitest";
import path from "path";
import { encodeBlueprintFile } from "../blueprints/serde";
import {
    assertRecordableTicks, buildPartsMissingFromConfig, clockOfBlueprintString, clockPeriodTicks, matchBuiltCopies, matchBuiltDrills, matchBuiltInserters, MAX_RECORDED_TICKS,
    factorioDataDir, missingFromConfigMessage, recordedTicks, recordInFactorio, scheduledDrillIds, scheduledInserterIds,
    drillResourceOf,
} from "./factorio-harness";

describe("factorioDataDir", () => {
    it("finds data inside the app bundle for a macOS executable", () => {
        expect(factorioDataDir(path.resolve("Factorio.app", "Contents", "MacOS", "factorio")))
            .toBe(path.resolve("Factorio.app", "Contents", "data"));
    });

    it.each(["factorio", "factorio.exe"])("finds data beside bin for a standalone %s executable", executable => {
        expect(factorioDataDir(path.resolve("factorio", "bin", "x64", executable)))
            .toBe(path.resolve("factorio", "data"));
    });
});

describe("clockOfBlueprintString", () => {
    const counting = { decider_conditions: { conditions: [{ comparator: "<", constant: 1728 }], else_outputs: [{ constant: 1 }] } };

    it("reads the inserters each combinator enables from its tags, not its description", () => {
        const blueprint = encodeBlueprintFile({
            blueprint: {
                entities: [
                    { entity_number: 1, name: "decider-combinator", player_description: "Clock for [item=iron-plate] 80/s. Period 1728 ticks", control_behavior: counting },
                    { entity_number: 2, player_description: "2 inserters, each [entity=car] → …", tags: { clock_generator: { inserters: [3, 4] } } },
                    { entity_number: 3, player_description: "Inserter 9 for [item=iron-plate]", tags: { clock_generator: { drills: [1] } } },
                    { entity_number: 4, player_description: "Part of the clock: do not wire or change." },
                ],
            },
        } as any);
        expect(clockOfBlueprintString(blueprint).schedule).toEqual({
            counted_ticks: 1728,
            inserter_combinators: [{ entity_number: 2, inserter_ids: [3, 4] }],
        });
    });

    it("reads the schedule of a clock blueprint from before the tags from the descriptions of its combinators", () => {
        const blueprint = encodeBlueprintFile({
            blueprint: {
                entities: [
                    { entity_number: 1, name: "decider-combinator", player_description: "Clock for [item=agricultural-science-pack]:\n- Cycle Count: 25 cycles", control_behavior: counting },
                    { entity_number: 2, player_description: "Inserters 3, 4, 6, 7 for [item=nutrients] into [recipe=pentapod-egg]\nSwing Counts:" },
                    { entity_number: 3, player_description: "Inserter 12 for [item=agricultural-science-pack]" },
                    { entity_number: 4, player_description: "Subtick clock, step 1 of 2" },
                    { entity_number: 5 },
                ],
            },
        } as any);
        const { schedule } = clockOfBlueprintString(blueprint);
        expect(schedule).toEqual({
            counted_ticks: 1728,
            inserter_combinators: [{ entity_number: 2, inserter_ids: [3, 4, 6, 7] }, { entity_number: 3, inserter_ids: [12] }],
        });
        expect(scheduledInserterIds(schedule)).toEqual([3, 4, 6, 7, 12]);
    });

    it("reads the drills a clock enables off the tags of their combinators, or the descriptions of a string from before the tags", () => {
        const blueprint = encodeBlueprintFile({
            blueprint: {
                entities: [
                    { entity_number: 1, player_description: "Drill 1 for [item=iron-ore] into [entity=car]\n- enabled for tick 27 of the clock" },
                    { entity_number: 2, player_description: "Drills 2, 3 for [item=stone] into [recipe=stone-brick]\nSwing Counts:" },
                    { entity_number: 3, player_description: "Inserter 1 for [item=iron-ore] into [recipe=iron-plate]" },
                ],
            },
        } as any);
        expect(scheduledDrillIds(blueprint)).toEqual([1, 2, 3]);
        // a clock with tags names them there, whatever its descriptions say
        const tagged = encodeBlueprintFile({
            blueprint: {
                entities: [
                    { entity_number: 1, player_description: "[entity=big-mining-drill] [item=iron-ore] → [entity=car] (drill 1)", tags: { clock_generator: { drills: [1] } } },
                    { entity_number: 2, player_description: "Drill 4 for [item=stone]", tags: { clock_generator: { inserters: [2] } } },
                ],
            },
        } as any);
        expect(scheduledDrillIds(tagged)).toEqual([1]);
    });

    it("refuses a blueprint without a clock the generator made", () => {
        const blueprint = encodeBlueprintFile({ blueprint: { entities: [{ entity_number: 1, player_description: "Inserter 1 for [item=iron-plate]" }] } } as any);
        expect(() => clockOfBlueprintString(blueprint)).toThrow("no clock the generator made");
    });
});

describe("matchBuiltInserters", () => {
    it("finds the unit number of each config inserter in a build the recorder numbered differently", () => {
        const config = {
            machines: [{ id: 1, recipe: "iron-gear-wheel" }, { id: 2, recipe: "electronic-circuit" }],
            inserters: [
                { id: 1, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 } },
                { id: 2, source: { type: "machine", id: 2 }, sink: { type: "chest", id: 1 } },
            ],
            belts: [],
        } as any;
        // what the mod's harness_describe answers; Lua writes the empty belt list as {}
        const described = {
            config: {
                inserters: [
                    { source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 } },
                    { source: { type: "machine", id: 2 }, sink: { type: "machine", id: 1 } },
                ],
                belts: {},
            },
            machines: [
                { id: 1, unit_number: 50, name: "assembling-machine-3", recipe: "electronic-circuit" },
                { id: 2, unit_number: 51, name: "assembling-machine-3", recipe: "iron-gear-wheel" },
            ],
            inserters: [
                { id: 1, unit_number: 70, name: "inserter", source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 1 },
                { id: 2, unit_number: 71, name: "inserter", source: { type: "machine", id: 2 }, sink: { type: "machine", id: 1 }, stack_size: 1 },
            ],
        };
        expect(matchBuiltInserters(described, config)).toEqual(new Map([[1, 71], [2, 70]]));
    });
});

describe("buildPartsMissingFromConfig", () => {
    // one machine emptied into chests; the config knows two output inserters and the inserter from the belt
    const config = {
        machines: [{ id: 1, recipe: "iron-bacteria-cultivation" }],
        inserters: [
            { id: 1, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 } },
            { id: 3, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 } },
            { id: 9, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 } },
        ],
        belts: [{ id: 1, lanes: [{ ingredient: "bioflux" }, { ingredient: "nutrients" }] }],
    } as any;
    type End = { unit_number?: number; type: string; name: string };
    const MACHINE: End = { unit_number: 50, type: "assembling-machine", name: "biochamber" };
    const CHEST: End = { unit_number: 60, type: "infinity-container", name: "infinity-chest" };
    const BELT: End = { unit_number: 61, type: "transport-belt", name: "turbo-transport-belt" };
    /** An inserter as the recorder lists it for a recording (typed ends), or null when it has no type for an end */
    const recorded = (id: number, source: [string, number], sink: [string, number]) =>
        ({ id, unit_number: 100 + id, name: "stack-inserter", source: { type: source[0], id: source[1] }, sink: { type: sink[0], id: sink[1] }, stack_size: 16 });
    const mover = (unit_number: number, pickup: End | undefined, drop: End | undefined) => ({ unit_number, name: "stack-inserter", pickup, drop });
    const described = (
        inserters: ReturnType<typeof recorded>[],
        movers: { inserters: ReturnType<typeof mover>[]; loaders?: object[] },
        machines: object[] = [{ id: 1, unit_number: 50, name: "biochamber", recipe: "iron-bacteria-cultivation" }],
        lanes = [{ ingredient: "bioflux" }, { ingredient: "nutrients" }],
    ) => ({
        config: { inserters: inserters.map(({ source, sink }) => ({ source, sink })), belts: [{ id: 1, lanes }] },
        machines,
        inserters,
        movers: { loaders: [], ...movers },
    });
    // the config's three inserters and the two that feed the scaffold's belt, as recorded and as movers
    const RECORDED = [
        recorded(1, ["chest", 1], ["belt", 1]), recorded(2, ["chest", 2], ["belt", 1]),
        recorded(3, ["machine", 1], ["chest", 3]), recorded(4, ["belt", 1], ["machine", 1]), recorded(5, ["machine", 1], ["chest", 3]),
    ];
    const MOVERS = [mover(101, CHEST, BELT), mover(102, CHEST, BELT), mover(103, MACHINE, CHEST), mover(104, BELT, MACHINE), mover(105, MACHINE, CHEST)];

    it("finds nothing missing in a build that is the config plus the inserters feeding its belt", () => {
        expect(buildPartsMissingFromConfig(described(RECORDED, { inserters: MOVERS }), config)).toEqual([]);
    });

    it("names a third output inserter the config does not have, which a clock would leave running free", () => {
        const build = described([...RECORDED, recorded(6, ["machine", 1], ["chest", 3])], { inserters: [...MOVERS, mover(106, MACHINE, CHEST)] });
        expect(buildPartsMissingFromConfig(build, config)).toEqual([
            { kind: "inserter", description: "stack-inserter machine 1 (iron-bacteria-cultivation) -> infinity-chest (unit 106)", takes_from_belt: false },
        ]);
        // the inserters of the config are still matched
        expect(matchBuiltInserters(build, config).size).toBe(3);
    });

    it("names an inserter whose other end a recording has no type for and so leaves out: a heating tower, the ground", () => {
        // the recorder does not list these two among the inserters of a recording at all
        const tower: End = { unit_number: 70, type: "reactor", name: "heating-tower" };
        const build = described(RECORDED, { inserters: [...MOVERS, mover(106, MACHINE, tower), mover(107, MACHINE, undefined)] });
        expect(buildPartsMissingFromConfig(build, config).map(it => it.description)).toEqual([
            "stack-inserter machine 1 (iron-bacteria-cultivation) -> heating-tower (unit 106)",
            "stack-inserter machine 1 (iron-bacteria-cultivation) -> nothing (the ground) (unit 107)",
        ]);
    });

    it("names a machine with a recipe of the config beyond the machines the config has, and its inserters", () => {
        const second: End = { unit_number: 51, type: "assembling-machine", name: "biochamber" };
        const build = described(
            [...RECORDED, recorded(6, ["machine", 2], ["chest", 3]), recorded(7, ["machine", 2], ["machine", 1])],
            { inserters: [...MOVERS, mover(106, second, CHEST), mover(107, second, MACHINE)] },
            [{ id: 1, unit_number: 50, name: "biochamber", recipe: "iron-bacteria-cultivation" }, { id: 2, unit_number: 51, name: "biochamber", recipe: "iron-bacteria-cultivation" }],
        );
        expect(buildPartsMissingFromConfig(build, config).map(it => `${it.kind}: ${it.description}`)).toEqual([
            "machine: biochamber making iron-bacteria-cultivation (unit 51), beyond the 1 the config has of that recipe",
            // what is known of a machine outside the config is its name and recipe, not "machine undefined"
            "inserter: stack-inserter biochamber making iron-bacteria-cultivation, which is no machine of the config -> machine 1 (iron-bacteria-cultivation) (unit 107)",
        ]);
    });

    it("leaves a machine with another recipe to the scaffold, but not its inserter into a machine of the config", () => {
        const feeder: End = { unit_number: 52, type: "assembling-machine", name: "assembling-machine-3" };
        const machines = [{ id: 1, unit_number: 50, name: "biochamber", recipe: "iron-bacteria-cultivation" }, { id: 2, unit_number: 52, name: "assembling-machine-3", recipe: "bioflux" }];
        const alone = described(RECORDED, { inserters: [...MOVERS, mover(106, feeder, CHEST)] }, machines);
        expect(buildPartsMissingFromConfig(alone, config)).toEqual([]);
        const into = described(RECORDED, { inserters: [...MOVERS, mover(106, feeder, MACHINE)] }, machines);
        expect(buildPartsMissingFromConfig(into, config).map(it => it.description)).toEqual([
            "stack-inserter assembling-machine-3 making bioflux, which is no machine of the config -> machine 1 (iron-bacteria-cultivation) (unit 106)",
        ]);
    });

    it("names a loader on a machine of the config, and leaves the loaders at the end of the scaffold's belt alone", () => {
        const loaders = [
            { unit_number: 80, name: "turbo-loader", loader_type: "output", container: MACHINE },
            { unit_number: 81, name: "turbo-loader", loader_type: "input", container: MACHINE },
            { unit_number: 82, name: "turbo-loader", loader_type: "input", container: CHEST },
            { unit_number: 83, name: "turbo-loader", loader_type: "input" },
        ];
        expect(buildPartsMissingFromConfig(described(RECORDED, { inserters: MOVERS, loaders }), config)).toEqual([
            { kind: "loader", description: "turbo-loader emptying machine 1 (iron-bacteria-cultivation) (unit 80)", takes_from_belt: false },
            { kind: "loader", description: "turbo-loader filling machine 1 (iron-bacteria-cultivation) (unit 81)", takes_from_belt: false },
        ]);
    });

    it("says that a longer warm-up may help when the inserter takes from a belt, which is matched by what lies on it", () => {
        // the nutrient lane was still empty when the build was matched: the belt is not the config's belt of two items,
        // so the inserter of the config that takes from it comes back as one the config does not have
        const build = described(RECORDED, { inserters: MOVERS }, undefined, [{ ingredient: "bioflux" }, { ingredient: "" }]);
        const missing = buildPartsMissingFromConfig(build, config);
        expect(missing).toEqual([
            { kind: "inserter", description: "stack-inserter turbo-transport-belt -> machine 1 (iron-bacteria-cultivation) (unit 104)", takes_from_belt: true },
        ]);
        expect(missingFromConfigMessage(missing)).toContain("a longer warm-up may help");
        // no such hint for an inserter that takes from a machine
        const third = described([...RECORDED, recorded(6, ["machine", 1], ["chest", 3])], { inserters: [...MOVERS, mover(106, MACHINE, CHEST)] });
        const message = missingFromConfigMessage(buildPartsMissingFromConfig(third, config));
        expect(message).toContain("1 part(s) on machines of the config that the config does not have: stack-inserter machine 1");
        expect(message).toContain("Add them to the config or take them out of the build.");
        expect(message).not.toContain("warm-up");
    });

    it("refuses an answer of a recorder mod that does not list the build's inserters and loaders", () => {
        const { movers: _movers, ...old } = described(RECORDED, { inserters: MOVERS });
        expect(() => buildPartsMissingFromConfig(old, config)).toThrow("older than this harness");
    });
});

describe("the most ticks one run in Factorio records", () => {
    /** A clock blueprint as the generator makes it: a decider that counts while under a constant */
    const clock = (constant: number, extra: object[] = [], else_outputs?: object[]) => encodeBlueprintFile({
        blueprint: {
            entities: [
                {
                    name: "decider-combinator",
                    player_description: "Clock for [item=iron-bacteria]:\n- Target: 380",
                    control_behavior: { decider_conditions: { conditions: [{ first_signal: { name: "signal-clock", type: "virtual" }, comparator: "<", constant }], outputs: [], else_outputs } },
                },
                { name: "decider-combinator", player_description: "Inserters 1, 3 for [item=iron-bacteria]", control_behavior: { decider_conditions: { conditions: [{ comparator: "≥", constant: 1 }] } } },
                ...extra,
            ],
        },
    } as any);
    const ONE_BASED = [{ name: "constant-combinator", player_description: "Clock step: adds 1 to the count of the clock" }];

    it("is 20 minutes of game time, and a recording of that length is allowed", () => {
        expect(MAX_RECORDED_TICKS).toBe(20 * 60 * 60);
        expect(() => assertRecordableTicks(MAX_RECORDED_TICKS)).not.toThrow();
        expect(() => assertRecordableTicks(36_000)).not.toThrow();
    });

    it("refuses a request that is no whole number of ticks above 0", () => {
        for (const ticks of [NaN, 0, -600, 600.5, Infinity]) {
            expect(() => assertRecordableTicks(ticks), `${ticks} ticks`).toThrow("must be a whole number above 0");
            expect(() => assertRecordableTicks(ticks, 1728), `${ticks} ticks with a clock`).toThrow("must be a whole number above 0");
        }
    });

    it("reads the period a clock blueprint counts: from 1 with something adding the 1, from 0 before that", () => {
        expect(clockPeriodTicks(clock(1728, ONE_BASED))).toBe(1728);
        // the game keeps the whole part of a constant: 90.947 counts 1 to 90
        expect(clockPeriodTicks(clock(90.94736842105263, ONE_BASED))).toBe(90);
        expect(clockPeriodTicks(clock(1728, [], [{ signal: { name: "signal-clock", type: "virtual" }, constant: 1 }]))).toBe(1728);
        // a clock made before 0.6.0 counts 0 to 89 while under 89.947
        expect(clockPeriodTicks(clock(89.94736842105263))).toBe(90);
        // a scaffold without a clock of the generator's, and something that is no blueprint
        expect(clockPeriodTicks(encodeBlueprintFile({ blueprint: { entities: [{ name: "decider-combinator" }] } } as any))).toBeNull();
        expect(clockPeriodTicks("not a blueprint")).toBeNull();
    });

    it("counts what a clocked recording holds: whole periods until at least the ticks asked for", () => {
        expect(recordedTicks(36_000, 1728)).toBe(36_288);
        expect(recordedTicks(36_000, 90)).toBe(36_000);
        expect(recordedTicks(600, 100_000)).toBe(100_000);
        expect(recordedTicks(600, null)).toBe(600);
        // the game tests ask for 36,000 ticks: 21 periods of the iron bacteria clock
        expect(() => assertRecordableTicks(36_000, 1728)).not.toThrow();
    });

    it("refuses a request whose whole periods pass the limit, and names the most that fits", () => {
        // 72,000 ticks on a clock of 1728 would record 42 periods, 72,576 ticks
        expect(() => assertRecordableTicks(72_000, 1728)).toThrow(
            "A request for 72000 ticks records 72576: whole periods of the clock, which counts 1728 ticks. "
            + "That is over the limit of 72000 ticks (20 minutes of game time) for one run in Factorio. The most that fits is 70848 ticks (41 periods).");
        expect(() => assertRecordableTicks(70_848, 1728)).not.toThrow();
        expect(() => assertRecordableTicks(70_849, 1728)).toThrow("records 72576");
        // a clock longer than the limit records one period however little is asked for
        expect(() => assertRecordableTicks(600, 100_000)).toThrow("A request for 600 ticks records 100000");
        expect(() => assertRecordableTicks(600, 100_000)).toThrow("Not one period of this clock fits.");
        // without a clock the request is what is recorded
        expect(() => assertRecordableTicks(72_000, null)).not.toThrow();
        expect(() => assertRecordableTicks(72_001, null)).toThrow("A recording of 72001 ticks is over the limit of 72000 ticks (20 minutes of game time)");
    });

    it("refuses up front, before anything of the game is touched", async () => {
        // no Factorio and no save at these paths: had the run got as far as looking for them, that is what it would say
        const run = (ticks: number, more: object) => recordInFactorio({
            factorio: "/nowhere/factorio",
            save: "/nowhere/save.zip",
            blueprint: "0",
            out: "/nowhere/recording.json",
            ticks,
            warmup_ticks: 300,
            settle_ticks: 100_000,
            seed: [],
            unclocked: false,
            game_speed: 1000,
            timeout_seconds: 1,
            log: () => { },
            ...more,
        });
        await expect(run(144_000, { unclocked: true })).rejects.toThrow("A recording of 144000 ticks is over the limit of 72000 ticks");
        // a clock swapped in is cut by the ticks its schedule says it counts
        const swapped = { blueprint: clock(1728, ONE_BASED), schedule: { counted_ticks: 1728, inserter_combinators: [] } };
        await expect(run(72_000, { clock: swapped, config: {} })).rejects.toThrow("The most that fits is 70848 ticks");
        // a clock the build comes with and keeps is the one the recording is cut by
        await expect(run(600, { blueprint: clock(100_000, ONE_BASED) })).rejects.toThrow("records 100000");
        // within the limit the run goes on, to where it finds no Factorio
        await expect(run(70_848, { clock: swapped, config: {} })).rejects.toThrow("Factorio not found");
    });
});

describe("the resource the harness puts under a blueprint's drills", () => {
    const drills = (...mined: string[]) => ({ drills: { configs: mined.map((mined_item_name, index) => ({
        id: index + 1, type: "big-mining-drill" as const, mined_item_name, speed_bonus: 0, productivity: 10, target: { type: "chest" as const, id: 1 } })) } });
    const config = (...mined: string[]) => ({ target_output: { recipe: "iron-plate", items_per_second: 1, copies: 1 }, machines: [], inserters: [], belts: [], ...drills(...mined) });

    it("is what the config's drills mine, or what is asked", () => {
        expect(drillResourceOf({ config: config("iron-ore", "iron-ore") })).toBe("iron-ore");
        expect(drillResourceOf({ config: config("iron-ore"), drill_resource: "copper-ore" })).toBe("copper-ore");
        expect(drillResourceOf({ config: config() })).toBeUndefined();
        expect(drillResourceOf({})).toBeUndefined();
    });

    it("is refused when the config's drills mine more than one", () => {
        expect(() => drillResourceOf({ config: config("iron-ore", "stone") })).toThrow("The config's drills mine iron-ore, stone");
    });
});

describe("a build that holds the config more than once", () => {
    // the config: a gear machine hands to a product machine, fed from belt 1 and emptied onto belt 2; the build has it twice
    const config = {
        machines: [{ id: 1, recipe: "iron-gear-wheel" }, { id: 2, recipe: "inserter" }],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 } },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 } },
            { id: 3, source: { type: "machine", id: 2 }, sink: { type: "belt", id: 2 } },
        ],
        belts: [{ id: 1, lanes: [{ ingredient: "iron-plate" }, { ingredient: "iron-plate" }] }, { id: 2, lanes: [{ ingredient: "inserter" }] }],
    } as any;
    const ends = (id: number) => [
        { source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 + 2 * id } },
        { source: { type: "machine", id: 1 + 2 * id }, sink: { type: "machine", id: 2 + 2 * id } },
        { source: { type: "machine", id: 2 + 2 * id }, sink: { type: "belt", id: 2 } },
    ];
    const inserters = [0, 1].flatMap(copy => ends(copy).map((end, index) => ({ id: 3 * copy + index + 1, unit_number: 100 + 3 * copy + index, name: "inserter", stack_size: 1, ...end })));
    const machines = [0, 1].flatMap(copy => [
        { id: 1 + 2 * copy, unit_number: 50 + 2 * copy, name: "assembling-machine-3", recipe: "iron-gear-wheel" },
        { id: 2 + 2 * copy, unit_number: 51 + 2 * copy, name: "assembling-machine-3", recipe: "inserter" },
    ]);
    const mover = (inserter: typeof inserters[number]) => {
        const end = (it: { type: string; id: number }) => it.type === "machine"
            ? { unit_number: 50 + it.id - 1, type: "assembling-machine", name: "assembling-machine-3" }
            : { unit_number: 200 + it.id, type: "transport-belt", name: "transport-belt" };
        return { unit_number: inserter.unit_number, name: "inserter", pickup: end(inserter.source), drop: end(inserter.sink) };
    };
    const described = (inserter_list = inserters) => ({
        config: { inserters: inserter_list.map(({ source, sink }) => ({ source, sink })), belts: [config.belts[0], config.belts[1]] },
        machines,
        inserters: inserter_list,
        movers: { loaders: [], inserters: inserter_list.map(mover) },
    });

    it("matches each copy by itself, with its own unit numbers", () => {
        expect(matchBuiltCopies(described(), config, 2)).toEqual([
            new Map([[1, 100], [2, 101], [3, 102]]),
            new Map([[1, 103], [2, 104], [3, 105]]),
        ]);
    });

    it("finds nothing missing from the config in two copies, and a third output inserter on the second, named by the config machine it takes from", () => {
        expect(buildPartsMissingFromConfig(described(), config, 2)).toEqual([]);
        const extra = { id: 7, unit_number: 106, name: "inserter", stack_size: 1, source: { type: "machine", id: 4 }, sink: { type: "belt", id: 2 } };
        expect(buildPartsMissingFromConfig(described([...inserters, extra]), config, 2).map(it => it.description))
            .toEqual(["inserter machine 2 (inserter) -> transport-belt (unit 106)"]);
    });

    it("matches the drills of each copy to the config's, by the machine each drops into", () => {
        const drilled = {
            ...config,
            drills: { configs: [{ id: 1, type: "electric-mining-drill", mined_item_name: "coal", speed_bonus: 0, productivity: 0, target: { type: "machine", id: 1 } }] },
        };
        // listed in the other order than the copies, and each with the recorder's machine id behind its target
        const build = { ...described(), drills: [
            { id: 2, unit_number: 301, name: "electric-mining-drill", mined_item_name: "coal", target: { type: "machine", id: 3 } },
            { id: 1, unit_number: 300, name: "electric-mining-drill", mined_item_name: "coal", target: { type: "machine", id: 1 } },
        ] };
        expect(matchBuiltDrills(build, drilled, 2)).toEqual([new Map([[1, 300]]), new Map([[1, 301]])]);
        // a drill into the machine the config's drill does not feed is left out
        const other = { ...build, drills: [{ id: 3, unit_number: 302, name: "electric-mining-drill", mined_item_name: "coal", target: { type: "machine", id: 2 } }] };
        expect(matchBuiltDrills(other, drilled, 2)).toEqual([new Map(), new Map()]);
    });

    it("refuses a count that is not the one found, in either direction", () => {
        expect(() => matchBuiltCopies(described(), config, 3)).toThrow("holds the config 3 times, and the build holds it 2");
        expect(() => matchBuiltCopies(described(), config, 1)).toThrow("holds the config 1 time, and the build holds it 2");
        expect(() => buildPartsMissingFromConfig(described(), config, 3)).toThrow("the build holds it 2");
    });

    it("is matched as one copy without the count, as it was: the second copy is a machine beyond the config and refused", () => {
        // the first copy's machines match; the second copy's are machines and inserters the config does not have
        const missing = buildPartsMissingFromConfig(described(), config);
        expect(missing.length).toBeGreaterThan(0);
        expect(missing.map(it => it.description).join(" ")).toContain("beyond the 1 the config has of that recipe");
        expect(matchBuiltCopies(described(), config)).toHaveLength(1);
        expect(matchBuiltCopies(described(), config)[0].size).toBeLessThan(6);
    });
});

describe("a build whose drill drops into a chest", () => {
    // the config: a belt feeds machine 1 through a wagon (chest 2) that a drill fills and an inserter empties; chest 1 is a supply
    const config = {
        machines: [{ id: 1, recipe: "iron-plate" }],
        inserters: [
            { id: 1, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 } },
            { id: 2, source: { type: "chest", id: 2 }, sink: { type: "machine", id: 1 } },
            { id: 3, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 2 } },
        ],
        belts: [],
        chests: [{ id: 1, type: "infinity-chest" }, { id: 2, type: "cargo-wagon" }],
        drills: { configs: [{ id: 1, type: "big-mining-drill", mined_item_name: "iron-ore", speed_bonus: 0, productivity: 0, target: { type: "chest", id: 2 } }] },
    } as any;
    // the build numbers its chests the other way round, and holds the config once per entry of `copies`
    const wagon = (copy: number) => 2 * copy + 1, supply = (copy: number) => 2 * copy + 2;
    const build = (copies: number) => {
        const list = Array.from({ length: copies }, (_, copy) => copy);
        const inserters = list.flatMap(copy => [
            { source: { type: "chest", id: supply(copy) }, sink: { type: "machine", id: copy + 1 } },
            { source: { type: "chest", id: wagon(copy) }, sink: { type: "machine", id: copy + 1 } },
            { source: { type: "machine", id: copy + 1 }, sink: { type: "chest", id: wagon(copy) } },
        ].map((ends, index) => ({ id: 3 * copy + index + 1, unit_number: 100 + 3 * copy + index, name: "stack-inserter", stack_size: 1, ...ends })));
        return {
            config: {
                inserters: inserters.map(({ source, sink }) => ({ source, sink })),
                belts: [],
                chests: list.flatMap(copy => [{ id: wagon(copy), type: "cargo-wagon" }, { id: supply(copy), type: "infinity-chest" }]).sort((a, b) => a.id - b.id),
            },
            machines: list.map(copy => ({ id: copy + 1, unit_number: 50 + copy, name: "electric-furnace", recipe: "iron-plate" })),
            inserters,
            // listed in the other order than the copies
            drills: [...list].reverse().map(copy => ({ id: copy + 1, unit_number: 300 + copy, name: "big-mining-drill", mined_item_name: "iron-ore", target: { type: "chest", id: wagon(copy) } })),
        };
    };

    it("matches the drill to the config's by the chest it drops into, whatever the build numbers it", () => {
        expect(matchBuiltDrills(build(1), config)).toEqual([new Map([[1, 300]])]);
    });

    it("matches the drill of each copy to the config's", () => {
        expect(matchBuiltDrills(build(2), config, 2)).toEqual([new Map([[1, 300]]), new Map([[1, 301]])]);
    });

    it("leaves out a drill into a chest of another type than the config's drill feeds, or that no matched inserter moves items of", () => {
        const into = (id: number) => ({ ...build(1), drills: [{ id: 1, unit_number: 302, name: "big-mining-drill", mined_item_name: "iron-ore", target: { type: "chest", id } }] });
        expect(matchBuiltDrills(into(supply(0)), config)).toEqual([new Map()]);
        expect(matchBuiltDrills(into(9), config)).toEqual([new Map()]);
    });

    it("leaves out a drill when the config has two chests of the type it drops into, which the inserters' match cannot tell apart", () => {
        const two_wagons = {
            ...config,
            chests: [...config.chests, { id: 3, type: "cargo-wagon" }],
            drills: { configs: [...config.drills.configs, { ...config.drills.configs[0], id: 2, target: { type: "chest", id: 3 } }] },
        };
        expect(matchBuiltDrills(build(1), two_wagons)).toEqual([new Map()]);
    });
});

describe("a clock the build came with", () => {
    const run = (more: object, blueprint = "0") => recordInFactorio({
        factorio: "/nowhere/factorio", save: "/nowhere/save.zip", blueprint, out: "/nowhere/recording.json",
        ticks: 600, warmup_ticks: 300, seed: [], unclocked: false, game_speed: 1000, timeout_seconds: 1, log: () => { }, ...more,
    });
    const counter = (constant: number) => encodeBlueprintFile({ blueprint: { entities: [{
        entity_number: 5, name: "decider-combinator",
        control_behavior: { decider_conditions: { conditions: [{ first_signal: { name: "signal-clock" }, constant }], outputs: [{ signal: { name: "signal-clock" } }] } },
    }] } } as any);

    it("is cut by the period it is named with, which the limit on a recording is checked against", async () => {
        await expect(run({ built_clock: { counter: 5, period: 100_000, first_value: 0 } }, counter(99_999))).rejects.toThrow("records 100000");
        await expect(run({ built_clock: { counter: 5, period: 216, first_value: 0 } }, counter(215))).rejects.toThrow("Factorio not found");
    });

    it("is told the copies of the config only with a clock to wire to them", async () => {
        const swapped = { blueprint: "0", schedule: { counted_ticks: 100, inserter_combinators: [] } };
        await expect(run({ copies: 3 })).rejects.toThrow("it needs a clock");
        await expect(run({ copies: 0, clock: swapped, config: {} })).rejects.toThrow("whole number of copies");
        await expect(run({ copies: 2, clock: swapped, config: {}, staged_start: { build_order: "ascending" } })).rejects.toThrow("staged start places one cell");
        await expect(run({ copies: 3, clock: swapped, config: {} })).rejects.toThrow("Factorio not found");
    });

    it("is refused with an unclocked run, a staged start, or a blueprint it does not fit", async () => {
        const built_clock = { counter: 5, period: 216, first_value: 0 as const };
        await expect(run({ built_clock, unclocked: true }, counter(215))).rejects.toThrow("kept or replaced");
        await expect(run({ built_clock, staged_start: { build_order: "ascending" } }, counter(215))).rejects.toThrow("kept or replaced");
        await expect(run({ built_clock }, counter(100))).rejects.toThrow("not the 216 asked for");
    });
});
