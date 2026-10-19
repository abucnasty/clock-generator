import fs from "fs";
import path from "path";
import zlib from "zlib";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {loadConfigFromFile} from "../../../src/config/loader";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {FactorioBlueprintFile} from "../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {GeneratedClock, recordInFactorio} from "../../../src/harness/factorio-harness";
import {outputPerPeriod, recipesMaking} from "../../../src/harness/recording-output";
import {GameFixturePaths} from "../helpers/fixture-paths";
import {BELT_SPEEDS, blueprintAtSpeed, configAtSpeed, FixtureBeltSpeed, speedCapture} from "../helpers/belt-speed-fixtures";
import {ordinaryAtSpeed} from "../mechanics/belt-pickup/ordinary-speed-fixtures";
import {makeInputBeltBackedUp} from "../mechanics/belt-pickup/belt-pickup-fixtures";
import {composeProbeSource} from "../helpers/probe-source";
import {assertPickupClockHardware} from "./pickup-clock-speed-hardware";

type Family = "electromagnetic" | "same-item";
interface ClockCase {family: Family; speed: FixtureBeltSpeed; backed: boolean; geometry: string; name: string}
interface Prepared {
    config: Config;
    clock: GeneratedClock;
    period: number;
    expected: number;
    generationSeconds: number;
    generationVerdict: string;
    selection?: {id: string; holds: boolean; rate: number; supply: "moving" | "backed_up" | null};
}
const generated = new Map<string, Prepared>();
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

export function pickupClockSpeedCases(family: Family): ClockCase[] {
    return BELT_SPEEDS.flatMap(speed => [false, true].flatMap(backed =>
        ["straight-belt", "underground-entrance", "underground-exit"].map(geometry => ({
            family, speed, backed, geometry, name: `${family}-${speed.name}-${geometry}-${backed ? "backed" : "moving"}`,
        }))));
}

function gearAtSpeed(text: string, speed: FixtureBeltSpeed, backed: boolean) {
    interface Entity {entity_number: number; name: string; type?: string; direction?: number; position: {x: number; y: number}}
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString()) as
        {blueprint: {entities: Entity[]}};
    const entities = decoded.blueprint.entities;
    if (backed) {
        const drains = entities.filter(entity => entity.name === "turbo-loader");
        expect(drains).toHaveLength(1);
        decoded.blueprint.entities = entities.filter(entity => !drains.includes(entity));
    }
    if (speed.name === "normal") {
        let nextId = Math.max(...entities.map(entity => entity.entity_number)) + 1;
        for (const entrance of [...decoded.blueprint.entities].filter(entity => entity.name === "turbo-underground-belt" && entity.type === "input")) {
            const exit = entities.filter(entity => entity.name === "turbo-underground-belt" && entity.type === "output"
                && entity.position.y === entrance.position.y && entity.position.x > entrance.position.x)
                .sort((a, b) => a.position.x - b.position.x)[0];
            if (!exit || exit.position.x - entrance.position.x <= 5) continue;
            if (entrance.position.x < 8.5) {
                const old = {...entrance, entity_number: nextId++, name: "turbo-transport-belt", position: {...entrance.position}};
                delete old.type;
                decoded.blueprint.entities.push(old);
                entrance.position.x++;
            } else {
                decoded.blueprint.entities.push({...exit, entity_number: nextId++, position: {x: entrance.position.x + 4, y: entrance.position.y}});
                decoded.blueprint.entities.push({...entrance, entity_number: nextId++, position: {x: entrance.position.x + 5, y: entrance.position.y}});
            }
        }
    }
    return blueprintAtSpeed(encodeBlueprintFile(decoded as unknown as FactorioBlueprintFile), speed);
}

