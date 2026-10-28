import { describe, expect, it } from "vitest";
import { BACKED_UP_GEOMETRIES, BACKED_UP_ITEMS, backedUpPickupConfig, simulatedHand } from "./backed-up-hand";

describe("simulated hand of a backed-up input belt", () => {
    for (const geometry of BACKED_UP_GEOMETRIES) {
        for (const item of BACKED_UP_ITEMS) {
            it(`${geometry}, ${item}: fills a hand of 16 in consecutive ticks`, async () => {
                // the hand the backed-up pickup game test records in the game
                expect(simulatedHand(await backedUpPickupConfig(geometry, item))).toBe("0,1,2,3");
            });
        }
    }
});
