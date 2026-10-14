import { describe, test, expect } from "vitest"
import { MiningDrill } from "./mining-drill";
import { MiningDrillConfig } from "../../config/schema";
import { MiningProductivity } from "./mining-productivity";
import { TICKS_PER_SECOND } from "../../data-types";
import { FactorioDataService } from "../../data/factorio-data-service";

describe("MiningDrill", () => {

    const test_config: MiningDrillConfig = {
        id: 1,
        type: "electric-mining-drill",
        mined_item_name: "stone",
        speed_bonus: 12.5,
        target: { type: "machine", id: 3 }
    };

    test("sets productivity from level", () => {
        const level = 8000
        const mining_prod = MiningProductivity.fromLevel(level)
        const drill = MiningDrill.fromConfig(mining_prod, test_config);

        expect(drill.entity_id.id).toBe("drill:1");
        expect(drill.productivity.value).toBe(79990);
        expect(drill.productivity.normalized).toBe(799.9);
    });

    test("sets crafting rate based on speed bonus", () => {
        const level = 0
        const mining_prod = MiningProductivity.fromLevel(level)
        const drill = MiningDrill.fromConfig(mining_prod, test_config);

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
        const mining_prod_levels = [0, 100, 1000, 8000];

        const crafting_rates = mining_prod_levels.map(level => {
            const mining_prod = MiningProductivity.fromLevel(level)
            const drill = MiningDrill.fromConfig(mining_prod, test_config);
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
        const mining_prod_levels = [0, 100, 1000, 8000];
        mining_prod_levels.forEach(level => {
            const mining_prod = MiningProductivity.fromLevel(level)
            const drill = MiningDrill.fromConfig(mining_prod, test_config);

            const base_crafting_rate = drill.crafting_rate;
            const expected_production_rate_per_second = base_crafting_rate.amount_per_second * (1 + mining_prod.productivity.normalized);
            const expected_production_rate_per_tick = expected_production_rate_per_second / TICKS_PER_SECOND.toDecimal();
            console.log(`expected_production_rate_per_second: ${expected_production_rate_per_second}`);
            console.log(`expected_production_rate_per_tick: ${expected_production_rate_per_tick}`);

            expect(drill.production_rate.amount_per_second.toDecimal()).toBe(expected_production_rate_per_second);
            expect(drill.production_rate.amount_per_tick.toDecimal()).toBe(expected_production_rate_per_tick);
        })
    });
});