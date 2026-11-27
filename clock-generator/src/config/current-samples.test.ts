import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ConfigPaths } from "./config-paths";
import { readRecipeSetpointAsItem } from "./setpoint-item";
import { normalizePickupCaptureConfig } from "./pickup-capture";

type Raw = Record<string, unknown>;

const ENGINE = path.resolve(__dirname, "../..");
const object = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The readers the schema runs before its checks, without the checks or defaults: each reads a current key (a recipe's
 * name in `setpoint.item`; a pickup's `pickup_layout` without its `pickup_length`). A config in the current shape that
 * states each value as the engine reads it is left as it is.
 */
const READERS: Record<string, (config: Raw) => Raw> = {
    "pickup-length": config => normalizePickupCaptureConfig(config) as Raw,
    "setpoint-item": config => readRecipeSetpointAsItem(config) as Raw,
};

/** The schema's preprocess steps that READERS holds (`z.preprocess(<step>, ...)` in schema.ts) */
const SCHEMA_STEPS = ["normalizePickupCaptureConfig", "readRecipeSetpointAsItem"];

const readBy = (config: Raw) => Object.values(READERS).reduce((value, step) => step(value), config);
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Raw;

/** Every config the repository keeps as a sample: the config samples and the game tests' fixture configs */
function sampleConfigs(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === ".scratch" || entry.name === "node_modules" ? [] : sampleConfigs(file);
        if (!entry.name.endsWith(".json")) return [];
        const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        const config = object(value) && Array.isArray(value.machines);
        return config && object(value.setpoint) ? [file] : [];
    });
}

const SAMPLES = [...sampleConfigs(path.join(ENGINE, "resources", "config-samples")), ...sampleConfigs(path.join(ENGINE, "tests", "game"))];

describe("the readers before the schema", () => {
    it("are every preprocess step of the schema", () => {
        const schema = fs.readFileSync(path.join(__dirname, "schema.ts"), "utf8");
        const steps = Array.from(schema.matchAll(/z\.preprocess\((\w+)/g), match => match[1]);
        expect(steps.sort()).toEqual([...SCHEMA_STEPS].sort());
    });
});

describe("the samples", () => {
    it("are every config of ConfigPaths and the game fixtures", () => {
        expect(SAMPLES).toEqual(expect.arrayContaining(Object.values(ConfigPaths)));
        expect(SAMPLES.length).toBeGreaterThan(Object.values(ConfigPaths).length);
    });

    it.each(SAMPLES.map(file => path.relative(ENGINE, file)))("%s states each value as the engine reads it: no reader changes it", file => {
        const config = read(path.join(ENGINE, file));
        expect(readBy(config)).toEqual(config);
    });
});
