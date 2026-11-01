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

    it("keeps a running game clock's phase when a recording starts", () => {
        const tick = TickProvider.mutable(100);
        const clock = EnableControl.clocked({ periodDuration: Duration.ofTicks(192),
            enabledRanges: [OpenRange.from(126, 133)], tickProvider: tick, is_game_clock: true });
        clock.reset(true);
        tick.setCurrentTick(100 + 1280);
        expect(clock.isEnabled()).toBe(true);
        clock.reset(false);
        expect(clock.isEnabled()).toBe(true);
        tick.setCurrentTick(100 + 1280 + 6);
        expect(clock.isEnabled()).toBe(false);
        clock.reset(true);
        expect(clock.isEnabled()).toBe(false);
    });

    it("restarts a planning schedule for a new step", () => {
        const tick = TickProvider.mutable(100);
        const clock = EnableControl.clocked({ periodDuration: Duration.ofTicks(192),
            enabledRanges: [OpenRange.from(126, 133)], tickProvider: tick });
        clock.reset(true);
        tick.setCurrentTick(100 + 1280);
        expect(clock.isEnabled()).toBe(true);
        clock.reset(false);
        expect(clock.isEnabled()).toBe(false);
    });
});
