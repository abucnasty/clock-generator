import { describe, expect, it } from "vitest";
import { fraction } from "../../../data-types/fraction";
import { OutputCyclePlan } from "./output-cycle";
import { gearSetpoint } from "../../../../tests/configs/fractional-setpoint";
import { TargetProductionRate } from "../../target-production-rate";
import { createEntityRegistryFromConfig } from "../simulation-context";
import { exactPeriod } from "../../../config/setpoint-rate";
import { ratioOf } from "../../../entities/traits/ratio";
import { destroyedTargetBasisOf } from "../../planner/exhaust";
import { ConfigPaths } from "../../../config/config-paths";
import { loadConfigFromFile } from "../../../config/loader";

describe("the ticks of a whole number of crafting cycles", () => {
    it("come out whole where the cycles are a whole number of ticks together", () => {
        // agricultural science: a hand of 16 every 19.2 ticks; 6 of them a cycle, 25 cycles a window cycle
        const six_swings = { total_duration_ticks: fraction(96, 5).multiply(6) };
        expect(OutputCyclePlan.ticksOfCycles(six_swings, 25)).toBe(2880);
        // the same in floating point is no whole number, which made the window cycle a "fractional" one
        expect(19.2 * 6 * 25).not.toBe(2880);
        const three_swings = { total_duration_ticks: fraction(96, 5).multiply(3) };
        expect(OutputCyclePlan.ticksOfCycles(three_swings, 25)).toBe(1440);
        expect(19.2 * 3 * 25).not.toBe(1440);
    });

    it("leave a period that is a fraction of a tick as it is", () => {
        // iron bacteria: 3 cycles of 576/19 ticks are 1728/19, 90.947 ticks
        const cycle = { total_duration_ticks: fraction(576, 19) };
        const window_cycle_ticks = OutputCyclePlan.ticksOfCycles(cycle, 3);
        expect(Number.isInteger(window_cycle_ticks)).toBe(false);
        expect(window_cycle_ticks).toBeCloseTo(1728 / 19, 12);
        // and 19 of those window cycles are the 1728 whole ticks its subtick clock counts
        expect(OutputCyclePlan.ticksOfCycles(cycle, 57)).toBe(1728);
        // metallurgic science: thirds
        expect(OutputCyclePlan.ticksOfCycles({ total_duration_ticks: fraction(320, 3) }, 1)).toBeCloseTo(106.6666666667, 9);
    });
});


it("refuses the four-item period that would round to 105 ticks", () => {
    const config = gearSetpoint({ numerator: 342857142857143, denominator: 150000000000000 }, 4);
    const target = TargetProductionRate.fromConfig(config.setpoint);
    expect(() => OutputCyclePlan.create(target, createEntityRegistryFromConfig(config), config, fraction(1)))
        .toThrow(/period.*exact|precision/i);
});


it("reduces the selected swing count before checking the base period", () => {
    const rate = { numerator: 342857142857143, denominator: 150000000000000 };
    const tick = TargetProductionRate.fromConfig(gearSetpoint(rate).setpoint).machine_production_rate.amount_per_tick;
    expect(ratioOf(exactPeriod(rate, [4, 1, tick.getDenominator, 1], [tick.getNumerator, 4], "base cycle")))
        .toEqual({ numerator: 9000000000000000, denominator: 342857142857143 });
});

it("refuses an unrepresentable destroyed-hand basis", async () => {
    const source = await loadConfigFromFile(ConfigPaths.IRON_ORE_VOIDER_400_EXACT_SPEED);
    const config = { ...source, setpoint: { ...source.setpoint, copies: 1,
        items_per_second: { numerator: 342857142857143, denominator: 150000000000000 } },
        inserters: source.inserters.map(arm => ({ ...arm, stack_size: 4 })) };
    const target = TargetProductionRate.fromConfig(config.setpoint);
    expect(() => destroyedTargetBasisOf(target, createEntityRegistryFromConfig(config), {})).toThrow(/destroyed hand period.*exact/);
});
