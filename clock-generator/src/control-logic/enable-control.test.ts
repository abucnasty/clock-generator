import { afterEach, describe, expect, it } from "vitest";
import { Duration, OpenRange } from "../data-types";
import { TickProvider } from "./current-tick-provider";
import { EnableControl, GameClockWires } from "./enable-control";

describe("the wires from the clocks of the game", () => {
    afterEach(() => {
        GameClockWires.cut = false;
    });

    const clockOf = (is_game_clock: boolean) => {
        const tick_provider = TickProvider.mutable(0);
        const clock = EnableControl.clocked({
            periodDuration: Duration.ofTicks(10), enabledRanges: [OpenRange.from(2, 4)], tickProvider: tick_provider, is_game_clock,
        });
        return { clock, tick_provider };
    };

    it("leave a clock of the game enabling by its windows while they are whole", () => {
        const { clock, tick_provider } = clockOf(true);
        const enabled = Array.from({ length: 10 }, (_, tick) => { tick_provider.setCurrentTick(tick); return clock.isEnabled(); });
        expect(enabled).toEqual([false, false, true, true, true, false, false, false, false, false]);
    });

    it("have everything such a clock enables always enabled while they are cut, and the clock where it would be once they are back", () => {
        const { clock, tick_provider } = clockOf(true);
        GameClockWires.cut = true;
        for (let tick = 0; tick < 13; tick++) {
            tick_provider.setCurrentTick(tick);
            expect(clock.isEnabled(), `tick ${tick}`).toBe(true);
            expect(clock.isEnabledIn(1), `tick ${tick}`).toBe(true);
        }
        GameClockWires.cut = false;
        // tick 13 is place 3 of the period, tick 15 place 5
        tick_provider.setCurrentTick(13);
        expect(clock.isEnabled()).toBe(true);
        tick_provider.setCurrentTick(15);
        expect(clock.isEnabled()).toBe(false);
    });

    it("are not those of a clock of the plan", () => {
        const { clock, tick_provider } = clockOf(false);
        GameClockWires.cut = true;
        tick_provider.setCurrentTick(0);
        expect(clock.isEnabled()).toBe(false);
    });
});
