import fs from "fs";
import path from "path";
import zlib from "zlib";
import {expect} from "vitest";
import {Config, ConfigSchema} from "../../../src/config";
import {FactorioBlueprintFile} from "../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {GameFixturePaths} from "../helpers/fixture-paths";
import {BELT_SPEEDS, blueprintAtSpeed, FixtureBeltSpeed} from "../helpers/belt-speed-fixtures";
import {PickupClockScenario} from "./pickup-clock-capture";

type Family = "different-items" | "same-item";
export interface OverHoodClockCase {name: string; family: Family; speed: FixtureBeltSpeed; mirrored: boolean; backed: boolean}

export function overHoodClockCases(family: Family): OverHoodClockCase[] {
    return BELT_SPEEDS.flatMap(speed => [false, true].flatMap(mirrored => [false, true].map(backed => ({
        name: `over-hood-${speed.name}-${mirrored ? "mirrored" : "unmirrored"}-${backed ? "backed" : "moving"}-${family}`,
        family, speed, mirrored, backed,
    }))));
}

export function overHoodClockConfig(variant: OverHoodClockCase): Config {
    const product = variant.family === "different-items" ? "electronic-circuit" : "iron-gear-wheel";
    const type = `${variant.speed.prefix}transport-belt`;
    return ConfigSchema.parse({
        target_output: {recipe: product, items_per_second: 6, copies: 1},
        machines: [{id: 1, type: "machine", recipe: product, crafting_speed: 70.765625, productivity: 0}],
        inserters: [
            {id: 1, source: {type: "machine", id: 1}, sink: {type: "belt", id: 1}, stack_size: 16},
            {id: 2, source: {type: "belt", id: 2, near_lane: variant.mirrored ? 2 : 1,
                pickup_layout: "over-hood-exit", pickup_length: 0.5}, sink: {type: "machine", id: 1}, stack_size: 16},
        ],
        belts: [
            {id: 1, type, lanes: [{ingredient: product, stack_size: 4}, {ingredient: "", stack_size: 4}]},
            {id: 2, type, lanes: [{ingredient: "iron-plate", stack_size: 4},
                {ingredient: variant.family === "different-items" ? "copper-cable" : "iron-plate", stack_size: 4}]},
        ],
        chests: [], overrides: {backed_up_belts: variant.backed},
    });
}

export function overHoodClockScaffold(variant: OverHoodClockCase): string {
    interface Entity {entity_number: number; name: string; recipe?: string; mirror?: boolean;
        infinity_settings?: {filters?: {name: string}[]}}
    const text = fs.readFileSync(path.join(GameFixturePaths.OVER_THE_HOOD_UNDERGROUND_EXIT, "compact-normal-scaffold.txt"), "utf8");
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString()) as {blueprint: {entities: Entity[]}};
    const entities = decoded.blueprint.entities;
    const input = entities.find(entity => entity.entity_number === 36)!;
    const machine = entities.find(entity => entity.entity_number === 27)!;
    expect(input.name).toBe("stack-inserter");
    expect(machine.name).toBe("assembling-machine-3");
    input.mirror = variant.mirrored;
    if (variant.family === "same-item") {
        machine.recipe = "iron-gear-wheel";
        for (const entity of entities) for (const filter of entity.infinity_settings?.filters ?? []) {
            if (filter.name === "copper-cable") filter.name = "iron-plate";
        }
    }
    if (variant.backed) {
        const drain = entities.find(entity => entity.entity_number === 56)!;
        expect(drain.name).toBe("loader");
        decoded.blueprint.entities = entities.filter(entity => entity !== drain);
    }
    return blueprintAtSpeed(encodeBlueprintFile(decoded as unknown as FactorioBlueprintFile), variant.speed);
}

export function overHoodClockScenario(variant: OverHoodClockCase): PickupClockScenario {
    return {
        name: variant.name, speed: variant.speed, backed: variant.backed, outagePeriods: 24,
        config: () => overHoodClockConfig(variant), scaffold: () => overHoodClockScaffold(variant),
        probe: {family: "compact", machine_name: "assembling-machine-3", output_to_belt: true,
            ingredients: ["iron-plate", variant.family === "different-items" ? "copper-cable" : "iron-plate"]},
        controls: path.join(__dirname, "over-hood-clock-controls.json"),
        validateRecording(recording) {
            const input = recording.inserters.find(inserter => inserter.source.type === "belt" && inserter.sink.type === "machine")!;
            expect(input.source).toMatchObject({near_lane: variant.mirrored ? 2 : 1, pickup_layout: "over-hood-exit",
                pickup_length: 0.5, pickup_capture: {status: "supported", model: "belt", model_version: 2}});
        },
    };
}
