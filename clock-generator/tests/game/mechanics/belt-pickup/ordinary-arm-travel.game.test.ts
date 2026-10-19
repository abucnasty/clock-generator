import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {BELT_SPEEDS, configAtSpeed, speedCapture} from "../../helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {useAccumulatorsOnBothLanes} from "./belt-pickup-fixtures";
import {ordinaryAtSpeed} from "./ordinary-speed-fixtures";
import {reflectOrdinaryPickup} from "./ordinary-reflection-fixtures";
import {compareContinuousSimulator} from "./ordinary-pickup-comparison";
import {SameItemPickupProbe} from "./same-item-pickup-probe";

for (const reflected of [false, true]) for (let delay = 0; delay < 8; delay++) {
    test(`normal side entrance arm reach: near lane ${reflected ? 2 : 1}, phase delay ${delay}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const capture = speedCapture(`normal-entrance-arm-${reflected ? "reflected" : "original"}-${delay}`);
        try {
            const fixture = GameFixturePaths.DIFFERENT_ITEMS;
            const config = await loadConfigFromFile(path.join(fixture, "config.json"));
            const speed = BELT_SPEEDS.find(speed => speed.name === "normal")!;
            configAtSpeed(config, speed);
            const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
            if (input.source.type !== "belt") throw Error("Expected belt");
            input.source.pickup_layout = "side-entrance";
            input.source.near_lane = reflected ? 2 : 1;
            input.filters = ["accumulator"];
            config.belts.find(belt => belt.id === input.source.id)!.lanes.forEach(lane => {lane.ingredient = "accumulator";});
            let blueprint = ordinaryAtSpeed(useAccumulatorsOnBothLanes(fs.readFileSync(path.join(fixture,
                "underground-entrance-scaffold.txt"), "utf8")), speed);
            if (reflected) blueprint = reflectOrdinaryPickup(blueprint);
            fs.writeFileSync(path.join(capture.directory, "blueprint.txt"), blueprint + "\n");
            fs.writeFileSync(path.join(capture.directory, "config.json"), JSON.stringify(config, null, 2) + "\n");
            const result = await recordInFactorio({factorio: factorio!, save: save!, config, blueprint,
                out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                ticks: 116, warmup_ticks: 0, staged_start: {build_order: "ascending", saturation_ticks: 600},
                settle_ticks: 0, seed: [], unclocked: true, lua: composeProbeSource(path.join(fixture, "phase-probe.lua"),
                    {item: "accumulator", gateTick: 64 + delay, lastTick: 112, speed: 1 / 32, beltPrefix: "", reflected}),
                game_speed: 1000, watch: false, timeout_seconds: 180, log() {}});
            const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/ordinary-phase.json"), "utf8")) as
                SameItemPickupProbe & {quality: string; extension_speed: number; rotation_speed: number};
            expect(report).toMatchObject({quality: "legendary", extension_speed: 0.25, rotation_speed: 0.1});
            const first = report.samples.find(sample => sample.held > 0)!;
            const full = report.samples.find(sample => sample.held === 16)!;
            expect(first.tick).toBe(66 + delay);
            const phase = Math.round(Object.values(first.lanes[0].stacks)[0].at * 256) % 64;
            expect(phase).toBe((56 - delay * 8 + 64) % 64);
            const hand = report.samples.filter(sample => sample.tick <= full.tick);
            const grabs = hand.filter((sample, index) => sample.held > (hand[index - 1]?.held ?? 0));
            expect(grabs.map(sample => sample.tick - first.tick)).toEqual(phase >= 32 ? [0, 1, 3, 4] : [0, 1, 2, 3]);
            expect(compareContinuousSimulator(config, {...report, samples: hand}, speed)).toEqual([]);
            const exported = result.recording.config.inserters.find(inserter => inserter.source.type === "belt")!;
            expect(exported.source).toMatchObject({near_lane: reflected ? 2 : 1, pickup_layout: "side-entrance",
                pickup_capture: {status: "supported", model_version: 2}});
        } finally {capture.cleanup();}
    }, 240_000);
}
