import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";

/**
 * A lane's underground entrances: where the game cuts the lane into lines, in tiles along the lane from the middle of copy
 * 1's pickup tile (upstream negative), which the run of the copies reads (state/shared-lane.ts `SharedLaneLines`)
 */
describe("the underground entrances of a lane", () => {
    const configWith = (lane: Record<string, unknown>, more: { strategy?: "export"; overrides?: Record<string, unknown>; consumption?: number } = {}) => ({
        setpoint: { item: "automation-science-pack", items_per_second: 240, copies: 9, copy_offset: { x: 9, y: 0 } },
        machines: [], inserters: [],
        belts: [{ id: 1, type: "turbo-transport-belt", flow_direction: 4, ...(more.strategy && { strategy: more.strategy }),
            lanes: [{ ingredient: "copper-plate", stack_size: 4, ...(more.consumption !== undefined && { consumption_per_second: more.consumption }), ...lane }] }],
        ...(more.overrides && { overrides: more.overrides }),
    });
    const problems = (input: unknown) => {
        const parsed = ConfigSchema.safeParse(input);
        return parsed.success ? [] : parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message }));
    };
    const PATH = "belts.0.lanes.0.underground_entrances";

    it("are read as stated, upstream of copy 1 too, and absent unless stated", () => {
        const config = ConfigSchema.parse(configWith({ lane_end: { kind: "dead_end" }, underground_entrances: [-7, 1, 10, 19, 28, 37, 46, 55, 64] }));
        expect(config.belts[0].lanes[0].underground_entrances).toEqual([-7, 1, 10, 19, 28, 37, 46, 55, 64]);
        expect(ConfigSchema.parse(configWith({})).belts[0].lanes[0].underground_entrances).toBeUndefined();
    });

    it("are refused out of order or twice, naming the lane and the fix", () => {
        for (const entrances of [[1, 10, 10], [10, 1]]) {
            expect(problems(configWith({ underground_entrances: entrances }))).toEqual([{ path: PATH,
                message: "Lane 1 of belt 1 states its underground entrances out of order or more than once. Write each entrance once, "
                    + "in tiles along the lane from the middle of copy 1's pickup tile, from upstream to downstream." }]);
        }
    });

    it("are refused as none: a lane with no underground belt states no entrances", () => {
        expect(problems(configWith({ underground_entrances: [] }))).toEqual([{ path: PATH,
            message: "Lane 1 of belt 1 states no underground entrance. Remove underground_entrances from a lane with no underground belt, "
                + "or write the middle of each entrance that has an exit after it." }]);
    });

    it("are taken on a lane of each copy or one that does not end in a dead end, which runs as one line: an end or a sharing chosen later meets no refusal", () => {
        expect(problems(configWith({ sharing: "per_copy", underground_entrances: [1, 10] }))).toEqual([]);
        for (const lane_end of [{ kind: "infinite" }, { kind: "unknown" }]) expect(problems(configWith({ lane_end, underground_entrances: [1, 10] }))).toEqual([]);
        expect(problems(configWith({ underground_entrances: [1, 10] }, { strategy: "export", consumption: 30 }))).toEqual([]);
    });

    it("are refused where a number is not finite", () => {
        // a belt is one of two kinds, so the refusal names the belt
        expect(problems(configWith({ underground_entrances: [1, Number.POSITIVE_INFINITY] })).map(it => it.path)).toEqual(["belts.0"]);
        expect(problems(configWith({ underground_entrances: [1, 10] }))).toEqual([]);
    });
});
