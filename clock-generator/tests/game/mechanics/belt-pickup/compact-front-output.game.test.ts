import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {BELT_SPEEDS, configAtSpeed, speedCapture} from "../../helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {compactFrontEntranceAtSpeed} from "./front-speed-fixtures";

interface Sample {
    tick: number; products: number; held: number; held_item?: string;
    drop_lanes: {stacks: {item: string; count: number}[] | Record<string, never>}[];
    downstream_lanes: {stacks: {item: string; count: number}[] | Record<string, never>}[];
}
test("compact normal entrance naturally crafts and transfers circuits onto its connected output", async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const fixture = GameFixturePaths.FRONT_UNDERGROUND_ENTRANCE;
    const speed = BELT_SPEEDS.find(speed => speed.name === "normal")!;
    const capture = speedCapture("compact-normal-output");
    try {
        const config = await loadConfigFromFile(path.join(fixture, "config.json"));
        configAtSpeed(config, speed);
        config.target_output.recipe = "electronic-circuit";
        config.machines[0] = {...config.machines[0], recipe: "electronic-circuit", productivity: 0, crafting_speed: 1.25};
        config.belts.find(belt => belt.id === 1)!.lanes[0].ingredient = "electronic-circuit";
        for (const lane of config.belts.find(belt => belt.id === 2)!.lanes)
            lane.ingredient = lane.ingredient === "accumulator" ? "iron-plate" : "copper-cable";
        const blueprint = compactFrontEntranceAtSpeed(
            fs.readFileSync(path.join(fixture, "compact-normal-scaffold.txt"), "utf8"), speed);
        fs.writeFileSync(path.join(capture.directory, "scaffold.txt"), blueprint);
        await recordInFactorio({factorio: factorio!, save: save!, config, blueprint,
            lua: composeProbeSource(path.join(fixture, "output-probe.lua"), {speed: speed.units / 32}),
            out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
            ticks: 640, warmup_ticks: 0, staged_start: {build_order: "ascending", saturation_ticks: 600},
            settle_ticks: 0, seed: [], unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 180, log() {}});
        const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/compact-output.json"), "utf8")) as {
            machine: string; recipe: string; speed: number; samples: Sample[];
        };
        expect(report).toMatchObject({machine: "assembling-machine-3", recipe: "electronic-circuit", speed: 1 / 32});
        expect(report.samples).toHaveLength(600);
        expect(report.samples.at(-1)!.products).toBeGreaterThan(0);
        const carrying = report.samples.filter(sample => sample.held > 0);
        expect(carrying.length).toBeGreaterThan(0);
        expect(carrying.every(sample => sample.held_item === "electronic-circuit")).toBe(true);
        const deposited = report.samples.filter(sample => [...sample.drop_lanes, ...sample.downstream_lanes]
            .some(lane => Object.values(lane.stacks).some(stack => stack.item === "electronic-circuit")));
        expect(deposited.length).toBeGreaterThan(0);
        expect(report.samples.some(sample => sample.downstream_lanes.some(lane =>
            Object.values(lane.stacks).some(stack => stack.item === "electronic-circuit")))).toBe(true);
    } finally {capture.cleanup();}
}, 240_000);
