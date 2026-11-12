import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { FlowAcrossCopySpacingError } from "../config/errors";
import type { Config } from "../config/schema";
import { validateConfig } from "./plan/validate-config";
import { flowsAcrossCopySpacing } from "./shared-lane-lanes";
import { sharedLaneRunsOf } from "./shared-lane-verdict";

/** The config with belt 3 stating the flow direction given, or none, and its lanes changed as `lane` says */
function withBelt3(config: Config, flow_direction: 0 | 4 | 8 | 12 | undefined, lane: Partial<Config["belts"][number]["lanes"][number]> = {}): Config {
    return { ...config, belts: config.belts.map(belt => {
        if (belt.id !== 3) return belt;
        const { flow_direction: _stated, ...rest } = belt;
        return { ...rest, ...(flow_direction !== undefined && { flow_direction }),
            lanes: belt.lanes.map(it => ({ ...it, ...lane })) as typeof belt.lanes } as typeof belt;
    }) };
}

// three copies 10 tiles apart along x; belt 3 carries coal on both lanes, which every copy takes from
describe("a belt whose stated flow direction is across the copy spacing", () => {
    let config: Config;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_240);
    });

    it("is refused, naming the belt, the stated direction and the axis of the spacing", () => {
        const across = withBelt3(config, 8);
        expect(flowsAcrossCopySpacing(across)).toEqual([{ belt_id: 3, flow_direction: 8, lanes: [1, 2] }]);
        let refusal: unknown;
        try { validateConfig(across); } catch (error) { refusal = error; }
        expect(refusal).toBeInstanceOf(FlowAcrossCopySpacingError);
        const message = (refusal as Error).message;
        expect(message).toContain("Belt 3 states flow_direction 8 (south), and the copies share both lanes of belt 3.");
        expect(message).toContain("copy_offset (10, 0) puts the copies along x");
        expect(message).toContain("4 (east) or 12 (west)");
    });

    it("is not refused where the flow is along the spacing, where no flow or no spacing is stated, or for one copy", () => {
        const { copy_offset: _offset, ...no_offset } = config.setpoint;
        for (const allowed of [
            withBelt3(config, 4), withBelt3(config, 12), withBelt3(config, undefined),
            { ...withBelt3(config, 8), setpoint: no_offset },
            { ...withBelt3(config, 8), setpoint: { ...config.setpoint, copies: 1, items_per_second: 80 } },
        ]) {
            expect(flowsAcrossCopySpacing(allowed)).toEqual([]);
            expect(() => validateConfig(allowed)).not.toThrow();
        }
    });

    it("is not refused on a lane each copy has of its own", () => {
        expect(flowsAcrossCopySpacing(withBelt3(config, 8, { sharing: "per_copy" }))).toEqual([]);
    });

    // a lane of unknown end that the copies do not share is laid out too, with the takers of one copy on it
    it("lays out a lane of unknown end that one copy alone takes from, with one copy or a lane per copy", () => {
        const unknown = { lane_end: { kind: "unknown" as const } };
        for (const alone of [
            { ...withBelt3(config, 8, unknown), setpoint: { ...config.setpoint, copies: 1, items_per_second: 80 } },
            withBelt3(config, 8, { ...unknown, sharing: "per_copy" }),
        ]) {
            const runs = sharedLaneRunsOf(alone);
            expect(runs.lanes.filter(lane => lane.belt_id === 3)).toEqual([{ belt_id: 3, lane: 1, shared: false, stated: { kind: "unknown" }, flow: { x: 0, y: 1 } },
                { belt_id: 3, lane: 2, shared: false, stated: { kind: "unknown" }, flow: { x: 0, y: 1 } }]);
            expect(runs.readings[0].layouts[0].rows.filter(row => row.belt_id === 3).map(row => row.copies)).toEqual([1, 1]);
        }
    });
});
