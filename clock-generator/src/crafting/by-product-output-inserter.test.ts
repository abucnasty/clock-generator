import { describe, it, expect } from "vitest";
import { generateClockForConfig } from "./generate-blueprint";
import { parseConfig } from "../config/loader";
import { quiet } from "./generate-blueprint-test-helpers";

const lane = (ingredient: string, infinite: boolean) => ({ ingredient, stack_size: 4, ...(infinite ? { lane_end: { kind: "infinite" } } : {}) });
const inserter = (id: number, source: object, sink: object, extra: object = {}) => ({ id, source, sink, stack_size: 16, ...extra });

/**
 * One biochamber on jellynut-processing, whose jelly is the setpoint. Inserter 4 takes the jellynut seed (a by-product no
 * machine of the build uses) out to a belt of its own: the plan leaves it out, and it runs on its own clock.
 */
const build = (seed_inserter_extra: object = {}) => JSON.stringify({
    setpoint: { recipe: "jelly", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "jellynut-processing", prototype: "biochamber", crafting_speed: 2, productivity: 0 }],
    belts: [
        { id: 1, type: "turbo-transport-belt", lanes: [lane("jellynut", true), lane("jellynut", true)] },
        { id: 2, type: "turbo-transport-belt", lanes: [lane("nutrients", true), lane("nutrients", true)] },
        { id: 3, type: "turbo-transport-belt", lanes: [lane("jelly", false), lane("jelly", false)] },
        { id: 4, type: "turbo-transport-belt", lanes: [lane("jellynut-seed", false), lane("jellynut-seed", false)] },
    ],
    inserters: [
        inserter(1, { type: "belt", id: 1, near_lane: 1 }, { type: "machine", id: 1 }),
        inserter(2, { type: "belt", id: 2, near_lane: 1 }, { type: "machine", id: 1 }),
        inserter(3, { type: "machine", id: 1 }, { type: "belt", id: 3 }, { filters: ["jelly"] }),
        inserter(4, { type: "machine", id: 1 }, { type: "belt", id: 4 }, { filters: ["jellynut-seed"], ...seed_inserter_extra }),
    ],
    chests: [],
});

const generate = async (seed_inserter_extra?: object) =>
    generateClockForConfig(await parseConfig(build(seed_inserter_extra)), { logger: quiet });

// An inserter taking a by-product out of the machine that makes the setpoint's item is no part of the plan; the input inserters'
// windows must not ask the plan for its transfers
describe("an inserter taking a by-product off the setpoint's machine", () => {
    it("generates, with the seed inserter on a by-product clock and out of the transfer plan", async () => {
        const result = await generate();
        const clock = result.unplanned_inserter_clocks?.["inserter:4"];
        expect(clock?.kind).toBe("by-product");
        expect(result.simulation_duration.ticks % clock!.modulus).toBe(0);
        expect(clock!.window.end).toBeLessThan(clock!.modulus);
        expect(result.serializable_transfer_plan.entities.some(entity => entity.item_transfers.some(it => it.item_name === "jellynut-seed"))).toBe(false);
        // a stable selection: the seed inserter's clock ran in the simulation without stalling the machine
        expect(result.stability_check.as_built?.holds ?? result.stability_check.holds).toBe(true);
    });

    it("generates when the config leaves the seed inserter always enabled, and gives it no clock", async () => {
        const result = await generate({ overrides: { enable_control: { mode: "ALWAYS" } } });
        expect(result.unplanned_inserter_clocks?.["inserter:4"]).toBeUndefined();
        expect(Object.keys(result.clock_windows)).not.toContain("inserter:4");
    });
});
