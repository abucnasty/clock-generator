import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";

/**
 * A lane's underground entrances: where the game cuts the lane into lines, in tiles along the lane from the middle of copy
 * 1's pickup tile (upstream negative), as the lane in lines reads them with `lane_lines` (shared-lane.ts)
 */
describe("the underground entrances of a lane", () => {
    const configWith = (lane: Record<string, unknown>, more: { strategy?: "export"; overrides?: Record<string, unknown>; consumption?: number } = {}) => ({
        setpoint: { recipe: "automation-science-pack", items_per_second: 240, copies: 9, copy_offset: { x: 9, y: 0 } },
        machines: [], inserters: [],
        belts: [{ id: 1, type: "turbo-transport-belt", flow_direction: 4, ...(more.strategy && { strategy: more.strategy }),
            lanes: [{ ingredient: "copper-plate", stack_size: 4, ...(more.consumption !== undefined && { consumption_per_second: more.consumption }), ...lane }] }],
        ...(more.overrides && { overrides: more.overrides }),
    });
    const problems = (input: unknown) => {
        const parsed = ConfigSchema.safeParse(input);
        return parsed.success ? [] : parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message }));
    };

    it("are read as stated, upstream of copy 1 too, and the switch that reads them is off unless set", () => {
        const config = ConfigSchema.parse(configWith({ lane_end: { kind: "dead_end" }, underground_entrances: [-7, 1, 10, 19, 28, 37, 46, 55, 64] },
            { overrides: { lane_lines: true } }));
        expect(config.belts[0].lanes[0].underground_entrances).toEqual([-7, 1, 10, 19, 28, 37, 46, 55, 64]);
        expect(config.overrides?.lane_lines).toBe(true);
        expect(ConfigSchema.parse(configWith({})).overrides?.lane_lines).toBeUndefined();
    });

    it("are refused out of order or twice, with the fix", () => {
        for (const entrances of [[1, 10, 10], [10, 1]]) {
            expect(problems(configWith({ underground_entrances: entrances }))).toEqual([{ path: "belts.0.lanes.0.underground_entrances",
                message: "Lane 1 of belt 1 states its underground entrances out of order or more than once. Write each entrance once, "
                    + "in tiles along the lane from the middle of copy 1's pickup tile, from upstream to downstream." }]);
        }
    });

    it("are refused on a lane each copy has to itself: only a lane the copies share runs as lines", () => {
        expect(problems(configWith({ sharing: "per_copy", underground_entrances: [1, 10] }))).toEqual([{ path: "belts.0.lanes.0.underground_entrances",
            message: "Lane 1 of belt 1 is a lane of each copy, and only a lane that the copies share runs as lines. Remove its underground entrances, or state the lane as shared." }]);
    });

    it("are refused on a lane whose end is not a dead end: the lane in lines runs to a dead end only", () => {
        const message = "Lane 1 of belt 1 states underground entrances, and the lane in lines runs to a dead end only. "
            + "Remove its underground entrances, or state its lane_end as dead_end if the lane stops after the last copy.";
        for (const lane_end of [{ kind: "infinite" }, { kind: "unknown" }]) {
            expect(problems(configWith({ lane_end, underground_entrances: [1, 10] }))).toEqual([{ path: "belts.0.lanes.0.underground_entrances", message }]);
        }
        expect(problems(configWith({ underground_entrances: [1, 10] }, { overrides: { backed_up_belts: false } })))
            .toEqual([{ path: "belts.0.lanes.0.underground_entrances", message }]);
        expect(problems(configWith({ underground_entrances: [1, 10] }, { strategy: "export", consumption: 30 })))
            .toEqual([{ path: "belts.0.lanes.0.underground_entrances", message }]);
    });

    it("are refused where a number is not finite", () => {
        // a belt is one of two kinds, so the refusal names the belt
        expect(problems(configWith({ underground_entrances: [1, Number.POSITIVE_INFINITY] })).map(it => it.path)).toEqual(["belts.0"]);
        expect(problems(configWith({ underground_entrances: [1, 10] }))).toEqual([]);
    });
});
