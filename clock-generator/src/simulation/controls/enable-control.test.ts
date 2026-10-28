import { describe, expect, it } from "vitest";
import { Duration, OpenRange } from "../../data-types";
import { TickProvider } from "../current-tick-provider";
import { EnableControl } from "./enable-control";

describe("a clock of the game", () => {
    it("enables by its windows", () => {
        const tick_provider = TickProvider.mutable(0);
        const clock = EnableControl.clocked({
            periodDuration: Duration.ofTicks(10), enabledRanges: [OpenRange.from(2, 4)], tickProvider: tick_provider, is_game_clock: true,
        });
        const enabled = Array.from({ length: 10 }, (_, tick) => { tick_provider.setCurrentTick(tick); return clock.isEnabled(); });
        expect(enabled).toEqual([false, false, true, true, true, false, false, false, false, false]);
    });
});
