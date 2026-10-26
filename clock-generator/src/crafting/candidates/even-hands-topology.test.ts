import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { ChestType } from "../../common/entity-types";
import * as planning from "../plan/plan-run";
import * as contexts from "../sequence/simulation-context";
import { evenHandsClock } from "./even-hands";

afterEach(() => vi.restoreAllMocks());

describe("even-hands hard topology preflight", () => {
    let belt: Config, drill: Config;
    beforeAll(async () => {
        belt = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        drill = await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE);
    });
    it("refuses belt sources using the existing source rule before any planning", () => {
        const plan = vi.spyOn(planning, "planRun").mockImplementation(() => { throw new Error("planning must not run"); });
        const before = JSON.stringify(belt);
        expect(belt.inserters.some(inserter => inserter.source.type === "belt")).toBe(true);
        expect(() => evenHandsClock(belt)).toThrow("only made where every inserter takes from a machine or a chest");
        expect(plan).not.toHaveBeenCalled();
        expect(JSON.stringify(belt)).toBe(before);
    });
    it("refuses drills using the existing rule before prepare/count arithmetic", () => {
        const plan = vi.spyOn(planning, "planRun").mockImplementation(() => { throw new Error("planning must not run"); });
        expect(drill.drills?.configs.length).toBeGreaterThan(0);
        expect(() => evenHandsClock(drill)).toThrow("even hands are not made for a build with mining drills");
        expect(plan).not.toHaveBeenCalled();
    });
    const supported: Config = {
        target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: "iron-gear-wheel", prototype: "assembling-machine-3", crafting_speed: 1, productivity: 0 }],
        belts: [], chests: [
            { type: ChestType.INFINITY_CHEST, id: 1, item_filter: [{ item_name: "iron-plate", request_count: 200 }] },
            { type: ChestType.INFINITY_CHEST, id: 2, item_filter: [], remove_unfiltered_items: true },
        ],
        inserters: [
            { source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 } },
            { source: { type: "machine", id: 1 }, sink: { type: "chest", id: 2 } },
        ],
    };
    it("lets supported machine/chest topology reach unchanged planning and propagate its errors", () => {
        const sentinel = new Error("actual later planning error");
        const plan = vi.spyOn(planning, "planRun").mockImplementation(() => { throw sentinel; });
        expect(() => evenHandsClock(supported)).toThrow(sentinel);
        expect(plan).toHaveBeenCalledOnce();
        expect(plan.mock.calls[0][0]).toBe(supported);
    });
    it("propagates registry construction errors before planning", () => {
        const sentinel = new Error("actual registry construction error");
        const registry = vi.spyOn(contexts, "createEntityRegistryFromConfig").mockImplementation(() => { throw sentinel; });
        const plan = vi.spyOn(planning, "planRun").mockImplementation(() => { throw new Error("planning must not run"); });
        expect(() => evenHandsClock(supported)).toThrow(sentinel);
        expect(registry).toHaveBeenCalledOnce();
        expect(registry.mock.calls[0][0]).toBe(supported);
        expect(plan).not.toHaveBeenCalled();
    });
});
