import { describe, expect, it } from "vitest";
import { AlwaysEnabledControl, EnableControl } from "../../control-logic/enable-control";
import { Control } from "./control";

describe("an entity's Control", () => {
    it("reads what kind of control it is from its control, and again from the one a swap gives it", () => {
        const control = new Control(AlwaysEnabledControl);
        const kind = () => [control.is_game_clock, control.looks_ahead, control.decider_build_order];
        expect(kind()).toEqual([false, true, undefined]);
        const next: EnableControl = { isEnabled: () => false, is_game_clock: true, decider_build_order: 3 };
        control.use(next);
        expect(kind()).toEqual([true, false, 3]);
        control.use(AlwaysEnabledControl);
        expect(kind()).toEqual([false, true, undefined]);
    });

    // a latched control answers by how often it is asked: a swap must not ask either control
    it("asks the control it was last given only, as often as it is asked, and none at a swap", () => {
        const asked = { first: 0, second: 0 };
        const control = new Control({ isEnabled: () => { asked.first += 1; return true; } });
        expect(control.enabled()).toBe(true);
        control.use({ isEnabled: () => { asked.second += 1; return false; }, isEnabledIn: ticks => ticks > 1 });
        expect(asked).toEqual({ first: 1, second: 0 });
        expect([control.enabled(), control.enabledIn(1), control.enabledIn(2)]).toEqual([false, false, true]);
        expect(asked).toEqual({ first: 1, second: 1 });
    });
});
