import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "./loader";
import { renameClockedPeriodInConfig, renameClockedPeriodToWindowCycle } from "./migrate-window-cycle";

const FORMER = "period_duration_ticks";
const clocked = (cycle: object) => ({ mode: "CLOCKED", ranges: [{ start: 0, end: 10 }], ...cycle });
const build = (inserter_control: object, drill_control: object) => JSON.stringify({
    setpoint: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1.25, prototype: "assembling-machine-3" }],
    inserters: [{ source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16, overrides: { enable_control: inserter_control } }],
    belts: [],
    chests: [{ type: "buffer-chest", id: 1, storage_size: 2, item_filter: "iron-gear-wheel" }],
    drills: { configs: [{ id: 1, type: "electric-mining-drill", mined_item_name: "iron-ore", speed_bonus: 0.5, productivity: 0,
        target: { type: "chest", id: 1 }, overrides: { enable_control: drill_control } }] },
});

describe("the former period_duration_ticks of a Clocked override", () => {
    it("is read as window_cycle_ticks, at the same place, and nothing else is changed", () => {
        const override = clocked({ [FORMER]: 120, latency_ticks: 2 });
        expect(renameClockedPeriodToWindowCycle(override)).toEqual(clocked({ window_cycle_ticks: 120, latency_ticks: 2 }));
        expect(Object.keys(renameClockedPeriodToWindowCycle(override) as object)).toEqual(["mode", "ranges", "window_cycle_ticks", "latency_ticks"]);
    });

    it("leaves the window_cycle_ticks of an override that has both, and anything that is not an override, as it is", () => {
        expect(renameClockedPeriodToWindowCycle(clocked({ [FORMER]: 1, window_cycle_ticks: 2 }))).toEqual(clocked({ window_cycle_ticks: 2 }));
        for (const value of [undefined, null, 3, "override", [], clocked({ window_cycle_ticks: 2 })]) expect(renameClockedPeriodToWindowCycle(value)).toBe(value);
    });

    it("is read in each inserter and each drill of a config that is not yet checked", () => {
        const config = JSON.parse(build(clocked({ [FORMER]: 120 }), clocked({ [FORMER]: 240 })));
        const read = renameClockedPeriodInConfig(config) as typeof config;
        expect(read.inserters[0].overrides.enable_control).toEqual(clocked({ window_cycle_ticks: 120 }));
        expect(read.drills.configs[0].overrides.enable_control).toEqual(clocked({ window_cycle_ticks: 240 }));
        for (const value of [undefined, null, 3, [], {}, { inserters: 3, drills: { configs: 3 } }]) expect(renameClockedPeriodInConfig(value)).toEqual(value);
    });

    it("loads on an inserter and on a drill, as the same config with the new name", async () => {
        const config = await parseConfig(build(clocked({ [FORMER]: 120 }), clocked({ [FORMER]: 240 })));
        expect(config).toEqual(await parseConfig(build(clocked({ window_cycle_ticks: 120 }), clocked({ window_cycle_ticks: 240 }))));
        const inserter = config.inserters[0].overrides?.enable_control;
        const drill = config.drills?.configs[0].overrides?.enable_control;
        expect(inserter).toMatchObject({ mode: "CLOCKED", window_cycle_ticks: 120 });
        expect(drill).toMatchObject({ mode: "CLOCKED", window_cycle_ticks: 240 });
        expect(inserter).not.toHaveProperty(FORMER);
    });

    it("keeps the window_cycle_ticks of a config that carries both", async () => {
        const config = await parseConfig(build(clocked({ [FORMER]: 1, window_cycle_ticks: 120 }), clocked({ window_cycle_ticks: 240, [FORMER]: 2 })));
        expect(config.inserters[0].overrides?.enable_control).toMatchObject({ window_cycle_ticks: 120 });
        expect(config.drills?.configs[0].overrides?.enable_control).toMatchObject({ window_cycle_ticks: 240 });
    });
});

describe("the legacy fixture", () => {
    it("loads as the same config with the new name", async () => {
        const text = fs.readFileSync(path.join(__dirname, "fixtures", "legacy", "period-duration-ticks.json"), "utf8");
        const config = await parseConfig(text);
        expect(config.inserters[0].overrides?.enable_control).toMatchObject({ window_cycle_ticks: 120 });
        expect(config.drills?.configs[0].overrides?.enable_control).toMatchObject({ window_cycle_ticks: 240 });
        expect(config).toEqual(await parseConfig(text.split(FORMER).join("window_cycle_ticks")));
    });
});
