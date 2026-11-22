import { expect, it, vi } from "vitest";
import { gearSetpoint } from "../../tests/configs/fractional-setpoint";
import { ratioOf } from "../entities/traits/ratio";
import { generateClockAlternatives } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";

it("generates one output hand per 105/4 ticks at the entered gear setpoint", () => {
    const result = generateClockAlternatives(gearSetpoint(), { logger: quiet });
    const selected = result.alternatives[result.selected_index];
    expect(selected).toMatchObject({ id: "takt_batches_observed_subtick", maker: "planned-belt-slack-subtick", verdict: "no recovery" });
    const made = selected.result;
    const plan = made.output_cycle_plan;
    expect(ratioOf(plan.production_rate.total_production_rate.amount_per_tick)).toEqual({ numerator: 4, denominator: 105 });
    expect(ratioOf(plan.production_rate.total_production_rate.amount_per_second)).toEqual({ numerator: 16, denominator: 7 });
    expect(ratioOf(plan.total_duration_ticks)).toEqual({ numerator: 105, denominator: 4 });
    expect(made.subtick?.clock).toEqual({ window_cycle_ticks: 105, scale: 4 });
    const output = [...plan.entity_transfer_map.entries()].find(([id]) => id.id === "inserter:2")?.[1];
    expect(output?.stack_size).toBe(1);
    expect(output && ratioOf(output.total_transfer_count)).toEqual({ numerator: 1, denominator: 1 });
    expect(made.used_terminal_swing_count).toBe(1);
    expect(made.stability_check.expected_output_items).toBe(1);
});

it("keeps the exact period for every candidate, trial and installed clock before rounding", () => {
    const exact = { numerator: 10_499_999_999, denominator: 100_000_000 };
    const ticks = exact.numerator / exact.denominator;
    // The generation project loads the CommonJS build. Observe its clock decisions through the full alternatives run.
    const clocks: typeof import("../common/subtick-window-cycle") = require("../../dist/common/subtick-window-cycle");
    const counter = vi.spyOn(clocks, "subtickClockForWindowCycle");
    try {
        const result = generateClockAlternatives(gearSetpoint({ numerator: 24_000_000_000, denominator: exact.numerator }, 4), { logger: quiet });
        const choices = counter.mock.calls.flatMap(([value, pair], index) => value === ticks ? [{ pair, decision: counter.mock.results[index].value }] : []);
        expect(choices.length).toBeGreaterThan(0);
        expect(choices.every(choice => choice.decision === null && choice.pair?.numerator === exact.numerator
            && choice.pair.denominator === exact.denominator)).toBe(true);
        for (const alternative of result.alternatives) {
            expect(alternative.result.schedule.counted_ticks).toBe(104);
            expect(alternative.rounded).toMatchObject({ window_cycle_ticks: 104, tried_on_its_window_cycle: false });
        }
    } finally { counter.mockRestore(); }
});