export async function pickupClockConfig(variant: ClockCase): Promise<Config> {
    const config = await loadConfigFromFile(variant.family === "electromagnetic"
        ? path.join(GameFixturePaths.DIFFERENT_ITEMS, "config.json")
        : variant.geometry === "straight-belt" ? GameFixturePaths.SAME_ITEM_STRAIGHT_CONFIG : GameFixturePaths.SAME_ITEM_CONFIG);
    configAtSpeed(config, variant.speed);
    config.overrides = {...config.overrides, backed_up_belts: variant.backed};
    if (variant.family === "electromagnetic") config.target_output.items_per_second = 30 * variant.speed.units / 4;
    for (const inserter of config.inserters) if (inserter.source.type === "belt") {
        inserter.source.pickup_length = variant.geometry === "straight-belt" ? 1 : 0.5;
        inserter.source.pickup_layout = variant.geometry === "straight-belt" ? "side-straight" : variant.geometry === "underground-entrance" ? "side-entrance" : "side-exit";
    }
    return config;
}

async function prepare(variant: ClockCase): Promise<Prepared> {
    const key = `${variant.family}-${variant.speed.name}-${variant.backed}-${variant.geometry}`;
    const cached = generated.get(key);
    if (cached) return cached;
    const config = await pickupClockConfig(variant);
    const started = performance.now();
    const alternatives = generateClockAlternatives(config, {logger: quiet});
    const selected = alternatives.alternatives[alternatives.selected_index];
    // A generation-only preflight checks the target. Native captures also retain below-target candidates:
    // their output is evidence of a shortfall, rather than a reason to skip the game measurement entirely.
    if (process.env.BELT_CLOCK_GENERATION_ONLY === "1" && process.env.BELT_CLOCK_CALIBRATE !== "1") {
        expect(selected.assessment.items_per_second).toBe(config.target_output.items_per_second);
    }
    const exported = selected.result.subtick ?? selected.result;
    const period = selected.result.subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
    const prepared = {config, period, expected: config.target_output.items_per_second * period / 60,
        clock: {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule},
        generationSeconds: (performance.now() - started) / 1000, generationVerdict: selected.verdict,
        selection: {id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second,
            supply: selected.belt?.kind ?? null}};
    generated.set(key, prepared);
    return prepared;
}

