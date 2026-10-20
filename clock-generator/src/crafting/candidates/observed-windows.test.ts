import { expect, it } from "vitest";
import { observedWindowsClock } from "./observed-windows";
import { generateClockWithSwingBackoff } from "../generate-clock";
import { pickupClockConfig, pickupClockSpeedCases } from "../../../tests/game/builds/pickup-clock-speed-coverage";

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

// The express moving underground pickups: observed windows at 3 output swings hold 528 a period from every start, and
// did in the game with exact recovery after every disturbance, while the run they are observed in moves 560. Judged by
// that run, the swing backoff went past 3 and the build had no clock for moving belts.
it("holds observed windows by their own clock-only check, not by the run they were observed in", async () => {
    const variant = pickupClockSpeedCases("electromagnetic").find(it => it.name === "electromagnetic-express-underground-entrance-moving")!;
    const config = await pickupClockConfig(variant);
    const result = generateClockWithSwingBackoff({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } },
        { logger: quiet }, (swings_config, options) => observedWindowsClock(swings_config, options, "always"));

    expect(result.used_terminal_swing_count).toBe(3);
    expect(result.stability_check.holds).toBe(true);
    expect(result.stability_check.as_built).toMatchObject({ holds: true, actual_output_items: 528 });
    expect(result.swing_backoff_report?.attempts.at(-1)).toMatchObject({ terminal_swing_count: 3, holds: true,
        actual_output_items: 560, expected_output_items: 528 });
});
