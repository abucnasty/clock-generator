import fs from "fs";
import path from "path";
import zlib from "zlib";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {loadConfigFromFile} from "../../../src/config/loader";
import {FactorioBlueprintFile} from "../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {GameFixturePaths} from "../helpers/fixture-paths";
import {BELT_SPEEDS, blueprintAtSpeed, configAtSpeed, FixtureBeltSpeed} from "../helpers/belt-speed-fixtures";
import {ordinaryAtSpeed} from "../mechanics/belt-pickup/ordinary-speed-fixtures";
import {makeInputBeltBackedUp} from "../mechanics/belt-pickup/belt-pickup-fixtures";
import {capturePickupClockScenario} from "./pickup-clock-capture";

type Family = "electromagnetic" | "same-item";
interface ClockCase {family: Family; speed: FixtureBeltSpeed; backed: boolean; geometry: string; name: string}

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

export function pickupClockScaffold(variant: ClockCase): string {
    const fixture = variant.family === "electromagnetic" ? GameFixturePaths.DIFFERENT_ITEMS : GameFixturePaths.SAME_ITEM;
    let blueprint = fs.readFileSync(path.join(fixture, `${variant.geometry}-scaffold.txt`), "utf8");
    if (variant.family === "electromagnetic") {
        if (variant.backed) blueprint = makeInputBeltBackedUp(blueprint);
        return ordinaryAtSpeed(blueprint, variant.speed, false);
    }
    return gearAtSpeed(blueprint, variant.speed, variant.backed);
}

/** Ordinary side-pickup fixtures use the same capture procedure as other belt layouts. */
export function capturePickupClockSpeed(variant: ClockCase) {
    return capturePickupClockScenario({
        name: variant.name, speed: variant.speed, backed: variant.backed,
        config: () => pickupClockConfig(variant), scaffold: () => pickupClockScaffold(variant),
        probe: {family: variant.family}, controls: path.join(__dirname, "pickup-clock-m1-controls.json"),
    });
}
