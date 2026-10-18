import { beforeAll, describe, expect, it } from "vitest";
import {
    backpressureLossesOf, judgeRecovery, LOSS_PLACES, LOSS_SHARES, lossId, lossLabel, lossTrialsPartOfTheWay, lossTrialsUntilStopped,
    MAX_LOSS_PERIODS, MAX_RECOVERY_PERIODS,
} from "./backpressure-loss";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";

describe("the trials of a loss", () => {
    it("are the same for every build: four places in the period, and a quarter, a half, three quarters and all of the time the build takes to stop", () => {
        expect(LOSS_PLACES).toEqual([0, 0.25, 0.5, 0.75]);
        expect(LOSS_SHARES).toEqual([0.25, 0.5, 0.75, 1]);
    });

    it("cut a loss that runs its course at each place, and restore it at the place it was cut at", () => {
        expect(lossTrialsUntilStopped(528)).toEqual([
            { cut_at: 0, restore_at: 0 }, { cut_at: 132, restore_at: 132 }, { cut_at: 264, restore_at: 264 }, { cut_at: 396, restore_at: 396 },
        ]);
    });

    it("end a loss part of the way after each share of the ticks the build takes to stop, at each place", () => {
        const trials = lossTrialsPartOfTheWay(100, 1000);
        expect(trials).toHaveLength(12);
        expect(trials.slice(0, 4)).toEqual([
            { cut_at: 0, loss_ticks: 250 }, { cut_at: 25, loss_ticks: 250 }, { cut_at: 50, loss_ticks: 250 }, { cut_at: 75, loss_ticks: 250 },
        ]);
        expect(Array.from(new Set(trials.map(trial => "loss_ticks" in trial ? trial.loss_ticks : null)))).toEqual([250, 500, 750]);
    });

    it("last a tick at least, for a build that stops at once", () => {
        expect(lossTrialsPartOfTheWay(100, 0, [0], [0.5])).toEqual([{ cut_at: 0, loss_ticks: 1 }]);
    });
});

describe("judging what a build made after a loss", () => {
    it("has it recover when the periods that repeat are all at the expected output, and counts the periods before", () => {
        // the state at the end of the fourth period was that at the end of the third: from there on it makes 704
        expect(judgeRecovery([640, 688, 704, 704], 704, 3, 8)).toEqual({ recovers: true, recovered_after_bins: 2, proven: true, ends_in: [704] });
    });

    it("does not have it recover when the periods that repeat are short, however many came out whole before", () => {
        expect(judgeRecovery([704, 704, 608, 624, 608, 624], 704, 2, 8)).toEqual({ recovers: false, recovered_after_bins: null, proven: true, ends_in: [608, 624, 608, 624] });
    });

    it("keeps the per-period recovery requirement when a repeating cycle only meets the average target", () => {
        expect(judgeRecovery([764, 772, 764, 772], 768, 0, 8)).toEqual({
            recovers: false, recovered_after_bins: null, proven: true, ends_in: [764, 772, 764, 772],
        });
    });

    it("holds it to its last periods where no state repeated, and takes fewer periods than that for no recovery", () => {
        expect(judgeRecovery([600, 704, 704, 704], 704, null, 3)).toEqual({ recovers: true, recovered_after_bins: 1, proven: false, ends_in: [704, 704, 704] });
        expect(judgeRecovery([704, 704], 704, null, 3).recovers).toBe(false);
    });
});

// Automation science: copper plates and gear wheels off one belt into a machine, the packs onto another
describe("the losses a build can have", () => {
    let config: Config;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
    });

    it("are one for each item that comes off a belt and one for each that leaves on one, the product of the build among them", () => {
        const losses = backpressureLossesOf(createEntityRegistryFromConfig(structuredClone(config)), "automation-science-pack");
        expect(losses.map(lossId).sort()).toEqual(["output:automation-science-pack", "supply:copper-plate", "supply:iron-gear-wheel"]);
        expect(losses.map(lossLabel)).toContain("copper-plate stops arriving");
        expect(losses.map(lossLabel)).toContain("automation-science-pack is not taken away");
    });
});

describe("what the generator calls stable", () => {
    it("lets a loss last until the build has stopped, 200 periods at most, and gives the build 40 periods to be back", () => {
        expect(MAX_LOSS_PERIODS).toBe(200);
        expect(MAX_RECOVERY_PERIODS).toBe(40);
    });
});
