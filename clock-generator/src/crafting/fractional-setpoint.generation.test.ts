import { expect, it } from "vitest";
import { gearSetpoint } from "../../tests/configs/fractional-setpoint";
import { ratioOf } from "../entities/traits/ratio";
import { generateClockAlternatives } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";

it("generates one output hand per 105/4 ticks at the entered gear setpoint", () => {
    const result = generateClockAlternatives(gearSetpoint(), { logger: quiet });
    const primary = result.alternatives.find(clock => clock.result.subtick);
    expect(primary).toBeDefined();
    const made = primary!.result;
    const plan = made.output_cycle_plan;
    expect(ratioOf(plan.production_rate.total_production_rate.amount_per_tick)).toEqual({ numerator: 4, denominator: 105 });
    expect(ratioOf(plan.production_rate.total_production_rate.amount_per_second)).toEqual({ numerator: 16, denominator: 7 });
    expect(ratioOf(plan.total_duration_ticks)).toEqual({ numerator: 105, denominator: 4 });
    expect(made.subtick?.clock).toEqual({ window_cycle_ticks: 105, scale: 4 });
    expect(made.used_terminal_swing_count).toBe(1);
    expect(made.stability_check.expected_output_items).toBe(1);
});
