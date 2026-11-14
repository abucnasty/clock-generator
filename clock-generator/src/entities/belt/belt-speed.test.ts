import { describe, expect, it } from "vitest";
import { FactorioDataService } from "../../data/factorio-data-service";
import { BeltSpeed, BELT_PROTOTYPES, beltSpeedOf, laneItemsPerSecond, tilesPerTickOf } from "./belt-speed";

describe("the engine's belt speeds", () => {
    const data_belts = FactorioDataService.getAllTransportBelts();

    it("give every belt of the game data its speed: tiles a tick as the data has it, times 480 items a second", () => {
        expect(data_belts.length).toBeGreaterThan(0);
        for (const belt of data_belts) {
            expect(tilesPerTickOf(beltSpeedOf(belt.name)), belt.name).toBe(belt.speed);
            expect(beltSpeedOf(belt.name), belt.name).toBe(belt.speed * 480);
        }
    });

    it("name only the belts of the game data", () => {
        expect([...BELT_PROTOTYPES].sort()).toEqual(data_belts.map(belt => belt.name).sort());
    });

    it("are the four speeds of the game's belts", () => {
        expect(BELT_PROTOTYPES.map(beltSpeedOf)).toEqual([
            BeltSpeed.TRANSPORT_BELT, BeltSpeed.FAST_TRANSPORT_BELT, BeltSpeed.EXPRESS_TRANSPORT_BELT, BeltSpeed.TURBO_TRANSPORT_BELT,
        ]);
    });

    it("refuse a belt they do not name", () => {
        expect(() => beltSpeedOf("constructor")).toThrow("constructor is not a belt");
        expect(() => beltSpeedOf("stone-furnace")).toThrow("stone-furnace is not a belt");
    });

    it("give a lane half the belt's speed times its stack size", () => {
        expect(laneItemsPerSecond(beltSpeedOf("turbo-transport-belt"), 4).toDecimal()).toBe(120);
        expect(laneItemsPerSecond(beltSpeedOf("transport-belt"), 1).toDecimal()).toBe(7.5);
    });
});
