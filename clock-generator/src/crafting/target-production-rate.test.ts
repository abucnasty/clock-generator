import { describe, expect, it } from "vitest";
import { ratioOf } from "../entities/traits/ratio";
import { TargetProductionRate } from "./target-production-rate";

describe("exact setpoint units", () => {
    it.each([[1, 16, 7, 4, 105], [2.25, 64, 63, 16, 945]])("divides the total across %s copies", (copies, n, d, a, b) => {
        const items_per_second = { numerator: 16, denominator: 7 };
        const target = TargetProductionRate.fromConfig({ item: "iron-gear-wheel", copies, items_per_second });
        expect(ratioOf(target.total_production_rate.amount_per_second)).toEqual(items_per_second);
        expect(ratioOf(target.total_production_rate.amount_per_tick)).toEqual({ numerator: 4, denominator: 105 });
        expect(ratioOf(target.machine_production_rate.amount_per_second)).toEqual({ numerator: n, denominator: d });
        expect(ratioOf(target.machine_production_rate.amount_per_tick)).toEqual({ numerator: a, denominator: b });
    });

    it("refuses insufficient precision at the direct entry point", () => {
        expect(() => TargetProductionRate.fromConfig({ item: "gear", copies: 2,
            items_per_second: { numerator: 1, denominator: 100_000_000_000_000 } })).toThrow(/precision|exact/i);
    });
});
