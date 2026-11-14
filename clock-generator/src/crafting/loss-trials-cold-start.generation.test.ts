import { beforeAll, describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { generateClockAlternatives, type ClockAlternativesResult } from "./alternatives";
import { generateClockForConfig } from "./generate-clock";
import { quiet } from "./generate-blueprint-test-helpers";
import { movingPickupPhaseStarts } from "./moving-pickup-phase-starts";
import { disturbanceTrialVerdictOf } from "./trial";

// A row of automation science assemblers whose input belt is an express belt that moves on past the row: each input
// inserter takes from both lanes of a moving belt, so the clock-only check runs 63 more lane phases for each inserter (an
// express lane comes back to the same phase after 8 of its belt ticks). The loss trials run from the cold start only.
const row = (machines: number) => automationRow({ machines, pitch: 4, items_per_second: 48,
    input: { belt: "express-transport-belt", lane_end: "infinite" } });

describe("the loss trials of a build with moving lane phases", () => {
    it("are run from the cold start only: one run for each loss and one with nothing cut, each named by its loss", () => {
        // 2 assemblers: 126 lane-phase starts, from which the losses were also run before
        expect([...movingPickupPhaseStarts(row(2))].length).toBe(126);
        const first = generateClockForConfig(row(2), { logger: quiet });
        const details: string[] = [];
        const verdict = disturbanceTrialVerdictOf(row(2), first, quiet, detail => details.push(detail));
        expect(verdict.disturbance_trial).not.toBeNull();
        expect(details).toEqual(["Trying loss trial 1/4", "Trying loss trial 2/4", "Trying loss trial 3/4", "Trying loss trial 4/4"]);
    });

    it("say which loss they are on while the first clock is compared by its trials with the clocks made beside it", () => {
        // 4 assemblers, made as the first clock is made (checked as built, with room for a hand on every lane window): its
        // windows by arithmetic, with the room inside and shaped against ghost wakeups are each compared with it
        const details: string[] = [];
        const compared: string[] = [];
        const logger = { ...quiet, log: (message: string) => { if (/^(Room for one hand inside|Enable windows shaped against ghost wakeups)/.test(message)) compared.push(message); } };
        generateClockForConfig(row(4), { logger, verify_as_built: true, lane_hand_room: "always", on_progress_detail: detail => details.push(detail) });
        expect(compared.length).toBeGreaterThan(0);
        expect(details.some(it => /^Trying loss trial [1-4]\/4$/.test(it))).toBe(true);
        expect(details.some(it => /start/.test(it) && /^Trying loss trial/.test(it))).toBe(false);
    });
});

describe("the loss trials of a build whose 505 starts planned more than 200,000,000 ticks", () => {
    // 8 assemblers: each loss was run from the cold start and 504 lane-phase starts, 633,472,000 ticks planned, and the
    // trials were left out
    let result: ClockAlternativesResult;
    beforeAll(() => {
        result = generateClockAlternatives(row(8), { logger: quiet });
    });

    it("are run on every clock that holds: each has its verdict, and none ranks as a clock the trials could not be run on", () => {
        const held = result.alternatives.filter(it => it.assessment.holds);
        expect(held.length).toBeGreaterThan(0);
        for (const clock of held) {
            expect(clock.assessment.disturbance_trial).not.toBeNull();
            expect(clock.assessment.disturbance_trial_not_tried).toBeUndefined();
            expect(clock.ranking.recovery_untried).toBeFalsy();
        }
    });
});
