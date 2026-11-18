import {expect, test} from "vitest";
import {disturbanceTrialOf, clockFromWindows, generateClockAlternatives} from "./generate-blueprint";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {timeStudyWindowsClock} from "./candidates/time-study-windows";
import {verificationPlanningConfigOf} from "./round-robin-polling-primitive-policy";
import {fractionalSwingsOf} from "./plan/unclocked-run";
import {clockInsights} from "./insights";

// the grenade build (GRENADE_240_FILLS_BELT_EXACTLY) with a change: the build as it is, its clock pinned beside the in-game recording of it, and the
// checks of its result are a job of the record (tests/game/builds/job-checks/samples.ts); here the copies a tile closer, and the hand-made clock
// judged by the simulator
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

test("grenade: copies a tile closer put hands on each other, and the insight says so", async () => {
    const config = await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
    const closer = {...config, setpoint: {...config.setpoint, copy_offset: {x: 11, y: 0}}};
    const made = generateClockAlternatives(closer, {logger: quiet});
    const selected = made.alternatives[made.selected_index];
    const insight = selected.insights.find(it => it.id === "drop-spacing")!;
    expect(insight.title).toBe("Drops onto the grenade belt land on each other");
    expect(insight.explanation).toContain("With the inserters (1 and 2) that drop grenade as they stand (3 tiles apart), the copies fit 12, 16, 18, 20, 22 or 24 tiles apart; "
        + "13, 15, 17, 19, 23 or 25 apart only with a copy's inserters 7 tiles apart; 14 or 21 apart never. The same holds at any of these spacings plus 14.");
});

test("grenade: the hand-made clock, as windows, holds in the simulator and goes back to its rate by itself after every supply stop and output blockage", async () => {
    const config = await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
    const range = (start: number, end: number) => [{start, end}];
    // counted 0 to 111; a window decider reads the counter, so its first value is the window's first tick
    const windows = {
        "inserter:1": range(0, 0), "inserter:2": range(0, 0), "inserter:7": range(56, 56), "inserter:8": range(56, 56),
        "inserter:3": range(2, 43), "inserter:4": range(2, 43), "inserter:5": range(58, 99), "inserter:6": range(58, 99),
        "drill:1": range(5, 7), "drill:2": range(5, 7), "drill:3": range(61, 63), "drill:4": range(61, 63),
    };
    const forced = {...config, overrides: {...config.overrides, terminal_swing_count: 1}};
    const made = clockFromWindows(forced, windows, 112, quiet);
    expect(made.stability_check.as_built?.holds).toBe(true);
    expect(made.stability_check.as_built?.actual_output_items).toBe(64);
    expect(disturbanceTrialOf(forced, windows, 112, 64, quiet).survives).toBe(true);
});

// a user's build: the grenade build with one copy, three assemblers (the fourth, its inserters and its drill taken out) at crafting speed
// 79.358762, and a setpoint of 28.98 a second; its Time-Study Windows clock runs a window cycle of 16000/161 ticks on a subtick clock
async function threeAssemblerGrenade() {
    const config = await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
    return {
        ...config,
        setpoint: {recipe: config.setpoint.recipe, items_per_second: 28.98, copies: 1},
        machines: config.machines.filter(it => it.id !== 5).map(it => it.recipe === "grenade" ? {...it, crafting_speed: 79.358762} : it),
        inserters: config.inserters.filter(it => it.id !== 5 && it.id !== 8),
        drills: {...config.drills!, configs: config.drills!.configs.filter(it => it.id !== 4)},
        // from the cold start: from the backpressure start the casting foundry starts full and the build stops 200 ticks after the cut
        overrides: {...config.overrides, derive_clock_windows: false, judged_start: "cold" as const},
    };
}

test("grenade at 28.98/s: a clock of a fractional window cycle goes back to its rate after its grenade is not taken away, and the loss ends soon after the build stops", async () => {
    const config = await threeAssemblerGrenade();
    const made = timeStudyWindowsClock(config, {logger: quiet}, "always");
    const window_cycle_ticks = made.simulation_duration.ticks;
    expect(window_cycle_ticks).toBeCloseTo(16000 / 161, 9);
    expect(made.stability_check.holds).toBe(true);
    // the spare time is told per window cycle of 99.379 ticks, not of the 16000 ticks the subtick clock repeats in, and the build is
    // given the 3 bins of 161 window cycles its trials count
    const spare = clockInsights(made, true, config.machines).find(it => it.id === "spare-time")!;
    expect(spare.what).toContain("of the 99.379 ticks in a window cycle");
    expect(spare.spare_time!.working_ticks + spare.spare_time!.spare_ticks).toBeCloseTo(16000 / 161, 9);
    expect(spare.spare_time!.recovery_window_cycles).toBe(483);
    const report = disturbanceTrialOf(verificationPlanningConfigOf(config, made), made.clock_windows, window_cycle_ticks,
        made.stability_check.expected_output_items, quiet, {places: [0], shares: [1]}, undefined, undefined, [], fractionalSwingsOf(made.output_cycle_plan));
    const [blocked] = report.losses;
    expect(blocked.loss).toEqual({kind: "output", item: "grenade"});
    const [trial] = blocked.trials;
    // the build stops 202 ticks after the cut; the grenade comes back a whole number of window cycles after the cut, within a tick,
    // once a window cycle has gone by with nothing done: 4 window cycles (397.5 ticks) after the cut, not 32000 ticks
    expect(trial.stopped_after_ticks).toBe(202);
    expect(trial.loss_ticks).toBe(398);
    // the first bin holds the grenades held back by the loss, one hand over; the bins after it are back at the rate
    expect(trial.output_per_bin[0]).toBe(7776);
    expect(trial.recovers).toBe(true);
    expect(report.survives).toBe(true);
});
