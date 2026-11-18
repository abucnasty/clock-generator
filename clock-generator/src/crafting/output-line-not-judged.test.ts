import { describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { outputLineNotJudgedInsights } from "./insights";

const ids = (config: Config) => outputLineNotJudgedInsights(config).map(insight => insight.id);

/** Gives every inserter that drops onto a belt a drop spot, as a config that states its drop geometry does */
const withDropSpots = (config: Config): Config => ({ ...config, inserters: config.inserters.map((inserter, index) =>
    inserter.sink.type === "belt" ? { ...inserter, sink: { ...inserter.sink, drop: { lane: 1 as const, position: index } } } : inserter) });

describe("the notice that the output line of hands that share a belt was not judged", () => {
    it("names the belt where two output hands of one copy drop onto it and the config states no output line", () => {
        const [notice, ...others] = outputLineNotJudgedInsights(automationRow({ machines: 2, pitch: 9, distinct: true }));
        expect(others).toEqual([]);
        expect(notice.id).toBe("output-line-not-judged-2");
        expect(notice.scope).toBe("build");
        expect(notice.title).toBe("The output line of the automation science pack belt was not judged");
        expect(notice.what).toContain("Two or more output inserters drop onto the automation science pack belt");
        expect(notice.what).toContain("as if each output inserter dropped onto a belt of its own");
        expect(notice.explanation).toContain("State the output line");
    });

    it("names the belt where one output hand of each of two copies drops onto it", () => {
        expect(ids(automationRow({ machines: 1, pitch: 9, copies: 2, copy_offset: { x: 9, y: 0 } }))).toEqual(["output-line-not-judged-2"]);
        expect(ids(automationRow({ machines: 1, pitch: 9, copies: 1.5, copy_offset: { x: 9, y: 0 } }))).toEqual(["output-line-not-judged-2"]);
    });

    it("says nothing of the same builds where the config states its output line", () => {
        // nine assemblers in one copy, and three copies of three, 27 tiles apart: the sample's scaffold
        const one = automationRow({ machines: 9, pitch: 9, output_line: {} });
        const three = automationRow({ machines: 3, pitch: 9, copies: 3, copy_offset: { x: 27, y: 0 }, output_line: {} });
        expect(one.output_belt).toBeDefined();
        expect(three.output_belt).toBeDefined();
        expect(ids(one)).toEqual([]);
        expect(ids(three)).toEqual([]);
        // the same builds without the line say it
        expect(ids(automationRow({ machines: 9, pitch: 9 }))).toEqual(["output-line-not-judged-2"]);
        expect(ids(automationRow({ machines: 3, pitch: 9, copies: 3, copy_offset: { x: 27, y: 0 } }))).toEqual(["output-line-not-judged-2"]);
    });

    it("says nothing where the hands state where they drop (a drop spot for each)", () => {
        expect(ids(withDropSpots(automationRow({ machines: 2, pitch: 9, distinct: true })))).toEqual([]);
        expect(ids(withDropSpots(automationRow({ machines: 1, pitch: 9, copies: 2, copy_offset: { x: 9, y: 0 } })))).toEqual([]);
    });

    it("says nothing of a build with one output hand a belt", () => {
        expect(ids(automationRow({ machines: 1, pitch: 9 }))).toEqual([]);
    });

    // the samples: those that state their output line (output_belt, or a drop spot for each hand) say nothing
    it("says nothing of the samples that state their output line", async () => {
        for (const name of ["AUTOMATION_SCIENCE_240", "MILITARY_SCIENCE_240", "GRENADE_240_FILLS_BELT_EXACTLY", "CHEMICAL_SCIENCE_240_SHARED_FOUNDRY", "LITHIUM_PLATE_80_SILO_CHEST",
            "FLYING_ROBOT_FRAME_80", "LOGISTIC_SCIENCE_240", "UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT"] as const) {
            expect(ids(await loadConfigFromFile(ConfigPaths[name])), name).toEqual([]);
        }
    });

    it("names the belt of the samples whose hands share a belt and state no line", async () => {
        expect(ids(await loadConfigFromFile(ConfigPaths.LDS_240))).toEqual(["output-line-not-judged-1"]);
        expect(ids(await loadConfigFromFile(ConfigPaths.ROCKET_FUEL_60))).toEqual(["output-line-not-judged-2"]);
        expect(ids(await loadConfigFromFile(ConfigPaths.ELECTRIC_FURNACE_20))).toEqual(["output-line-not-judged-2"]);
    });

    it("counts the hands of the target only: the circuits that a processing unit build exports do not count", async () => {
        expect(ids(await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT))).toEqual([]);
    });
});
