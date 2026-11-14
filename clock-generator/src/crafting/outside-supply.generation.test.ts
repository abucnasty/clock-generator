import { beforeAll, describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { generateClockAlternatives, type ClockAlternativesResult } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";

/** The clock windows with each inserter renumbered by `shift` */
function renumbered(windows: Record<string, unknown>, shift: number): Record<string, unknown> {
    return Object.fromEntries(Object.entries(windows).map(([id, ranges]) => {
        const match = /^inserter:(\d+)$/.exec(id);
        return [match === null ? id : `inserter:${Number(match[1]) + shift}`, ranges];
    }));
}

const summary = (result: ClockAlternativesResult, shift: number) => ({
    selected: result.alternatives[result.selected_index]?.id,
    clocks: result.alternatives.map(alternative => ({
        id: alternative.id, verdict: alternative.verdict, holds: alternative.assessment.holds,
        window_cycle_ticks: alternative.result.simulation_duration.ticks,
        windows: renumbered(alternative.result.clock_windows, shift),
        checked_lanes: alternative.checked_lanes?.rows.map(row => `${row.belt_id}/${row.lane} ${row.state}`) ?? null,
    })),
});

// one assembler of the automation science sample, 9 copies 9 tiles apart, with four inserters that put gears and copper onto
// its input belt from infinity chests: supply from outside the build, which the run of the build as given does not clock
describe("outside supply in a build as given", () => {
    let fed: ClockAlternativesResult;
    let bare: ClockAlternativesResult;

    beforeAll(() => {
        fed = generateClockAlternatives(automationRow({ machines: 1, pitch: 9, feeders: true, copies: 9, copy_offset: { x: 9, y: 0 } }), { logger: quiet });
        bare = generateClockAlternatives(automationRow({ machines: 1, pitch: 9, copies: 9, copy_offset: { x: 9, y: 0 } }), { logger: quiet });
    });

    it("gives the clocks of the same build without it, with its inserters numbered as given", () => {
        expect(summary(fed, 0)).toEqual(summary(bare, 4));
    });

    it("gets no enable window and no combinator: in the blueprint it stays as built, always enabled", () => {
        for (const alternative of fed.alternatives) {
            const switched = alternative.result.schedule.inserter_combinators.flatMap(combinator => combinator.inserter_ids);
            expect(Object.keys(alternative.result.clock_windows).filter(id => ["inserter:1", "inserter:2", "inserter:3", "inserter:4"].includes(id))).toEqual([]);
            expect(switched.filter(id => id <= 4)).toEqual([]);
            expect(new Set(switched)).toEqual(new Set([5, 6]));
        }
    });

    it("leaves the input lanes in the check of the lanes the copies share", () => {
        const recommended = fed.alternatives[fed.selected_index];
        expect(recommended.checked_lanes?.rows.filter(row => row.belt_id === 1).map(row => row.lane)).toEqual([1, 2]);
    });
});
