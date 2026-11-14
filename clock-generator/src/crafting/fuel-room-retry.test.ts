import { describe, expect, it } from "vitest";
import { withFuelHandRoomWhereNeeded } from "./alternatives";
import type { BlueprintGenerationResult } from "./generate-blueprint";

/** A clock as the retry reads it: whether it holds as built, its belt, its window cycle and the room it was given */
const clock = (holds: boolean, fuel_hand_room_ticks: Record<string, number> = {}): BlueprintGenerationResult => ({
    stability_check: { holds, as_built: { holds } },
    belt: { kind: "moving" },
    simulation_duration: { ticks: 480 },
    fuel_hand_room_ticks,
}) as unknown as BlueprintGenerationResult;

describe("a clock made again with room for its fuel", () => {
    it("is not made where the clock holds without the room", () => {
        const without = clock(true);
        let made_again = 0;
        expect(withFuelHandRoomWhereNeeded(() => without, () => { made_again++; return clock(true, { "inserter:11": 6 }); })).toBe(without);
        expect(made_again).toBe(0);
    });

    it("takes the place of a clock that does not hold, where it holds with the room", () => {
        const with_room = clock(true, { "inserter:11": 6 });
        expect(withFuelHandRoomWhereNeeded(() => clock(false), () => with_room)).toBe(with_room);
    });

    it("leaves a clock that does not hold where it does not hold with the room either, or got none", () => {
        const without = clock(false);
        expect(withFuelHandRoomWhereNeeded(() => without, () => clock(false, { "inserter:11": 6 }))).toBe(without);
        expect(withFuelHandRoomWhereNeeded(() => without, () => clock(true))).toBe(without);
        expect(withFuelHandRoomWhereNeeded(() => without, () => undefined)).toBe(without);
    });
});
