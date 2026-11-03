import { describe, expect, it } from "vitest";
import { Duration, OpenRange } from "../../data-types";
import { TickProvider } from "../current-tick-provider";
import { shiftRangesForCircuitLatency } from "../../crafting/clock";
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

describe("a clock of a period of part ticks", () => {
    // 640/3 ticks, as the metallurgic science pack's derived subtick clock: the one-tick window [212, 212], moved by the
    // 2 ticks of circuit latency, wraps to [2/3, 2/3] (0.666...6572 in floats), which tick 214 + 640 k meets in the game
    const period = 640 / 3;
    const windows = shiftRangesForCircuitLatency([OpenRange.from(212, 212)], period)
        .map(range => OpenRange.from(range.start, range.end));
    const enabledTicks = (exact_subtick_positions: boolean, ticks: number): number[] => {
        const tick_provider = TickProvider.mutable(0);
        const clock = EnableControl.clocked({
            periodDuration: Duration.ofTicks(period), enabledRanges: windows, tickProvider: tick_provider, is_game_clock: true,
            exact_subtick_positions,
        });
        const enabled: number[] = [];
        for (let tick = 0; tick < ticks; tick++) {
            tick_provider.setCurrentTick(tick);
            if (clock.isEnabled()) {
                enabled.push(tick);
            }
        }
        return enabled;
    };

    it("is met once every 640 ticks, period after period, in whole 1/3 ticks", () => {
        expect(enabledTicks(true, 64_000)).toEqual(Array.from({ length: 100 }, (_, k) => 214 + 640 * k));
    });

    it("is met in the first period only when worked out in floats", () => {
        expect(enabledTicks(false, 64_000)).toEqual([214]);
    });

    it("answers whole-tick windows as the float clock does", () => {
        const whole = [OpenRange.from(0, 7), OpenRange.from(16, 23), OpenRange.from(200, period)];
        const answers = (exact_subtick_positions: boolean) => {
            const tick_provider = TickProvider.mutable(0);
            const clock = EnableControl.clocked({
                periodDuration: Duration.ofTicks(period), enabledRanges: whole, tickProvider: tick_provider, exact_subtick_positions,
            });
            return Array.from({ length: 6400 }, (_, tick) => { tick_provider.setCurrentTick(tick); return clock.isEnabled(); });
        };
        expect(answers(true)).toEqual(answers(false));
    });
});
