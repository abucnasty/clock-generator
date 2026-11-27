import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { ConfigOverridesSchema, ConfigSchema } from "./schema";
import { loadConfigFromFile, parseConfig } from "./loader";

describe("the belt settings of the overrides before each lane stated its end", () => {
    const configWith = (overrides: Record<string, unknown>) => JSON.stringify({
        format: 1,
        setpoint: { item: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [], inserters: [],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }] }],
        overrides,
    });
    const refusal = (key: string) => `\`overrides.${key}\` is not read. State the end of each lane instead: \`"lane_end": {"kind": "dead_end"}\` where the belt is backed up, \`{"kind": "infinite"}\` where it moves.`;

    it.each<[string, unknown]>([["backed_up_belts", true], ["backed_up_belts", false], ["non_moving_belts", true]])("refuses overrides.%s (%s), and says to state the end of each lane", async (key, value) => {
        const text = configWith({ [key]: value, kick_start_items: 0 });
        expect(ConfigOverridesSchema.safeParse({ [key]: value }).success).toBe(false);
        await expect(parseConfig(text)).rejects.toThrow(refusal(key));
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), "belt-settings-"));
        try {
            const file = path.join(folder, "config.json");
            fs.writeFileSync(file, text);
            const error = await loadConfigFromFile(file).then(() => null, (thrown: Error) => thrown);
            expect(error?.message).toBe(`Configuration check failed at 'overrides.${key}': ${refusal(key)}`);
        } finally {
            fs.rmSync(folder, { recursive: true, force: true });
        }
    });

    it("reads overrides that state neither", () => {
        expect(ConfigOverridesSchema.parse({})).toEqual({});
        expect(ConfigOverridesSchema.parse({ kick_start_items: 0 })).toEqual({ kick_start_items: 0 });
    });
});

describe("lane facts in the configuration", () => {
    const configWith = (lane: Record<string, unknown>, strategy?: "export") => ({
        setpoint: { item: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [], inserters: [],
        belts: [{ id: 1, type: "turbo-transport-belt", ...(strategy && { strategy }), lanes: [{ ingredient: "iron-plate", stack_size: 4, ...lane }] }],
    });

    it.each<[string, Record<string, unknown>]>([
        ["a supply rate", { supply_rate: 120.7 }],
        ["a dead end", { lane_end: { kind: "dead_end" } }],
        ["an infinite end", { lane_end: { kind: "infinite" } }],
        ["an unknown end", { lane_end: { kind: "unknown" } }],
        ["a lane each copy has to itself", { sharing: "per_copy" }],
        ["a lane the copies share", { sharing: "shared" }],
        ["all three", { supply_rate: 60, lane_end: { kind: "dead_end" }, sharing: "per_copy" }],
    ])("keeps %s on a lane as the file states it", async (_, lane) => {
        const input = configWith(lane);
        for (const config of [ConfigSchema.parse(input), await parseConfig(JSON.stringify(input))]) {
            expect(config.belts[0].lanes[0]).toEqual({ ingredient: "iron-plate", stack_size: 4, ...lane });
        }
    });

    it("keeps the facts of an export lane beside its consumption, and refuses a lane end there: the consumption states what leaves its end", () => {
        const lane = { consumption_per_second: 5, supply_rate: 100, sharing: "per_copy" };
        expect(ConfigSchema.parse(configWith(lane, "export")).belts[0].lanes[0]).toEqual({ ingredient: "iron-plate", stack_size: 4, ...lane });
        expect(ConfigSchema.safeParse(configWith({ ...lane, lane_end: { kind: "infinite" } }, "export")).success).toBe(false);
    });

    it("adds no lane fact to a lane that states none", () => {
        expect(ConfigSchema.parse(configWith({})).belts[0].lanes[0]).toStrictEqual({ ingredient: "iron-plate", stack_size: 4 });
    });

    it.each<[string, Record<string, unknown>]>([
        ["a supply rate of zero", { supply_rate: 0 }],
        ["a supply rate that is not a number", { supply_rate: "120" }],
        ["an end of another kind", { lane_end: { kind: "loop" } }],
        ["an end given as text", { lane_end: "dead_end" }],
        ["a sharing in the words before shared and per copy", { sharing: "one_per_copy" }],
        ["a sharing of another kind", { sharing: "shared_by_copies" }],
    ])("refuses %s", (_, lane) => {
        expect(ConfigSchema.safeParse(configWith(lane)).success).toBe(false);
    });

    /** A copy that takes the lane's iron plate: an inserter from the belt, at the end of an underground belt (half a tile) or beside it */
    const takenWith = (lane: Record<string, unknown>, source: Record<string, unknown> = {}) => ({
        ...configWith(lane),
        machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 }],
        inserters: [{ id: 1, source: { type: "belt", id: 1, ...source }, sink: { type: "machine", id: 1 } }],
    });

    it("keeps the supply length of a lane that an inserter takes from", () => {
        expect(ConfigSchema.parse(takenWith({ supply_tiles: 11 })).belts[0].lanes[0]).toEqual({ ingredient: "iron-plate", stack_size: 4, supply_tiles: 11 });
        expect(ConfigSchema.parse(takenWith({ supply_tiles: 0.25 }, { pickup_length: 0.5, pickup_layout: "front-exit" })).belts[0].lanes[0].supply_tiles).toBe(0.25);
    });

    it.each<[string, Record<string, unknown>]>([["zero", { supply_tiles: 0 }], ["a negative length", { supply_tiles: -3 }], ["text", { supply_tiles: "11" }]])(
        "refuses a supply length of %s", (_, lane) => {
            expect(ConfigSchema.safeParse(takenWith(lane)).success).toBe(false);
        });

    it("refuses a supply length on a lane that no inserter takes from, and names the lane", async () => {
        await expect(parseConfig(JSON.stringify(configWith({ supply_tiles: 11 }))))
            .rejects.toThrow("Lane 1 of belt 1 states supply_tiles 11, and no inserter takes iron-plate from it.");
    });

    it("refuses a supply length that puts the supply inside the pickup, and names the lane", async () => {
        await expect(parseConfig(JSON.stringify(takenWith({ supply_tiles: 0.25 }))))
            .rejects.toThrow("Lane 1 of belt 1 states supply_tiles 0.25, less than half the pickup of an inserter that takes from it (0.5 tiles)");
    });
});

describe("the words of a lane end before the infinite end", () => {
    const configWith = (lane_end: Record<string, unknown>) => JSON.stringify({
        setpoint: { item: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [], inserters: [],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4, lane_end }] }],
    });

    it("refuses an end of kind outlet, and says to state an infinite end", async () => {
        await expect(parseConfig(configWith({ kind: "outlet" })))
            .rejects.toThrow("`lane_end.kind` \"outlet\" is not read. A lane end that is not a dead end is an infinite end: state `{\"kind\": \"infinite\"}`.");
    });

    it.each([{ kind: "infinite", outlet_rate: 40 }, { kind: "dead_end", outlet_rate: 40 }, { kind: "outlet", outlet_rate: 0 }])("refuses outlet_rate on %j, and says an infinite end takes every item", async lane_end => {
        await expect(parseConfig(configWith(lane_end)))
            .rejects.toThrow("`lane_end.outlet_rate` is not read. An infinite end takes every item that reaches it: remove the field.");
    });
});
