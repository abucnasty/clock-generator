import {describe, expect, test} from "vitest";
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

    test("each variant's config is a build of its own: the backed-up ones say so, the others do not", async () => {
        for (const job of jobs) {
            const config = await job.config();
            expect(config.machines.length, job.name).toBeGreaterThan(0);
            expect(config.overrides?.backed_up_belts === true, job.name).toBe(job.name.endsWith("_BACKED_UP"));
        }
    });
});
