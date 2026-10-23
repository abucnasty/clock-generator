import { describe, expect, it } from "vitest";
import { chestName, ChestType } from "../common/entity-types";
import { Duration } from "../data-types";
import { chestDrillInsights } from "./insights";

describe("the names of the chests", () => {
    it("say what a container is, and a buffer or infinity chest is a chest", () => {
        expect(chestName(ChestType.CAR, 1)).toBe("Car 1");
        expect(chestName(ChestType.TANK, 4)).toBe("Tank 4");
        expect(chestName(ChestType.CARGO_WAGON, 2)).toBe("Cargo wagon 2");
        expect(chestName(ChestType.ROCKET_SILO, 3)).toBe("Rocket silo 3");
        expect(chestName(ChestType.BUFFER_CHEST, 5)).toBe("Chest 5");
        expect(chestName(ChestType.INFINITY_CHEST, 6)).toBe("Chest 6");
    });
});

describe("the note on the drills into containers", () => {
    it("names the container the drill drops into by what it is", () => {
        const [insight] = chestDrillInsights({
            simulation_duration: Duration.ofTicks(72),
            chest_drills: [{ drill_id: 1, chest_id: 1, chest_type: ChestType.CAR, item: "iron-ore", planned: true, enabled_ticks: 1, window_count: 1 }],
        });
        expect(insight.title).toBe("The drills into containers are enabled just in time");
        expect(insight.what).toBe("Drill 1 drops iron ore into Car 1 and is enabled 1 tick of the 72-tick period, in 1 window.");
    });
});
