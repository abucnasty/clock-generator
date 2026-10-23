import { describe, test, expect } from "vitest"
import { MiningDrill } from "./mining-drill";
import { MiningDrillConfig } from "../../config/schema";
import { TICKS_PER_SECOND } from "../../data-types";
import { FactorioDataService } from "../../data/factorio-data-service";

describe("MiningDrill", () => {

    const test_config: MiningDrillConfig = {
        id: 1,
        type: "electric-mining-drill",
        mined_item_name: "stone",
        speed_bonus: 12.5,
        productivity: 0,
        target: { type: "machine", id: 3 }
    };
    const withProductivity = (productivity: number): MiningDrillConfig => ({ ...test_config, productivity });

    test("takes its own productivity, in percent", () => {
        const drill = MiningDrill.fromConfig(withProductivity(79990));

        expect(drill.entity_id.id).toBe("drill:1");
        expect(drill.productivity.value).toBe(79990);
        expect(drill.productivity.normalized).toBe(799.9);
    });

    test("sets crafting rate based on speed bonus", () => {
        const drill = MiningDrill.fromConfig(test_config);

        const mining_time = FactorioDataService.getResourceOrThrow("stone").minable.mining_time;
        expect(mining_time).toBe(1.0);

        const speed_bonus = test_config.speed_bonus;
        const base_mining_speed = FactorioDataService.getMiningDrillSpec(test_config.type).mining_speed;

        const effective_mining_speed = base_mining_speed + (base_mining_speed * speed_bonus);
        const crafts_per_second = effective_mining_speed / mining_time;

        expect(drill.crafting_rate.amount_per_second).toBe(effective_mining_speed);
        expect(drill.crafting_rate.amount_per_tick).toBe(effective_mining_speed / TICKS_PER_SECOND.toDecimal());
        expect(drill.crafting_rate.crafts_per_tick).toBe(crafts_per_second / TICKS_PER_SECOND.toDecimal());
    });

    test("productivity does not affect crafting rate", () => {
        const productivities = [0, 1000, 10000, 80000];

        const crafting_rates = productivities.map(productivity => {
            const drill = MiningDrill.fromConfig(withProductivity(productivity));
            return drill.crafting_rate;
        });

        const first_crafting_rate = crafting_rates[0];

        crafting_rates.forEach(crafting_rate => {
            expect(first_crafting_rate.amount_per_second).toBe(crafting_rate.amount_per_second);
            expect(first_crafting_rate.amount_per_tick).toBe(crafting_rate.amount_per_tick);
            expect(first_crafting_rate.crafts_per_tick).toBe(crafting_rate.crafts_per_tick);
        })
    })

    test("sets production rate based on productivity", () => {
        const productivities = [0, 82, 490, 1000, 80000];
        productivities.forEach(productivity => {
            const drill = MiningDrill.fromConfig(withProductivity(productivity));

            const base_crafting_rate = drill.crafting_rate;
            const expected_production_rate_per_second = base_crafting_rate.amount_per_second * (1 + productivity / 100);
            const expected_production_rate_per_tick = expected_production_rate_per_second / TICKS_PER_SECOND.toDecimal();

            expect(drill.production_rate.amount_per_second.toDecimal()).toBeCloseTo(expected_production_rate_per_second, 9);
            expect(drill.production_rate.amount_per_tick.toDecimal()).toBeCloseTo(expected_production_rate_per_tick, 11);
        })
    });
});