/** One run provides >=60 undisturbed periods before any intervention, plus all three recovery checks. */
export async function capturePickupClockSpeed(variant: ClockCase) {
    const capture = speedCapture(variant.name);
    try {
        const replayDirectory = process.env.BELT_CLOCK_REPLAY_DIR ? path.resolve(process.env.BELT_CLOCK_REPLAY_DIR, variant.name) : undefined;
        const generationRoot = process.env.BELT_CLOCK_GENERATION_DIR;
        const generationPath = generationRoot ? path.resolve(generationRoot, `${variant.name}.json`) : undefined;
        const retainedClock = replayDirectory ? path.join(replayDirectory, "generated-clock.json") : generationPath;
        const prepared: Prepared = retainedClock && fs.existsSync(retainedClock)
            ? JSON.parse(fs.readFileSync(retainedClock, "utf8")) : await prepare(variant);
        if (generationPath && !fs.existsSync(generationPath)) {
            fs.mkdirSync(path.dirname(generationPath), {recursive: true});
            fs.writeFileSync(generationPath, JSON.stringify(prepared) + "\n");
        }
        fs.writeFileSync(path.join(capture.directory, "generated-clock.json"), JSON.stringify(prepared) + "\n");
        if (prepared.selection) fs.writeFileSync(path.join(capture.directory, "generation-selection.json"), JSON.stringify(prepared.selection) + "\n");
        if (process.env.BELT_CLOCK_GENERATION_ONLY === "1") return;
        const {config, clock, period, expected} = prepared;
        const fixture = variant.family === "electromagnetic" ? GameFixturePaths.DIFFERENT_ITEMS : GameFixturePaths.SAME_ITEM;
        let blueprint = fs.readFileSync(path.join(fixture, `${variant.geometry}-scaffold.txt`), "utf8");
        if (variant.family === "electromagnetic") {
            if (variant.backed) blueprint = makeInputBeltBackedUp(blueprint);
            blueprint = ordinaryAtSpeed(blueprint, variant.speed, false);
        } else blueprint = gearAtSpeed(blueprint, variant.speed, variant.backed);
        fs.writeFileSync(path.join(capture.directory, "scaffold.txt"), blueprint.trim() + "\n");
        const settle = 142 * period;
        const recording = replayDirectory ? JSON.parse(fs.readFileSync(path.join(replayDirectory, "recording.json"), "utf8"))
            : (await recordInFactorio({factorio: process.env.FACTORIO_PATH!, save: process.env.FACTORIO_HARNESS_SAVE!, config, clock, blueprint,
                out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                ticks: 2 * period, warmup_ticks: 3600, settle_ticks: settle, seed: [], unclocked: false,
                lua: composeProbeSource(path.join(__dirname, "pickup-clock-speed-probe.lua"), {
                    period, settle: 10 * period, lastPeriod: 146, family: variant.family, speed: variant.speed.units / 32,
                    reach: variant.geometry === "straight-belt" ? 1 : 0.5,
                }), game_speed: 1000, watch: false, timeout_seconds: 900, log() {},
            })).recording;
        assertPickupClockHardware(recording, config, blueprint);
        const source = recording.inserters.find((inserter: {source: {type: string}; sink: {type: string}}) => inserter.source.type === "belt" && inserter.sink.type === "machine")!;
        expect(source.source.pickup_length).toBe(variant.geometry === "straight-belt" ? 1 : 0.5);
        const report = JSON.parse(fs.readFileSync(path.join(replayDirectory ?? capture.directory, "game/script-output/clock-speed.json"), "utf8"));
        expect(report.initial).toMatchObject({speed: variant.speed.units / 32, reach: variant.geometry === "straight-belt" ? 1 : 0.5});
        const detailed = outputPerPeriod(recording, recipesMaking(config, config.target_output.recipe));
        expect(detailed).toHaveLength(2);
        const periods = report.periods as {start: number; end: number; items: number}[];
        expect(periods.length).toBeGreaterThanOrEqual(130);
        expect(periods.every(value => value.end - value.start === period)).toBe(true);
        for (const observed of detailed) {
            const aggregate = periods.find(value => value.start === recording.start_game_tick + observed.start
                && value.end === recording.start_game_tick + observed.end);
            expect(aggregate, "compact count overlaps both detailed recorder periods").toBeDefined();
            expect(aggregate!.items).toBe(observed.items);
        }
        const start = report.starts;
        const baseline = periods.filter(value => value.end <= start + 64 * period);
        expect(baseline.length).toBeGreaterThanOrEqual(60);
        const recovery = [[66, 68, 84], [84, 88, 104], [104, 106, 132]].map(([cut, release, next]) => {
            const during = periods.filter(value => value.start >= start + cut * period
                && value.end <= start + (release + 2) * period);
            const after = periods.filter(value => value.start >= start + (release + (variant.backed ? 10 : 6)) * period
                && value.end <= start + next * period);
            expect(during.length).toBeGreaterThan(0);
            expect(during.some(value => value.items < Math.min(...baseline.map(value => value.items))),
                `disturbance at period ${cut} reduced output below the baseline`).toBe(true);
            expect(after.length).toBeGreaterThan(1);
            return {cut, during: during.map(value => value.items), recovered: after.map(value => value.items)};
        });
        const summary = {generationVerdict: prepared.generationVerdict, target: config.target_output.items_per_second, period, expected,
            baseline: baseline.map(value => value.items), recovery};
        fs.writeFileSync(path.join(capture.directory, "summary.json"), JSON.stringify(summary) + "\n");
        if (process.env.BELT_CLOCK_CALIBRATE !== "1") {
            const expectations = process.env.BELT_CLOCK_EXPECTATIONS
                ? path.resolve(process.env.BELT_CLOCK_EXPECTATIONS)
                : path.join(__dirname, "pickup-clock-parity-controls.json");
            const expectedSummaries = JSON.parse(fs.readFileSync(expectations, "utf8"));
            expect(summary).toEqual(expectedSummaries[variant.name]);
        }
    } finally {capture.cleanup();}
}
