import { describe, expect, it } from "vitest";
import { encodeBlueprintFile } from "../blueprints/serde";
import {
    assertRecordableTicks, buildPartsMissingFromConfig, clockInserterIds, clockPeriodTicks, matchBuiltInserters, MAX_RECORDED_TICKS,
    missingFromConfigMessage, recordedTicks, recordInFactorio,
} from "./factorio-harness";

describe("clockInserterIds", () => {
    it("reads the inserter ids the schedule combinators name", () => {
        const blueprint = encodeBlueprintFile({
            blueprint: {
                entities: [
                    { player_description: "Clock for [item=agricultural-science-pack]:\n- Cycle Count: 25 cycles" },
                    { player_description: "Inserters 3, 4, 6, 7 for [item=nutrients] into [recipe=pentapod-egg]\nSwing Counts:" },
                    { player_description: "Inserter 12 for [item=agricultural-science-pack]" },
                    { player_description: "Subtick clock, step 1 of 2" },
                    {},
                ],
            },
        } as any);
        expect(clockInserterIds(blueprint)).toEqual([3, 4, 6, 7, 12]);
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
        await expect(run(72_000, { clock: clock(1728, ONE_BASED), config: {} })).rejects.toThrow("The most that fits is 70848 ticks");
        // a clock the build comes with and keeps is the one the recording is cut by
        await expect(run(600, { blueprint: clock(100_000, ONE_BASED) })).rejects.toThrow("records 100000");
        // within the limit the run goes on, to where it finds no Factorio
        await expect(run(70_848, { clock: clock(1728, ONE_BASED), config: {} })).rejects.toThrow("Factorio not found");
    });
});
