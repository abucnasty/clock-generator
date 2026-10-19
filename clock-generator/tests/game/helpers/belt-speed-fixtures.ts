import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { Config } from "../../../src/config";
import { FactorioBlueprintFile } from "../../../src/blueprints/blueprint";
import { encodeBlueprintFile } from "../../../src/blueprints/serde";

export const BELT_SPEEDS = [
    {name: "turbo", prefix: "turbo-", units: 4},
    {name: "express", prefix: "express-", units: 3},
    {name: "fast", prefix: "fast-", units: 2},
    {name: "normal", prefix: "", units: 1},
] as const;
export type FixtureBeltSpeed = typeof BELT_SPEEDS[number];

/** Change transport prototypes only, retaining all positions, controls, filters and connections. */
export function blueprintAtSpeed(text: string, speed: FixtureBeltSpeed): string {
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString()) as FactorioBlueprintFile;
    if (!decoded.blueprint?.entities) throw new Error("Expected scaffold entities");
    let changed = 0;
    for (const entity of decoded.blueprint.entities) {
        const match = /^(?:turbo-|express-|fast-)?(transport-belt|underground-belt|loader|splitter)$/.exec(entity.name);
        if (!match) continue;
        entity.name = `${speed.prefix}${match[1]}` as typeof entity.name;
        changed++;
    }
    if (!changed) throw new Error("Scaffold has no transport entities");
    return encodeBlueprintFile(decoded);
}

export function configAtSpeed(config: Config, speed: FixtureBeltSpeed): void {
    for (const belt of config.belts) belt.type = `${speed.prefix}transport-belt`;
}

/** Retain complete evidence when requested, including failed assertions; never overwrite another run. */
export function speedCapture(name: string) {
    const root = process.env.BELT_SPEED_CAPTURE_DIR;
    const directory = root ? path.resolve(root, name) : fs.mkdtempSync(path.join(os.tmpdir(), "belt-speed-"));
    if (root && fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error("Use a fresh BELT_SPEED_CAPTURE_DIR");
    fs.mkdirSync(directory, {recursive: true});
    return {directory, cleanup: () => {if (!root) fs.rmSync(directory, {recursive: true, force: true});}};
}
