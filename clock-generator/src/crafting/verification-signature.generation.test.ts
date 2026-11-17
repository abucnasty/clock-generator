import {afterEach, describe, expect, it, vi} from "vitest";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {generateClockAlternatives} from "./alternatives";
import {quiet} from "./generate-blueprint-test-helpers";
import * as trial from "./trial";
import * as planning from "./plan/unclocked-run";

const signature = trial.clockVerificationSignature;
/** Windows by inserter, in one text whatever the order of the inserters */
const windowsKey = (windows: Record<string, { start: number; end: number }[]>) =>
    JSON.stringify(Object.entries(windows).sort(([a], [b]) => a.localeCompare(b)).map(([id, ranges]) => [id, ranges.map(range => [range.start, range.end])]));
afterEach(() => vi.restoreAllMocks());

// two whole generations of logistic science 240: 25 to 38 s on a desktop, 62 to 69 s on the GitHub runner, so not a unit test
describe("request-local duplicate verification", () => {
    it("assesses a matching primary only once and still supplies a valid run for dependency checks", async () => {
        const logistic = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240);
        const recovery = vi.spyOn(trial, "disturbanceTrialVerdictOf");
        const planned = vi.spyOn(planning, "clockOfPlan");
        const generated = generateClockAlternatives(logistic, {logger: quiet});
        const keys = recovery.mock.calls.map(([config, result]) => signature(config, result));
        expect(keys.length).toBeGreaterThan(1);
        // the clocks of the windows made by arithmetic, of the planning run's windows with the room for one hand they hold
        // already (laneHandRoomTicks gives each belt pickup of the sample the room, so its windows are tried with the room
        // inside them as well as added after them) and of the windows shaped against ghost wakeups are tried while the primary
        // windows are chosen (generate-clock.ts), before the alternative is assessed; the run memo serves the second ask, so
        // theirs are the keys asked twice
        const repeated = keys.filter((key, index) => keys.indexOf(key) !== index);
        // the windows of the clocks made with the room inside them (clockOfPlan, lane_hand_room "inside")
        const inside = new Set(planned.mock.calls.flatMap(([, room], index) => {
            if (room?.lane_hand_room !== "inside") return [];
            const made: planning.PlannedClock = planned.mock.results[index].value;
            return [windowsKey(Object.fromEntries(Array.from(made.windows, ([id, ranges]) =>
                [id, ranges.map(range => ({start: range.start_inclusive, end: range.end_inclusive}))])))];
        }));
        expect(inside.size).toBeGreaterThan(0);
        const chosen = recovery.mock.calls.filter(([, result]) => result.window_maker === "arithmetic"
            || inside.has(windowsKey(result.clock_windows)) || result.ghost_wakeup_windows !== undefined)
            .map(([config, result]) => signature(config, result));
        // Coordinated Sources keeps the recommended clock here, and judges it with the copies before it refuses: it asks for its
        // trials on one copy again, under the listing's key, and the run memo serves them
        const recommended = generated.alternatives[generated.selected_index].result;
        const kept = recovery.mock.calls.filter(([, result]) => windowsKey(result.clock_windows) === windowsKey(recommended.clock_windows))
            .map(([config, result]) => signature(config, result));
        expect(repeated).toHaveLength(4);
        expect([...chosen, ...kept]).toEqual(expect.arrayContaining(repeated));
        // Batched swings is selected on its fewer wake-ups although swings-1 recovers in 2 window cycles rather than 3 (swings-1
        // is unstable on the output belt the sample states, as it is in the game). Sharing the verification must preserve that choice.
        const other = generated.alternatives.find(clock => clock.maker === "swings-1")!;
        const selected = generated.alternatives[generated.selected_index];
        expect(other.verdict).toBe("unstable");
        expect(other.ranking.recovery_window_cycles).toBe(2);
        expect(selected.maker).toBe("planned-belt-slack");
        expect(selected.verdict).toBe("stable");
        expect(selected.ranking.recovery_window_cycles).toBe(3);
        expect(selected.ranking.wake_ups_per_minute).toBeLessThan(other.ranking.wake_ups_per_minute!);
        // A later request must make its own checks, rather than inherit a verdict from this generation.
        const first_count = recovery.mock.calls.length;
        generateClockAlternatives(logistic, {logger: quiet});
        expect(recovery.mock.calls.length).toBe(first_count * 2);
    });
});
