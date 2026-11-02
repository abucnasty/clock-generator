import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ConfigPaths, isExpectedRefusal } from "../../config/config-paths";
import type { PlanComposition } from "../../data-types/build-plan";
import { MAX_SIMULATION_TICKS } from "../plan/clock-period-limit";
import { wholeSwingPeriodsBelow } from "../whole-swing-periods";
import { planOfSample } from "./plan-test-helpers";
import { planSnapshotOf } from "./snapshot";

const SNAPSHOTS = path.join(__dirname, "__snapshots__");

const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);

/** The period of the planning run's own count: the first tried where the planned one is over the limit */
const plannedPeriodOf = (composition: PlanComposition): number => composition.over_limit_action.action === "none"
    ? composition.main_period.ticks : composition.over_limit_action.terms.tried[0].period_ticks;

describe("the build plan", () => {
    describe.each(Object.entries(ConfigPaths))("of %s", (key, file) => {
        it("matches its snapshot, its main period is the planning run's, and its duty is the feasibility pass's", async () => {
            const { config, feasibility, plan, validation } = await planOfSample(file);
            await expect(planSnapshotOf(plan, key)).toMatchFileSnapshot(path.join(SNAPSHOTS, `${key}.plan.json`));

            // the duty of every machine group, in the groups that hold its machines, with the feasibility pass's figures
            const listed = plan.groups.flatMap(group => group.duty);
            for (const duty of feasibility.duties) {
                const entries = listed.filter(entry => entry.producer === duty.group);
                expect(entries.flatMap(entry => entry.members).map(member => Number(member.split(":")[1])).sort((a, b) => a - b))
                    .toEqual([...duty.machines].sort((a, b) => a - b));
                for (const entry of entries) {
                    expect([entry.crafts_needed, entry.crafts_capacity, entry.duty].map(it => `${it.numerator}/${it.denominator}`))
                        .toEqual([duty.crafts_needed, duty.crafts_capacity, duty.duty].map(it => `${it.getNumerator}/${it.getDenominator}`));
                }
            }
            expect(listed.length).toBeGreaterThanOrEqual(feasibility.duties.length);

            if (isExpectedRefusal(key)) {
                expect(validation).toBeNull();
                expect(plan.composition).toBeNull();
                return;
            }
            expect(validation).not.toBeNull();
            const composition = plan.composition!;
            // the planning run's period and lcm, as validating the config makes them
            expect(plannedPeriodOf(composition)).toBe(validation!.period_ticks);
            if (composition.over_limit_action.action === "none") {
                expect(composition.lcm_terms.effective_lcm).toBe(validation!.used_lcm);
            }
            // the main period is the lcm of the group periods: the groups' cycles make the build's lcm
            const cycles = composition.lcm_terms.group_cycles.reduce((lcm, group) => lcm / gcd(lcm, group.cycles) * group.cycles, 1);
            expect(cycles).toBe(composition.lcm_terms.computed_lcm);
            // a period over the limit backs off to the count today's whole-swing arithmetic finds
            if (composition.over_limit_action.action === "swing-backoff") {
                const below = [...wholeSwingPeriodsBelow({ config_json: JSON.stringify(config), terminal_swing_count: composition.over_limit_action.terms.requested_swings },
                    MAX_SIMULATION_TICKS)];
                const found = below.find(period => period.period_ticks < MAX_SIMULATION_TICKS)!;
                expect([composition.swings, composition.main_period.ticks]).toEqual([found.terminal_swing_count, found.period_ticks]);
            }
        });
    });

    it("keeps no snapshot of a sample that is gone", () => {
        const keys = new Set(Object.keys(ConfigPaths));
        const files = fs.existsSync(SNAPSHOTS) ? fs.readdirSync(SNAPSHOTS).filter(file => file.endsWith(".plan.json")) : [];
        expect(files.filter(file => !keys.has(file.replace(/\.plan\.json$/, "")))).toEqual([]);
    });
});
