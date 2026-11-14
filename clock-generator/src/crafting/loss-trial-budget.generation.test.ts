import { beforeAll, describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { generateClockAlternatives, type ClockAlternativesResult } from "./alternatives";
import { generateClockForConfig } from "./generate-clock";
import { quiet } from "./generate-blueprint-test-helpers";
import { LOSS_TRIAL_BUDGET_TICKS } from "./plan/clock-window-cycle-limit";
import { disturbanceTrialVerdictOf, lossTrialEstimateOfClock } from "./trial";

// A row of automation science assemblers whose input belt is an express belt that moves on past the row: each input
// inserter takes from both lanes of a moving belt, so each loss is tried from 63 more lane phases for each inserter (an
// express lane comes back to the same phase after 8 of its belt ticks).
const row = (machines: number) => automationRow({ machines, pitch: 4, items_per_second: 48,
    input: { belt: "express-transport-belt", lane_end: "infinite" } });

describe("the disturbance trials of a clock that plans more ticks than the budget", () => {
    // 8 assemblers: 505 starts of each loss
    let result: ClockAlternativesResult;
    beforeAll(() => {
        result = generateClockAlternatives(row(8), { logger: quiet });
    });

    it("are not run: the clock keeps the verdict of what it holds, with the code and its numbers", () => {
        const held = result.alternatives.filter(it => it.assessment.holds);
        expect(held.length).toBeGreaterThan(0);
        for (const clock of held) {
            const estimate = lossTrialEstimateOfClock(row(8), clock.result);
            expect(estimate!.ticks).toBeGreaterThan(LOSS_TRIAL_BUDGET_TICKS);
            expect(clock.assessment.disturbance_trial).toBeNull();
            expect(clock.assessment.disturbance_trial_not_tried_reason).toEqual({ code: "loss_trials_over_budget", data: { ...estimate, budget: LOSS_TRIAL_BUDGET_TICKS } });
            expect(clock.assessment.disturbance_trial_not_tried).toBeDefined();
            expect(clock.verdict).toBe("stable");
        }
        expect(held[0].assessment.disturbance_trial_not_tried_reason!.data).toMatchObject({ losses: 3, starts: 505 });
    });

    it("rank it as a clock the trials could not be run on", () => {
        const held = result.alternatives.filter(it => it.assessment.holds && it.ranking.meets_target_rate);
        expect(held.length).toBeGreaterThan(0);
        expect(held.every(it => it.ranking.recovery_untried)).toBe(true);
    });
});

describe("the disturbance trials of a clock within the budget", () => {
    it("are run, and say which loss and which start they are on", () => {
        // 2 assemblers: 127 starts of each loss
        const first = generateClockForConfig(row(2), { logger: quiet });
        expect(lossTrialEstimateOfClock(row(2), first)!.ticks).toBeLessThanOrEqual(LOSS_TRIAL_BUDGET_TICKS);
        const details: string[] = [];
        const verdict = disturbanceTrialVerdictOf(row(2), first, quiet, detail => details.push(detail));
        expect(verdict.disturbance_trial).not.toBeNull();
        expect(verdict.disturbance_trial_not_tried_reason).toBeUndefined();
        expect(details[0]).toBe("Trying loss trial 1/4, start 1/127");
        expect(details).toContain("Trying loss trial 1/4, start 127/127");
        expect(details.every(it => /^Trying loss trial [1-4]\/4, start \d+\/127$/.test(it))).toBe(true);
    });

    it("say so while the first clock is compared by its trials with the clocks made beside it", () => {
        // 4 assemblers (253 starts), made as the first clock is made (checked as built, with room for a hand on every lane
        // window): its windows by arithmetic, with the room inside and shaped against ghost wakeups are each compared with it
        const details: string[] = [];
        const compared: string[] = [];
        const logger = { ...quiet, log: (message: string) => { if (/^(Room for one hand inside|Enable windows shaped against ghost wakeups)/.test(message)) compared.push(message); } };
        generateClockForConfig(row(4), { logger, verify_as_built: true, lane_hand_room: "always", on_progress_detail: detail => details.push(detail) });
        expect(compared.length).toBeGreaterThan(0);
        expect(details.some(it => /^Trying loss trial \d+\/4, start \d+\/253$/.test(it))).toBe(true);
    });
});
