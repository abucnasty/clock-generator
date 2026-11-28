import {describe, expect, test} from "vitest";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {variantJobs} from "./variant-jobs";

describe("the variants of the blast (variant-jobs.ts)", () => {
    const jobs = variantJobs();

    test("each variant has a name of its own, and says which test or game recording it is for", () => {
        expect(new Set(jobs.map(it => it.name)).size).toBe(jobs.length);
        for (const job of jobs) {
            expect(job.name, "a name that says the sample and what is set on it").toMatch(/^[A-Z0-9_]+$/);
            expect(job.qualifies.trim(), job.name).not.toBe("");
        }
    });

    test("each variant's config is a build of its own: a backed-up one states a dead end on each lane its sample leaves without an end", async () => {
        for (const job of jobs) {
            const config = await job.config();
            expect(config.machines.length, job.name).toBeGreaterThan(0);
            expect(Object.keys(config.overrides ?? {}), job.name).not.toContain("backed_up_belts");
            if (!job.name.endsWith("_BACKED_UP")) continue;
            const sample = await loadConfigFromFile(ConfigPaths[job.name.replace(/_BACKED_UP$/, "").replace(/_JELLY_HANDS_15$/, "") as keyof typeof ConfigPaths]);
            const unstated = sample.belts.flatMap(belt => belt.lanes.map((lane, index) => ({ belt: belt.id, index, lane: lane as { lane_end?: unknown; consumption_per_second?: number } })))
                .filter(({ lane }) => lane.lane_end === undefined && lane.consumption_per_second === undefined);
            expect(unstated.length, job.name).toBeGreaterThan(0);
            for (const { belt, index } of unstated) {
                const lane = config.belts.find(it => it.id === belt)!.lanes[index] as { lane_end?: { kind: string } };
                expect(lane.lane_end?.kind, `${job.name} belt ${belt} lane ${index + 1}`).toBe("dead_end");
            }
        }
    });
});
