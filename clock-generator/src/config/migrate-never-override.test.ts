import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "./loader";
import { neverOverrideEntitiesOf, readNeverOverrideAsAuto, readNeverOverridesInConfig } from "./migrate-never-override";

const NEVER = { mode: "NEVER" };
const AUTO = { mode: "AUTO" };
const ALWAYS = { mode: "ALWAYS" };
const build = (inserter_control: object, drill_control: object) => JSON.stringify({
    setpoint: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1.25, prototype: "assembling-machine-3" }],
    inserters: [{ source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16, overrides: { enable_control: inserter_control } }],
    belts: [],
    chests: [{ type: "buffer-chest", id: 1, storage_size: 2, item_filter: "iron-gear-wheel" }],
    drills: { configs: [{ id: 1, type: "electric-mining-drill", mined_item_name: "iron-ore", speed_bonus: 0.5, productivity: 0,
        target: { type: "chest", id: 1 }, overrides: { enable_control: drill_control } }] },
});

describe("the former Never on override", () => {
    it("is read as Auto, and anything else is left as it is", () => {
        expect(readNeverOverrideAsAuto(NEVER)).toEqual(AUTO);
        for (const value of [undefined, null, 3, "NEVER", [], AUTO, ALWAYS, { mode: "CLOCKED", ranges: [{ start: 0, end: 10 }] }]) {
            expect(readNeverOverrideAsAuto(value)).toBe(value);
        }
    });

    it("is read in each inserter and each drill of a config that is not yet checked, and no other entity is changed", () => {
        const config = JSON.parse(build(NEVER, NEVER));
        const read = readNeverOverridesInConfig(config) as typeof config;
        expect(read.inserters[0].overrides.enable_control).toEqual(AUTO);
        expect(read.drills.configs[0].overrides.enable_control).toEqual(AUTO);
        expect(config.inserters[0].overrides.enable_control).toEqual(NEVER);
        const kept = JSON.parse(build(ALWAYS, AUTO));
        expect(readNeverOverridesInConfig(kept)).toEqual(kept);
        for (const value of [undefined, null, 3, [], {}, { inserters: 3, drills: { configs: 3 } }]) expect(readNeverOverridesInConfig(value)).toEqual(value);
    });

    it("names the inserters and drills that had it, by id, or by place in the list when an inserter has none", () => {
        const config = JSON.parse(build(NEVER, NEVER));
        expect(neverOverrideEntitiesOf(config)).toEqual([{ type: "inserter", id: 1 }, { type: "drill", id: 1 }]);
        config.inserters.push({ ...config.inserters[0], id: 7 }, { ...config.inserters[0], overrides: { enable_control: ALWAYS } });
        config.inserters[0].id = undefined;
        expect(neverOverrideEntitiesOf(config)).toEqual([{ type: "inserter", id: 1 }, { type: "inserter", id: 7 }, { type: "drill", id: 1 }]);
        expect(neverOverrideEntitiesOf(JSON.parse(build(AUTO, ALWAYS)))).toEqual([]);
        for (const value of [undefined, null, 3, [], {}, { inserters: 3, drills: 3 }]) expect(neverOverrideEntitiesOf(value)).toEqual([]);
    });

    it("loads on an inserter and on a drill, as the same config with Auto", async () => {
        const config = await parseConfig(build(NEVER, NEVER));
        expect(config).toEqual(await parseConfig(build(AUTO, AUTO)));
        expect(config.inserters[0].overrides?.enable_control).toEqual(AUTO);
        expect(config.drills?.configs[0].overrides?.enable_control).toEqual(AUTO);
    });
});

describe("the legacy fixture", () => {
    it("loads as the same config with Auto", async () => {
        const text = fs.readFileSync(path.join(__dirname, "fixtures", "legacy", "never-override.json"), "utf8");
        const config = await parseConfig(text);
        expect(config.inserters[0].overrides?.enable_control).toEqual(AUTO);
        expect(config.drills?.configs[0].overrides?.enable_control).toEqual(AUTO);
        expect(config).toEqual(await parseConfig(text.split('"NEVER"').join('"AUTO"')));
    });
});
