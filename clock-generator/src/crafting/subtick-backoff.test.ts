import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { clockIdentity } from "./clock-identity";
import { generateClockAlternatives } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";

// both switches on, for this file only: every subtick clock is judged on P, and the swing backoff runs beside a first clock
// that holds
vi.mock("./judged-period-switch", () => ({ SUBTICK_CLOCK_JUDGED_ON_ROUNDED_PERIOD: true }));
vi.mock("./subtick-backoff-switch", () => ({ SUBTICK_BACKOFF_BESIDE_A_CLOCK_THAT_HOLDS: true }));

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Metallurgic science 45. On the whole ticks of the subtick clock the time-study clock of 4 output swings (1280/3 ticks)
// fails, and so does the one of 3; the backoff makes the clock of 2 (640/3 ticks, 472.5 wake-ups a minute), the one
// selected. On P the 4-swing clock holds (3,512 wake-ups a minute), so the backoff stopped there, and the moved output swing
// on 1280/3 ticks (3,393.6) was selected. With the backoff beside a clock that holds, the counts below are tried: on P the
// 2-swing clock does not hold either (the padding search confirms paddings 1 to 5, which pass P's first span but not the
// check as built, and stops before padding 0, the full period's clock), and the 1-swing clock (320/3 ticks) holds with
// fewer wake-ups than the 4-swing one and is selected.
describe("the swing backoff beside a subtick clock that holds on P", () => {
    it("selects the 1-swing time-study clock of metallurgic science 45, fewer wake-ups than the 4-swing one", async () => {
        const generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_45), { logger: quiet });
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("time_study_windows_subtick");
        expect(selected.result.used_terminal_swing_count).toBe(1);
        expect(selected.result.simulation_duration.ticks).toBeCloseTo(320 / 3, 9);
        expect(selected.assessment.wake_ups_per_minute).toBeCloseTo(1933.30, 1);
        expect(sha(clockIdentity(selected.result.subtick ?? selected.result))).toMatch(/^6ee22d64/);
    }, 600_000);
});
