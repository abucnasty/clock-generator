import {expect, test} from "vitest";
import {disturbanceTrialOf, clockFromWindows, generateClockAlternatives} from "./generate-blueprint";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";

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
    expect(insight.title).toBe("Drops onto belt 1 land on each other");
    expect(insight.explanation).toContain("With inserters 1 and 2 as they stand (3 tiles apart), the copies fit 12, 16, 18, 20, 22 or 24 tiles apart; "
        + "13, 15, 17, 19, 23 or 25 apart only with a copy's inserters 7 tiles apart; 14 or 21 apart never. The same holds at any of these spacings plus 14.");
});

test("grenade: the hand-made clock, as windows, holds in the simulator and gets back after every loss", async () => {
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
