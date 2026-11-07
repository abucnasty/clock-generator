import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "./loader";
import { renameLoopSeedItemsToKickStart } from "./migrate-kick-start";
import { renameTargetOutputToSetpoint } from "./migrate-setpoint";

const LEGACY = path.join(__dirname, "fixtures", "legacy");

describe("the former target_output of a config", () => {
    it("is read as the setpoint, at the same place, and nothing else is changed", () => {
        const config = { target_output: { recipe: "iron-gear-wheel" }, machines: [] };
        expect(renameTargetOutputToSetpoint(config)).toEqual({ setpoint: { recipe: "iron-gear-wheel" }, machines: [] });
        expect(Object.keys(renameTargetOutputToSetpoint(config) as object)).toEqual(["setpoint", "machines"]);
    });

    it("leaves the setpoint of a config that has both, and anything that is not a config, as it is", () => {
        expect(renameTargetOutputToSetpoint({ target_output: 1, setpoint: 2 })).toEqual({ setpoint: 2 });
        for (const value of [undefined, null, 3, "config", [], { setpoint: 2 }]) expect(renameTargetOutputToSetpoint(value)).toBe(value);
    });

    it("loads with a config that carries it, as the same config with the new name", async () => {
        const text = fs.readFileSync(path.join(LEGACY, "target-output.json"), "utf8");
        const current = JSON.parse(text);
        current.setpoint = current.target_output;
        delete current.target_output;
        const config = await parseConfig(text);
        expect(config.setpoint.recipe).toBe("iron-gear-wheel");
        expect(config).toEqual(await parseConfig(JSON.stringify(current)));
    });
});

describe("the former loop_seed_items override", () => {
    it("is read as kick_start_items, and nothing else is changed", () => {
        expect(renameLoopSeedItemsToKickStart({ loop_seed_items: 50, lcm: 2 })).toEqual({ kick_start_items: 50, lcm: 2 });
        expect(renameLoopSeedItemsToKickStart({ loop_seed_items: 0, kick_start_items: 7 })).toEqual({ kick_start_items: 7 });
        for (const value of [undefined, null, 3, "overrides", [], { lcm: 2 }]) expect(renameLoopSeedItemsToKickStart(value)).toBe(value);
    });

    it("loads with a config that carries it, as the same config with the new name", async () => {
        const text = fs.readFileSync(path.join(LEGACY, "loop-seed-items.json"), "utf8");
        const config = await parseConfig(text);
        expect(config.overrides).toEqual({ kick_start_items: 50, lcm: 2 });
    });
});
