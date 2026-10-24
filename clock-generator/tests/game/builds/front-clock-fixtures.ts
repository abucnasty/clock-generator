import fs from "fs";
import path from "path";
import zlib from "zlib";
import {expect} from "vitest";
import {Config, ConfigSchema} from "../../../src/config";
import {loadConfigFromFile} from "../../../src/config/loader";
import {FactorioBlueprintFile} from "../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {GameFixturePaths} from "../helpers/fixture-paths";
import {BELT_SPEEDS, blueprintAtSpeed, configAtSpeed, FixtureBeltSpeed} from "../helpers/belt-speed-fixtures";
import {flipFrontUndergroundInput} from "../mechanics/belt-pickup/belt-pickup-fixtures";
import {compactFrontEntranceAtSpeed, compactFrontUndergroundRouting} from "../mechanics/belt-pickup/front-speed-fixtures";
import {PickupClockScenario} from "./pickup-clock-capture";

type Family = "different-items" | "same-item";
/**
 * `backed` is the config's supply. The front exit's inserter stands on the exit's output tile, so its belt is backed up
 * in the game whatever the config says; its moving-config cases run that physically backed build on a moving config.
 */
export interface FrontClockCase {name: string; endpoint: "entrance" | "exit"; family: Family; speed: FixtureBeltSpeed;
    mirrored: boolean; backed: boolean}

/** The front entrance on the compact assembler scaffold, at every tier, mirroring state, supply and family. */
export function frontEntranceClockCases(family: Family): FrontClockCase[] {
    return BELT_SPEEDS.flatMap(speed => [false, true].flatMap(mirrored => [false, true].map(backed => ({
        name: `front-entrance-${speed.name}-${mirrored ? "mirrored" : "unmirrored"}-${backed ? "backed" : "moving"}-${family}`,
        endpoint: "entrance" as const, family, speed, mirrored, backed,
    }))));
}

/** The front exit on the electromagnetic plant: backed up, and the same build on a moving config. */
export function frontExitClockCases(backed: boolean): FrontClockCase[] {
    return BELT_SPEEDS.flatMap(speed => [false, true].map(mirrored => ({
        name: `front-exit-${speed.name}-${mirrored ? "mirrored" : "unmirrored"}-${backed ? "backed" : "moving-config"}-different-items`,
        endpoint: "exit" as const, family: "different-items" as const, speed, mirrored, backed,
    })));
}

/** The compact scaffold's assembler 3 with two speed modules and four beacons of two, all legendary, as the game reports it. */
const COMPACT_CRAFTING_SPEED = 50;

function frontEntranceClockConfig(variant: FrontClockCase): Config {
    const product = variant.family === "different-items" ? "electronic-circuit" : "iron-gear-wheel";
    const type = `${variant.speed.prefix}transport-belt`;
    return ConfigSchema.parse({
        target_output: {recipe: product, items_per_second: 6, copies: 1},
        machines: [{id: 1, type: "machine", recipe: product, crafting_speed: COMPACT_CRAFTING_SPEED, productivity: 0}],
        inserters: [
            {id: 1, source: {type: "machine", id: 1}, sink: {type: "belt", id: 1}, stack_size: 16},
            {id: 2, source: {type: "belt", id: 2, near_lane: variant.mirrored ? 2 : 1,
                pickup_layout: "front-entrance", pickup_length: 0.5}, sink: {type: "machine", id: 1}, stack_size: 16},
        ],
        belts: [
            {id: 1, type, lanes: [{ingredient: product, stack_size: 4}, {ingredient: "", stack_size: 4}]},
            {id: 2, type, lanes: [{ingredient: "iron-plate", stack_size: 4},
                {ingredient: variant.family === "different-items" ? "copper-cable" : "iron-plate", stack_size: 4}]},
        ],
        chests: [], overrides: {backed_up_belts: variant.backed},
    });
}

async function frontExitClockConfig(variant: FrontClockCase): Promise<Config> {
    const config = await loadConfigFromFile(path.join(GameFixturePaths.FRONT_UNDERGROUND_EXIT, "config.json"));
    configAtSpeed(config, variant.speed);
    config.target_output.items_per_second = 30 * variant.speed.units / 4;
    config.overrides = {...config.overrides, backed_up_belts: variant.backed};
    const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
    if (input.source.type !== "belt") throw new Error("Expected the front exit's belt input");
    input.source.near_lane = variant.mirrored ? 2 : 1;
    return config;
}

export function frontClockConfig(variant: FrontClockCase): Config | Promise<Config> {
    return variant.endpoint === "entrance" ? frontEntranceClockConfig(variant) : frontExitClockConfig(variant);
}

function frontEntranceClockScaffold(variant: FrontClockCase): string {
    interface Entity {entity_number: number; name: string; recipe?: string}
    const text = fs.readFileSync(path.join(GameFixturePaths.FRONT_UNDERGROUND_ENTRANCE, "compact-normal-scaffold.txt"), "utf8");
    const routed = compactFrontEntranceAtSpeed(text, variant.speed,
        {mirrored: variant.mirrored, backedUp: variant.backed, sameItem: variant.family === "same-item"});
    if (variant.family === "different-items") return routed;
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(routed.trim().slice(1), "base64")).toString()) as {blueprint: {entities: Entity[]}};
    const machine = decoded.blueprint.entities.find(entity => entity.entity_number === 17)!;
    expect(machine.name).toBe("assembling-machine-3");
    machine.recipe = "iron-gear-wheel";
    return encodeBlueprintFile(decoded as unknown as FactorioBlueprintFile);
}

function frontExitClockScaffold(variant: FrontClockCase): string {
    let blueprint = fs.readFileSync(path.join(GameFixturePaths.FRONT_UNDERGROUND_EXIT, "scaffold.txt"), "utf8");
    if (!variant.mirrored) blueprint = flipFrontUndergroundInput(blueprint);
    return blueprintAtSpeed(compactFrontUndergroundRouting(blueprint, "exit", variant.speed), variant.speed);
}

export function frontClockScaffold(variant: FrontClockCase): string {
    return variant.endpoint === "entrance" ? frontEntranceClockScaffold(variant) : frontExitClockScaffold(variant);
}

export function frontClockScenario(variant: FrontClockCase): PickupClockScenario {
    const ingredients = variant.endpoint === "exit" ? undefined
        : ["iron-plate", variant.family === "different-items" ? "copper-cable" : "iron-plate"] as const;
    return {
        // the front exit is backed up in the game whatever its config says
        name: variant.name, speed: variant.speed, backed: variant.endpoint === "exit" || variant.backed,
        // the compact assembler keeps producing through the ordinary two- and four-period outages on its stock
        ...(variant.endpoint === "entrance" && {outagePeriods: 24}),
        config: () => frontClockConfig(variant), scaffold: () => frontClockScaffold(variant),
        probe: variant.endpoint === "entrance"
            ? {family: "compact", machine_name: "assembling-machine-3", output_to_belt: true, ingredients}
            : {family: "electromagnetic"},
        controls: path.join(__dirname, "front-clock-controls.json"),
        validateRecording(recording) {
            const input = recording.inserters.find(inserter => inserter.source.type === "belt" && inserter.sink.type === "machine")!;
            expect(input.source).toMatchObject({near_lane: variant.mirrored ? 2 : 1, pickup_layout: `front-${variant.endpoint}`,
                pickup_length: 0.5, pickup_capture: {status: "supported", model: "belt", model_version: 2}});
        },
    };
}
